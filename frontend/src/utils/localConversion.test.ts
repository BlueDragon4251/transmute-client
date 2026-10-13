import { describe, expect, it } from 'vitest'
import { convertLocal, formatsFor } from './localConversion'

describe('local conversion contract', () => {
  it('advertises JPEG file extensions correctly', () => {
    const f = new File(['fake'], 'photo.jpg', { type: 'image/jpeg' })
    expect(formatsFor(f)).toContain('png')
    expect(formatsFor(f)).toContain('jpeg')
  })
  it('converts JSON arrays to CSV without network requests', async () => {
    const f = new File(['[{"name":"A","count":2},{"name":"B","count":3}]'], 'data.json', { type: 'application/json' })
    const output = await convertLocal(f, 'csv')
    expect(await output.blob.text()).toBe('name,count\r\nA,2\r\nB,3')
  })
  it('handles CSV quoted separators', async () => {
    const f = new File(['name,comment\nAda,"hello, world"'], 'data.csv', { type: 'text/csv' })
    const output = await convertLocal(f, 'json')
    expect(JSON.parse(await output.blob.text())).toEqual([{name:'Ada', comment:'hello, world'}])
  })
  it('does not label PDF pass-through as conversion', async () => {
    const f = new File(['%PDF-1.7'], 'contract.pdf', { type: 'application/pdf' })
    expect(formatsFor(f)).toEqual([])
    await expect(convertLocal(f, 'pdf')).rejects.toThrow()
  })
  it('does not advertise copying text as conversion', async () => {
    const f = new File(['hello'], 'note.txt', { type: 'text/plain' })
    expect(formatsFor(f)).not.toContain('txt')
    await expect(convertLocal(f, 'txt')).rejects.toThrow()
  })
  it('rejects unsupported conversion pairs', async () => {
    const f = new File(['binary'], 'office.docx')
    await expect(convertLocal(f, 'png')).rejects.toThrow()
  })
})
