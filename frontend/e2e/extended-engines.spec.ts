import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import {PDFDocument} from 'pdf-lib'
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js'
import DxfParser from 'dxf-parser'
const marker='LOCAL OCR 2468'
async function convert(page:import('@playwright/test').Page,bytes:Uint8Array,name:string,to:string){return page.evaluate(async({bytes,name,to})=>{const out=await window.engines.convertLocal(new File([new Uint8Array(bytes)],name),to,{ocrLanguage:'eng'});return {bytes:Array.from(new Uint8Array(await out.blob.arrayBuffer())),warnings:out.warnings||[]}}, {bytes:Array.from(bytes),name,to})}
test.beforeEach(async({page,context})=>{
 await context.route('**/*',async route=>{expect(new URL(route.request().url()).hostname).toBe('127.0.0.1');expect(route.request().method()).toBe('GET');expect(route.request().url()).not.toContain('LOCAL%20OCR');await route.continue()})
 await page.goto('http://127.0.0.1:5173/e2e/harness.html');await page.waitForFunction(()=>!!window.engines)
})
test('OCR recognizes image text and creates searchable pages from a scan-only PDF',async({page})=>{
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=240;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='64px sans-serif';x.fillText('LOCAL OCR 2468',60,140);return c.toDataURL('image/png').split(',')[1]}),bytes=Buffer.from(image,'base64')
 const txt=await convert(page,bytes,'ocr.png','ocr-txt');expect(new TextDecoder().decode(new Uint8Array(txt.bytes))).toContain(marker)
 const scan=await PDFDocument.create(),png=await scan.embedPng(bytes);for(let i=0;i<2;i++)scan.addPage([600,120]).drawImage(png,{x:0,y:0,width:600,height:120})
 const pdfOut=await convert(page,new Uint8Array(await scan.save()),'scan.pdf','ocr-pdf'),pdf=await PDFDocument.load(new Uint8Array(pdfOut.bytes));expect(pdf.getPageCount()).toBe(2)
 expect(pdf.context.enumerateIndirectObjects().some(([,v])=>v.toString().includes('/Subtype /Image'))).toBe(true)
 const text=await convert(page,new Uint8Array(pdfOut.bytes),'searchable.pdf','txt');expect(new TextDecoder().decode(new Uint8Array(text.bytes)).match(/LOCAL OCR 2468/g)?.length).toBe(2)
})
test('OpenCascade imports STEP, IGES and BREP into real mesh files',async({page})=>{
 for(const name of ['cube.step','cube.iges','assembly.brep']){
  const bytes=readFileSync('e2e/fixtures/cad/'+name),out=await convert(page,bytes,name,'stl'),stl=new Uint8Array(out.bytes),geometry=new STLLoader().parse(stl.buffer)
  expect(geometry.getAttribute('position').count).toBeGreaterThan(30);geometry.computeBoundingBox();expect(geometry.boundingBox!.max.x-geometry.boundingBox!.min.x).toBeGreaterThan(0);geometry.dispose()
 }
 const glb=await convert(page,readFileSync('e2e/fixtures/cad/cube.step'),'cube.step','glb');expect(Buffer.from(glb.bytes).subarray(0,4).toString()).toBe('glTF')
 const obj=await convert(page,new Uint8Array(glb.bytes),'cube.glb','obj');expect(new TextDecoder().decode(new Uint8Array(obj.bytes))).toMatch(/^f /m)
})
test('LibreDWG exports real DXF, SVG and entity data, with local drawing raster/PDF exports',async({page})=>{
 const bytes=readFileSync('e2e/fixtures/cad/entities.dwg'),dxf=await convert(page,bytes,'entities.dwg','dxf'),text=new TextDecoder().decode(new Uint8Array(dxf.bytes)),parsed=new DxfParser().parseSync(text)
 expect(parsed!.entities.length).toBeGreaterThan(2)
 const json=await convert(page,bytes,'entities.dwg','json'),database=JSON.parse(new TextDecoder().decode(new Uint8Array(json.bytes)));expect(database.entities.length).toBeGreaterThan(2)
 const svg=await convert(page,bytes,'entities.dwg','svg');expect(new TextDecoder().decode(new Uint8Array(svg.bytes))).toContain('<svg')
 const raster=await convert(page,new Uint8Array(dxf.bytes),'entities.dxf','png');expect(raster.bytes.slice(0,4)).toEqual([137,80,78,71])
 const pdf=await convert(page,new Uint8Array(dxf.bytes),'entities.dxf','pdf');expect((await PDFDocument.load(new Uint8Array(pdf.bytes))).getPageCount()).toBe(1)
})
