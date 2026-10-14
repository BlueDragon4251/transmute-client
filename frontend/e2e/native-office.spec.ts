import {test,expect,type Page} from '@playwright/test'
import {PDFDocument} from 'pdf-lib'
import {Document,Paragraph,Header,Footer,Packer,TextRun,ImageRun,Table,TableRow,TableCell,WidthType} from 'docx'
import PptxGenJS from 'pptxgenjs'
import * as XLSX from 'xlsx'
import {unzipSync} from 'fflate'
import {readFileSync} from 'node:fs'
const base=process.env.PRODUCTION_URL||'http://127.0.0.1:9040',marker='OFFICE_NATIVE_PRIVATE'
type Input={name:string;buffer:Buffer;mimeType:string}
async function batch(page:Page,files:Input[],targets:string[]):Promise<Buffer[]>{
 if(await page.getByRole('button',{name:'Alles entfernen',exact:true}).count())await page.getByRole('button',{name:'Alles entfernen',exact:true}).click()
 await page.locator('#local-files').setInputFiles(files)
 if(await page.getByRole('combobox',{name:'Office-Engine'}).count())await page.getByRole('combobox',{name:'Office-Engine'}).selectOption('libreoffice')
 for(const [index,file] of files.entries())await page.getByRole('combobox',{name:'Ausgabe für '+file.name,exact:true}).selectOption(targets[index])
 await page.getByRole('button',{name:'Batch konvertieren'}).click()
 await Promise.race([expect(page.getByRole('link',{name:'Herunterladen'})).toHaveCount(files.length,{timeout:180000}),page.getByRole('alert').first().waitFor({state:'visible',timeout:180000}).then(async()=>{throw Error(await page.getByRole('alert').first().innerText())})])
 const outputs:Buffer[]=[]
 for(let i=0;i<files.length;i++){const event=page.waitForEvent('download');await page.getByRole('link',{name:'Herunterladen'}).nth(i).click();const stream=await(await event).createReadStream(),chunks=[];for await(const chunk of stream!)chunks.push(chunk);const bytes=Buffer.concat(chunks);outputs.push(bytes);await test.info().attach(files[i].name+'-'+targets[i],{body:bytes,contentType:'application/octet-stream'})}
 return outputs
}
const input=(name:string,buffer:Buffer):Input=>({name,buffer,mimeType:'application/octet-stream'})
test('LibreOffice WASM preserves Office layouts, charts, legacy formats and editable roundtrips in production',async({page,request,context})=>{
 test.setTimeout(600000)
 if((await(await request.get(base+'/api/users/bootstrap-status')).json()).requires_setup)await request.post(base+'/api/users',{data:{username:'e2eadmin',password:'Strong-Test-2468',role:'admin'}})
 const auth=await request.post(base+'/api/users/authenticate',{data:{username:'e2eadmin',password:'Strong-Test-2468'}}),token=(await auth.json()).access_token
 await page.addInitScript(token=>localStorage.setItem('transmute-access-token',token),token)
 await context.route('**/*',async route=>{const r=route.request();expect(new URL(r.url()).origin).toBe(new URL(base).origin);expect(r.method()).toBe('GET');expect(r.url()).not.toContain(marker);expect(r.url()).not.toContain('HEADER_NATIVE_PRIVATE');await route.continue()})
 await page.goto(base+'/');await expect(page.getByRole('heading',{name:'Dateien lokal konvertieren'})).toBeVisible();expect(await page.evaluate(()=>window.crossOriginIsolated)).toBe(true)
 const png=Buffer.from(JSON.parse(readFileSync('e2e/fixtures/images.json','utf8')).png,'base64')
 const writer=await Packer.toBuffer(new Document({sections:[{headers:{default:new Header({children:[new Paragraph('HEADER_NATIVE_PRIVATE')]})},footers:{default:new Footer({children:[new Paragraph('FOOTER_NATIVE_PRIVATE')]})},children:[new Paragraph({children:[new TextRun({text:marker,bold:true,size:40})]}),new Paragraph({children:[new ImageRun({type:'png',data:png,transformation:{width:100,height:50}})]}),new Table({width:{size:100,type:WidthType.PERCENTAGE},columnWidths:[4500,4500],rows:[new TableRow({children:[new TableCell({children:[new Paragraph('Native table A')]}),new TableCell({children:[new Paragraph('Native table B')]})]})]})]}]}))
 const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([[marker,100,200],["Native sheet",1234.5]])
 sheet['!cols']=[{wch:32},{wch:14},{wch:14},{wch:14},{wch:18}];sheet['!ref']='A1:E2';sheet.D1={t:'n',f:'SUM(B1:C1)',v:300};sheet.E1={t:'s',f:'WEBSERVICE("'+base+'/api/settings?'+marker+'")',v:'cached'}
 XLSX.utils.book_append_sheet(book,sheet,'Native');const second=XLSX.utils.aoa_to_sheet([['SECOND_NATIVE_SHEET',42]]);second['!cols']=[{wch:32},{wch:14}];XLSX.utils.book_append_sheet(book,second,'Second')
 expect(sheet.D1.f).toBe('SUM(B1:C1)')
 const calc=Buffer.from(XLSX.write(book,{type:'array',bookType:'xlsx'})),deck=new PptxGenJS();deck.layout='LAYOUT_WIDE';const slide=deck.addSlide()
 slide.addText(marker,{x:0.5,y:0.4,w:8,h:0.6,fontSize:28,bold:true});slide.addImage({data:'data:image/png;base64,'+png.toString('base64'),x:9,y:0.5,w:2,h:1})
 slide.addChart(deck.ChartType.bar,[{name:'Local series',labels:['A','B','C'],values:[1,2,3]}],{x:0.8,y:2,w:7,h:4,showTitle:true,title:'NATIVE CHART'})
 const impress=Buffer.from(await deck.write({outputType:'arraybuffer'}) as ArrayBuffer)
 const rendered=await batch(page,[input('writer.docx',writer),input('calc.xlsx',calc),input('slides.pptx',impress),input('writer-rtf.docx',writer)],['pdf','pdf','pdf','rtf'])
 expect((await PDFDocument.load(rendered[0])).getPageCount()).toBe(1);expect((await PDFDocument.load(rendered[1])).getPageCount()).toBeGreaterThanOrEqual(2)
 const presentationPdf=await PDFDocument.load(rendered[2]);expect(presentationPdf.getPageCount()).toBe(1);expect(presentationPdf.getPage(0).getWidth()).toBeCloseTo(960,0);expect(rendered[3].toString('utf8').slice(0,10)).toContain('rtf')
 // Explicitly prove that even same-origin URLs cannot carry document bytes.
 const frame=page.frames().find(frame=>frame.url().includes('/engines/office/frame.html'))!
 expect(await frame.evaluate(async()=>{try{await fetch('/api/settings?OFFICE_NATIVE_PRIVATE');return false}catch{return true}})).toBe(true)
 expect(await frame.evaluate(()=>{try{const request=new XMLHttpRequest();request.open('POST','/api/settings');request.send('OFFICE_NATIVE_PRIVATE');return false}catch{return true}})).toBe(true)
 const binary=await batch(page,[input('legacy-writer.docx',writer),input('legacy-calc.xlsx',calc),input('legacy-slides.pptx',impress),input('roundtrip.rtf',rendered[3])],['doc','xls','ppt','docx'])
 for(const bytes of binary.slice(0,3))expect([...bytes.subarray(0,4)]).toEqual([0xd0,0xcf,0x11,0xe0])
 expect(new TextDecoder().decode(unzipSync(binary[3])['word/document.xml'])).toContain(marker)
 const odf=await batch(page,[input('legacy.doc',binary[0]),input('legacy.xls',binary[1]),input('legacy.ppt',binary[2])],['odt','ods','odp'])
 for(const bytes of odf){const entries=unzipSync(bytes);expect(Object.keys(entries)).toContain('mimetype');expect(new TextDecoder().decode(entries['content.xml'])).toContain(marker)}
 const roundtrip=await batch(page,[input('writer.odt',odf[0]),input('calc.ods',odf[1]),input('slides.odp',odf[2])],['docx','xlsx','pptx'])
 expect(new TextDecoder().decode(unzipSync(roundtrip[0])['word/document.xml'])).toContain(marker)
 const excel=XLSX.read(roundtrip[1],{type:'buffer'});expect(excel.SheetNames.length).toBe(2);expect(excel.Sheets[excel.SheetNames[0]].D1.f).toContain('SUM(');expect(excel.Sheets[excel.SheetNames[0]].D1.v).toBe(300)
 const powerpoint=unzipSync(roundtrip[2]);expect(new TextDecoder().decode(powerpoint['ppt/slides/slide1.xml'])).toContain(marker);expect(Object.keys(powerpoint).some(n=>n.startsWith('ppt/charts/'))).toBe(true)
 const texts=await batch(page,[input('writer.pdf',rendered[0]),input('calc.pdf',rendered[1]),input('slides.pdf',rendered[2]),input('writer-preview.pdf',rendered[0])],['txt','txt','txt','pdf-png'])
 expect(texts[0].toString()).toContain(marker);expect(texts[0].toString()).toContain('HEADER_NATIVE_PRIVATE');expect(texts[0].toString()).toContain('FOOTER_NATIVE_PRIVATE');expect(texts[0].toString()).toContain('Native table A')
 expect(texts[1].toString()).toContain('SECOND_NATIVE_SHEET');expect(texts[2].toString()).toContain('NATIVE CHART')
 const images=unzipSync(texts[3]);await test.info().attach('libreoffice-writer.png',{body:Buffer.from(images['page-1.png']),contentType:'image/png'})
})
