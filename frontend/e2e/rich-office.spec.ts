import { test,expect } from '@playwright/test'
import { richDocumentFixture as fixture } from './officeFixtures'
import { unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { readFileSync } from 'node:fs'
const marker='RICH_PRIVATE_OFFICE'
const png=Buffer.from(JSON.parse(readFileSync('e2e/fixtures/images.json','utf8')).png,'base64')

async function convert(page:import('@playwright/test').Page,bytes:Uint8Array,name:string,to:string){
 return page.evaluate(async({bytes,name,to})=>{
  const {convertLocal}=await import('/src/utils/localConversion.ts' as string)
  const out=await convertLocal(new File([new Uint8Array(bytes)],name),to)
  return {bytes:Array.from(new Uint8Array(await out.blob.arrayBuffer())),warnings:out.warnings||[]}
 },{bytes:Array.from(bytes),name,to})
}
test.beforeEach(async({page,context})=>{
 await context.route('**/*',async route=>{expect(new URL(route.request().url()).hostname).toBe('127.0.0.1');expect(route.request().method()).toBe('GET');expect(route.request().url()).not.toContain(marker);await route.continue()})
 await page.goto('http://127.0.0.1:5173/e2e/harness.html');await page.waitForFunction(()=>!!window.engines)
})
test('DOCX -> ODT -> DOCX retains styled runs, headings, cells and embedded images',async({page})=>{
 const docx=await fixture(),odt=await convert(page,docx,'rich.docx','odt'),entries=unzipSync(new Uint8Array(odt.bytes))
 const content=new TextDecoder().decode(entries['content.xml'])
 expect(content).toContain('fo:font-weight="bold"');expect(content).toContain('fo:font-style="italic"');expect(content).toContain('fo:color="#CC1122"');expect(content).toContain('text:outline-level="1"');expect(content).toContain('Table A');expect(content).toContain('table:number-columns-spanned="2"');expect(content).toContain('draw:image')
 expect(Object.keys(entries)[0]).toBe('mimetype');expect(Object.keys(entries)).toContain('Pictures/image-1.png')
 const back=await convert(page,new Uint8Array(odt.bytes),'rich.odt','docx'),word=unzipSync(new Uint8Array(back.bytes)),xml=new TextDecoder().decode(word['word/document.xml'])
 expect(xml).toContain(marker);expect(xml).toContain('w:b');expect(xml).toContain('w:i');expect(xml).toContain('CC1122');expect(xml).toContain('w:tbl');expect(xml).toContain('Table B');expect(xml).toContain('w:gridSpan');expect(Object.keys(word).some(n=>n.startsWith('word/media/'))).toBe(true)
 const html=await convert(page,docx,'rich.docx','html'),htmlText=new TextDecoder().decode(new Uint8Array(html.bytes))
 expect(htmlText).toContain('font-weight:bold');expect(htmlText).toContain('<table>');expect(htmlText).toContain('data:image/png;base64,');expect(htmlText).toContain("default-src 'none'")
})
test('Office PDF retains real images, fonts, tables, selectable text and page breaks',async({page})=>{
 const bytes=await fixture(),out=await convert(page,bytes,'rich.docx','pdf'),pdf=await PDFDocument.load(new Uint8Array(out.bytes))
 expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3)
 const imageObjects=pdf.context.enumerateIndirectObjects().filter(([,v])=>v.toString().includes('/Subtype /Image'))
 expect(imageObjects.length).toBeGreaterThan(0)
 const extracted=await convert(page,new Uint8Array(out.bytes),'rich.pdf','txt'),text=new TextDecoder().decode(new Uint8Array(extracted.bytes))
 expect(text).toContain(marker);expect(text).toContain('Bold red');expect(text).toContain('Table A');expect(text).toContain('After page break');expect(text).toContain('Before internal page break');expect(text).toContain('After internal page break')
 // Render with independent PDF.js as well; attach page PNG for visual review.
 const rendered=await convert(page,new Uint8Array(out.bytes),'rich.pdf','pdf-png'),images=unzipSync(new Uint8Array(rendered.bytes))
 for(const [name,image] of Object.entries(images))await test.info().attach(name,{body:Buffer.from(image),contentType:'image/png'})
})
test('DOCX external images fail without a resource request',async({page})=>{
 const {zipSync,strToU8}=await import('fflate'),entries=unzipSync(await fixture())
 const relPath='word/_rels/document.xml.rels',rels=new TextDecoder().decode(entries[relPath]).replace(/Target="media\/[^"]+"/,'Target="https://evil.example/image" TargetMode="External"')
 entries[relPath]=strToU8(rels)
 await expect(convert(page,zipSync(entries),'external.docx','odt')).rejects.toThrow(/DOCX-Bild/)
})

