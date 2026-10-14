import { describe, it, expect } from 'vitest'
import { zipFiles, tarFiles } from './localArchives'

describe('local archive formats', () => {
  it('creates ZIP with local and central signatures', async () => {
    const out = await zipFiles([new File(['hello'], 'a.txt')])
    const bytes = new Uint8Array(await out.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50)
    expect(out.type).toBe('application/zip')
  })
  it('creates TAR with ustar header and double zero ending', async () => {
    const out = await tarFiles([new File(['hello'], 'a.txt')])
    const bytes = new Uint8Array(await out.arrayBuffer())
    expect(bytes.length).toBe(2048)
    expect(new TextDecoder().decode(bytes.slice(257,262))).toBe('ustar')
    expect(bytes.slice(-1024).every(n => n===0)).toBe(true)
  })
})

it('disambiguates duplicate archive names without dropping content',async()=>{
 const {readZip}=await import('./engines/archives')
 const archive=await zipFiles([new File(['first'],'same.txt'),new File(['second'],'same.txt')])
 const entries=readZip(new Uint8Array(await archive.arrayBuffer()))
 expect(Object.keys(entries)).toHaveLength(2)
 expect(Object.values(entries).map(b=>new TextDecoder().decode(b))).toEqual(['first','second'])
})
