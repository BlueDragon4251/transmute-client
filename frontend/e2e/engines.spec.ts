import { test, expect, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import * as XLSX from 'xlsx'
import { Font } from 'fonteditor-core'
import { unzipSync } from 'fflate'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

declare global { interface Window { engines: {
  convertLocal: (file: File, to: never, options?: object) => Promise<{blob:Blob;extension:string}>;
  formatsFor: (file: File) => string[];
  zipFiles: (files:File[])=>Promise<Blob>; tarFiles:(files:File[])=>Promise<Blob>;
  extractArchive:(file:File)=>Promise<File[]>; mergePdfs:(files:File[])=>Promise<{blob:Blob}>;
} } }
const marker = 'PRIVATE_MARKER_42_äöü'
const dir = mkdtempSync(join(tmpdir(),'transmute-fixtures-'))
async function convert(page: Page, name: string, bytes: Uint8Array|string, to: string, options: object = {}) {
  const data = typeof bytes === 'string' ? Array.from(new TextEncoder().encode(bytes)) : Array.from(bytes)
  const output = await page.evaluate(async ({name,data,to,options}) => {
    const file = new File([new Uint8Array(data)],name)
    const result = await window.engines.convertLocal(file,to as never, options)
    return {bytes:Array.from(new Uint8Array(await result.blob.arrayBuffer())),extension:result.extension}
  }, {name,data,to,options})
  return {bytes:new Uint8Array(output.bytes),extension:output.extension}
}
test.beforeEach(async ({page,context}) => {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['127.0.0.1','localhost'].includes(url.hostname)) throw Error('External request: '+url.href)
    if (!['GET','HEAD'].includes(route.request().method())) throw Error('File conversion emitted a write request')
    expect(route.request().url()).not.toContain('PRIVATE_MARKER')
    expect(route.request().postData() || '').not.toContain('PRIVATE_MARKER')
    await route.continue()
  })
  await page.goto('http://127.0.0.1:5173/e2e/harness.html')
  await page.waitForFunction(()=>!!window.engines)
})
test('Unicode text -> PDF, render, extract, split, merge and rotate', async ({page}) => {
  const out = await convert(page,'secret.txt',marker+'\n'+'content\n'.repeat(110),'pdf')
  const pdf = await PDFDocument.load(out.bytes); expect(pdf.getPageCount()).toBeGreaterThan(1)
  const text = await convert(page,'secret.pdf',out.bytes,'txt'); expect(new TextDecoder().decode(text.bytes)).toContain(marker)
  for (const to of ['pdf-png','pdf-jpeg']) {
    const images = await convert(page,'secret.pdf',out.bytes,to,{pages:'1'})
    const entries = unzipSync(images.bytes); expect(Object.keys(entries)).toHaveLength(1)
    expect(Object.values(entries)[0].length).toBeGreaterThan(100)
  }
  const split = await convert(page,'secret.pdf',out.bytes,'pdf-split'); expect(Object.keys(unzipSync(split.bytes))).toHaveLength(pdf.getPageCount())
  const subset = await convert(page,'secret.pdf',out.bytes,'pdf-extract',{pages:'2,1'})
  expect((await PDFDocument.load(subset.bytes)).getPageCount()).toBe(2)
  const rotated = await convert(page,'secret.pdf',out.bytes,'pdf-rotate',{pages:'1',rotation:90})
  expect((await PDFDocument.load(rotated.bytes)).getPage(0).getRotation().angle).toBe(90)
  const merged = await page.evaluate(async data=>Array.from(new Uint8Array(await (await window.engines.mergePdfs([new File([new Uint8Array(data)],'a.pdf'),new File([new Uint8Array(data)],'b.pdf')])).blob.arrayBuffer())),Array.from(out.bytes))
  expect((await PDFDocument.load(new Uint8Array(merged))).getPageCount()).toBe(2*pdf.getPageCount())
  await expect(convert(page,'secret.pdf',out.bytes,'pdf-extract',{pages:'999'})).rejects.toThrow()
})
test('Office document and presentation content roundtrips',async({page})=>{
  for (const formats of [['docx','odt'],['pptx','odp']]) {
    let out = await convert(page,'source.txt',marker+'\nSecond paragraph',formats[0])
    for (const format of [formats[1],formats[0]]) {
      out = await convert(page,'source.'+out.extension,out.bytes,format)
      expect(Object.keys(unzipSync(out.bytes)).length).toBeGreaterThan(2)
      const text = await convert(page,'source.'+format,out.bytes,'txt')
      expect(new TextDecoder().decode(text.bytes)).toContain(marker)
    }
    const pdf = await convert(page,'source.'+out.extension,out.bytes,'pdf')
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThan(0)
    const html = await convert(page,'source.'+out.extension,out.bytes,'html')
    expect(new TextDecoder().decode(html.bytes)).toContain(marker)
  }
})
test('XLSX/ODS/XLS preserve cells, formulas, multiple sheets',async({page})=>{
  const book=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet([[marker,42],[3,5]])
  sheet.C1={t:'n',v:8,f:'A2+B2'};sheet['!ref']='A1:C2'
  XLSX.utils.book_append_sheet(book,sheet,'One');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['second']]),'Two')
  let bytes=new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'}))
  for (const type of ['ods','xlsx']) {
    const out=await convert(page,'book.'+(type==='ods'?'xlsx':'ods'),bytes,type);bytes=out.bytes
    const read=XLSX.read(bytes,{type:'array'});expect(read.SheetNames).toEqual(['One','Two']);expect(read.Sheets.One.A1.v).toBe(marker);expect(read.Sheets.One.C1.f).toBe('A2+B2')
  }
  await expect(convert(page,'book.xlsx',bytes,'xls')).rejects.toThrow(/Formeln/);
  const values=XLSX.utils.book_new();XLSX.utils.book_append_sheet(values,XLSX.utils.aoa_to_sheet([[marker,42]]),'One');const legacy=await convert(page,'values.xlsx',new Uint8Array(XLSX.write(values,{type:'array',bookType:'xlsx'})),'xls');expect(XLSX.read(legacy.bytes,{type:'array'}).Sheets.One.A1.v).toBe(marker)
  for(const type of ['csv','tsv','json','html','txt']) expect(new TextDecoder().decode((await convert(page,'book.xlsx',bytes,type)).bytes)).toContain(marker)
})
test('mesh STL -> OBJ -> GLB -> GLTF -> PLY -> STL has real geometry',async({page})=>{
  let out={bytes:new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid'),extension:'stl'}
  for(const type of ['obj','glb','gltf','ply','stl']) {out=await convert(page,'mesh.'+out.extension,out.bytes,type);expect(out.bytes.length).toBeGreaterThan(50)}
  expect(new DataView(out.bytes.buffer).getUint32(80,true)).toBe(1)
  const external=JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'https://evil.example/'+marker,byteLength:36}]})
  await expect(convert(page,'external.gltf',external,'stl')).rejects.toThrow(/eingebettete/)
})
test('fonts TTF -> WOFF -> WOFF2 -> TTF preserve glyphs',async({page})=>{
  const source=readFileSync('public/fonts/DejaVuSans.ttf')
  let bytes=new Uint8Array(source),from='ttf'
  const original=Font.create(source,{type:'ttf'}).get().glyf.length
  for(const type of ['woff','woff2','ttf']) {const out=await convert(page,'font.'+from,bytes,type);bytes=out.bytes;from=type;expect(bytes.length).toBeGreaterThan(100)}
  expect(Font.create(bytes.buffer,{type:'ttf'}).get().glyf.length).toBe(original)
})
test('ZIP/TAR and GZIP preserve bytes and reject unsafe paths',async({page})=>{
  const created=await page.evaluate(async marker=>{
    const files=[new File([marker],'a.txt'),new File([new Uint8Array([0,1,2,255])],'bytes.bin')]
    const zip=await window.engines.zipFiles(files),tar=await window.engines.tarFiles(files)
    return {zip:Array.from(new Uint8Array(await zip.arrayBuffer())),tar:Array.from(new Uint8Array(await tar.arrayBuffer()))}
  },marker)
  const tar=await convert(page,'files.zip',new Uint8Array(created.zip),'tar')
  const zip=await convert(page,'files.tar',tar.bytes,'zip')
  expect(new TextDecoder().decode(unzipSync(zip.bytes)['a.txt'])).toBe(marker)
  expect(Array.from(unzipSync(zip.bytes)['bytes.bin'])).toEqual([0,1,2,255])
  const gzip=await convert(page,'a.txt',marker,'gz'),text=await convert(page,'a.txt.gz',gzip.bytes,'gunzip')
  expect(new TextDecoder().decode(text.bytes)).toBe(marker);expect(text.extension).toBe('txt')
})
test('images PNG JPEG WebP BMP ICO and PDF contain correct signatures',async({page})=>{
  const png=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=32;canvas.getContext('2d')!.fillRect(0,0,32,32);return Array.from(new Uint8Array(await (await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!)))).arrayBuffer()))})
  for(const to of ['jpeg','webp','bmp','ico','pdf']) {
    const out=await convert(page,'image.png',new Uint8Array(png),to)
    expect(out.bytes.length).toBeGreaterThan(20)
    if(to==='pdf') expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(1)
    else if(to==='bmp') expect(new TextDecoder().decode(out.bytes.slice(0,2))).toBe('BM')
    else if(to==='ico') expect(Array.from(out.bytes.slice(0,4))).toEqual([0,0,1,0])
    else if(to==='jpeg') expect(Array.from(out.bytes.slice(0,2))).toEqual([255,216])
    else expect(new TextDecoder().decode(out.bytes.slice(8,12))).toBe('WEBP')
  }
})
test('media WASM encodes real MP4/WebM/MKV/GIF and common audio codecs',async({page})=>{
  test.setTimeout(240000)
  const path=join(dir,'source.mp4')
  execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=0.5','-f','lavfi','-i','sine=frequency=440:duration=0.5','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',path])
  const source=new Uint8Array(readFileSync(path))
  for (const type of ['webm','mkv','gif','mp3','wav','flac','ogg','m4a','opus']) {
    const out=await convert(page,'source.mp4',source,type),target=join(dir,'out.'+type);writeFileSync(target,out.bytes)
    const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',target],{encoding:'utf8'}))
    expect(info.streams.length).toBeGreaterThan(0)
    if(['webm','mkv'].includes(type)) expect(info.streams.map((s:{codec_type:string})=>s.codec_type)).toEqual(expect.arrayContaining(['video','audio']))
    if(type==='webm') {const back=await convert(page,'back.webm',out.bytes,'mp4');const doc=join(dir,'back.mp4');writeFileSync(doc,back.bytes);expect(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','csv=p=0',doc],{encoding:'utf8'})).toContain('h264')}
  }
})
