import {describe,expect,it} from 'vitest'
import {plainTextPdf,meshConvert} from './localExtras'
import {formatsFor,convertLocal} from './localConversion'

describe('local offline PDF and CAD transformations',()=>{
  it('generates a structurally valid one-page PDF from TXT',async()=>{
    const f=new File(['Hallo Welt'], 'notes.txt')
    expect(formatsFor(f)).toContain('pdf')
    const out=await convertLocal(f,'pdf')
    const bytes=new Uint8Array(await out.blob.arrayBuffer())
    const result=new TextDecoder('latin1').decode(bytes)
    expect(result).toMatch(/^%PDF-1\.4/)
    expect(result).toContain('/Type /Page')
    expect(result).toContain('xref')
    expect(result).toContain('%%EOF')
  })
  it('creates multiple PDF pages for long texts',async()=>{
    const f=new File([Array.from({length:100},(_,i)=>'line '+i).join('\n')],'long.txt')
    const out=await plainTextPdf(f)
    const text=new TextDecoder('latin1').decode(await out.blob.arrayBuffer())
    expect(text).toContain('/Count 3')
  })
  it('converts ASCII STL triangle to OBJ and back to binary STL',async()=>{
    const stl=new File(['solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid'],'sample.stl')
    expect(formatsFor(stl)).toEqual(['obj'])
    const obj=await meshConvert(stl,'obj')
    expect(await obj.blob.text()).toContain('f 1 2 3')
    const back=await meshConvert(new File([obj.blob],'test.obj'),'stl')
    const bytes=await back.blob.arrayBuffer()
    expect(bytes.byteLength).toBe(134)
    expect(new DataView(bytes).getUint32(80,true)).toBe(1)
  })
  it('rejects invalid faces rather than fabricating geometry',async()=>{
    await expect(meshConvert(new File(['f 1 2 3'],'broken.obj'),'stl')).rejects.toThrow()
  })
})