test('PPTX -> ODP -> PPTX retains slide dimensions, positions, runs, images and tables',async({page})=>{
 const {default:PptxGenJS}=await import('pptxgenjs'),deck=new PptxGenJS();deck.layout='LAYOUT_WIDE';const slide=deck.addSlide();slide.background={color:'F1EEDD'}
 slide.addText([{text:marker,options:{bold:true,color:'CC1122',fontSize:28}},{text:' italic',options:{italic:true,fontSize:20}}],{x:0.5,y:0.4,w:6,h:0.8,margin:0})
 slide.addImage({data:'data:image/png;base64,'+png.toString('base64'),x:8,y:1,w:2,h:1})
 slide.addShape(deck.ShapeType.line,{x:0.5,y:1.7,w:5,h:0,line:{color:'CC1122',width:2}})
 slide.addShape(deck.ShapeType.ellipse,{x:0.7,y:2,w:2,h:1,fill:{color:'2266AA'}})
 slide.addTable([['Cell A','Cell B'],['Value A','Value B']],{x:4,y:3,w:5,h:1,fontSize:14})
 const bytes=new Uint8Array(await deck.write({outputType:'arraybuffer'}) as ArrayBuffer),odp=await convert(page,bytes,'rich.pptx','odp'),entries=unzipSync(new Uint8Array(odp.bytes)),content=new TextDecoder().decode(entries['content.xml'])
 expect(content).toContain('svg:x="36pt"');expect(content).toContain('svg:y="28.8pt"');expect(content).toContain('fo:font-weight="bold"');expect(content).toContain('draw:image');expect(content).toContain('draw:ellipse');expect(content).toContain('Cell A');expect(content).toContain('<draw:line');expect(content).toMatch(/svg:y1="122\.4[^"]*pt"|svg:y1="122\.399[^"]*pt"/)
 const back=await convert(page,new Uint8Array(odp.bytes),'rich.odp','pptx'),pptx=unzipSync(new Uint8Array(back.bytes)),xml=new TextDecoder().decode(pptx['ppt/slides/slide1.xml'])
 expect(xml).toContain(marker);expect(xml).toContain('CC1122');expect(xml).toContain('b="1"');expect(xml).toContain('p:pic');expect(xml).toContain('a:tbl');expect(Object.keys(pptx).some(n=>n.startsWith('ppt/media/'))).toBe(true)
 const pdf=await convert(page,bytes,'rich.pptx','pdf'),read=await PDFDocument.load(new Uint8Array(pdf.bytes))
 expect(read.getPageCount()).toBe(1);expect(read.getPage(0).getWidth()).toBeCloseTo(960,0)
 const text=await convert(page,new Uint8Array(pdf.bytes),'slide.pdf','txt');expect(new TextDecoder().decode(new Uint8Array(text.bytes))).toContain(marker)
 const rendered=await convert(page,new Uint8Array(pdf.bytes),'slide.pdf','pdf-png'),images=unzipSync(new Uint8Array(rendered.bytes));await test.info().attach('slide.png',{body:Buffer.from(images['page-1.png']),contentType:'image/png'})
})

test('spreadsheet PDF paginates all sheets and wide columns with displayed numeric values',async({page})=>{
 const XLSX=await import('xlsx'),book=XLSX.utils.book_new(),rows=Array.from({length:90},(_,r)=>Array.from({length:10},(_,c)=>r===89&&c===9?'LAST_WIDE_CELL':`R${r+1}C${c+1}`)),sheet=XLSX.utils.aoa_to_sheet(rows)
 sheet.B2={t:'n',v:1234.5,z:'#,##0.00'};sheet.C2={t:'n',f:'1000+234.5',v:1234.5,z:'#,##0.00'};sheet.D2={t:'n',f:'1+1'}
 XLSX.utils.book_append_sheet(book,sheet,'WideSheet');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['SECOND_SHEET_MARKER','value']]),'SecondSheet')
 const bytes=new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})),out=await convert(page,bytes,'grid.xlsx','pdf'),pdf=await PDFDocument.load(new Uint8Array(out.bytes))
 expect(pdf.getPageCount()).toBeGreaterThanOrEqual(5);expect(pdf.getPage(0).getWidth()).toBeGreaterThan(pdf.getPage(0).getHeight())
 const txt=await convert(page,new Uint8Array(out.bytes),'grid.pdf','txt'),text=new TextDecoder().decode(new Uint8Array(txt.bytes))
 expect(text).toContain('WideSheet');expect(text).toContain('1,234.50');expect(text).toContain('LAST_WIDE_CELL');expect(text).toContain('SECOND_SHEET_MARKER');expect(out.warnings.join(' ')).toContain('Formeln werden nicht neu berechnet')
 const rendered=await convert(page,new Uint8Array(out.bytes),'grid.pdf','pdf-png'),images=unzipSync(new Uint8Array(rendered.bytes))
 await test.info().attach('spreadsheet-first-page.png',{body:Buffer.from(images['page-1.png']),contentType:'image/png'})
})
