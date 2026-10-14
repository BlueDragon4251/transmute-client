import {test,expect} from '@playwright/test'
import {readFileSync} from 'node:fs'
import DxfParser from 'dxf-parser'
import {STLLoader} from 'three/examples/jsm/loaders/STLLoader.js'
import {PDFDocument} from 'pdf-lib'
const base=process.env.PRODUCTION_URL||'http://127.0.0.1:9040'
test('production CSP permits OCR and CAD batches without document network traffic',async({page,request,context})=>{
 test.setTimeout(240000)
 if((await(await request.get(base+'/api/users/bootstrap-status')).json()).requires_setup)await request.post(base+'/api/users',{data:{username:'e2eadmin',password:'Strong-Test-2468',role:'admin'}})
 const auth=await request.post(base+'/api/users/authenticate',{data:{username:'e2eadmin',password:'Strong-Test-2468'}}),token=(await auth.json()).access_token
 await page.addInitScript(token=>localStorage.setItem('transmute-access-token',token),token)
 await context.route('**/*',async route=>{const r=route.request();expect(new URL(r.url()).origin).toBe(new URL(base).origin);expect(r.method()).toBe('GET');expect(r.url()).not.toContain('LOCAL%20OCR');await route.continue()})
 await page.goto(base+'/');await expect(page.getByRole('heading',{name:'Dateien lokal konvertieren'})).toBeVisible()
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=240;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='64px sans-serif';x.fillText('LOCAL OCR 2468',60,140);return c.toDataURL('image/png').split(',')[1]}),png=Buffer.from(image,'base64')
 const files=[{name:'local-ocr.png',buffer:png,mimeType:'image/png'},{name:'searchable-ocr.png',buffer:png,mimeType:'image/png'},{name:'cube.step',buffer:readFileSync('e2e/fixtures/cad/cube.step'),mimeType:'application/octet-stream'},{name:'entities.dwg',buffer:readFileSync('e2e/fixtures/cad/entities.dwg'),mimeType:'application/octet-stream'}]
 await page.locator('#local-files').setInputFiles(files);await page.getByRole('combobox',{name:'OCR-Sprache'}).selectOption('eng')
 const targets=['ocr-txt','ocr-pdf','stl','dxf']
 for(const [index,file] of files.entries())await page.getByRole('combobox',{name:'Ausgabe für '+file.name,exact:true}).selectOption(targets[index])
 await page.getByRole('button',{name:'Batch konvertieren'}).click()
 await Promise.race([expect(page.getByRole('link',{name:'Herunterladen'})).toHaveCount(files.length,{timeout:180000}),page.getByRole('alert').first().waitFor({state:'visible',timeout:180000}).then(async()=>{throw Error(await page.getByRole('alert').first().innerText())})])
 const output:Buffer[]=[]
 for(let i=0;i<files.length;i++){const event=page.waitForEvent('download');await page.getByRole('link',{name:'Herunterladen'}).nth(i).click();const stream=await(await event).createReadStream(),chunks=[];for await(const chunk of stream!)chunks.push(chunk);output.push(Buffer.concat(chunks))}
 expect(output[0].toString()).toContain('LOCAL OCR 2468')
 const pdf=await PDFDocument.load(output[1]);expect(pdf.getPageCount()).toBe(1);expect(pdf.context.enumerateIndirectObjects().some(([,v])=>v.toString().includes('/Subtype /Image'))).toBe(true)
 const stl=new Uint8Array(output[2]),geometry=new STLLoader().parse(stl.buffer);expect(geometry.getAttribute('position').count).toBeGreaterThan(30);geometry.dispose()
 expect(new DxfParser().parseSync(output[3].toString())!.entities.length).toBeGreaterThan(2)
 // Decode the local OCR result through the production PDF worker as well.
 await page.getByRole('button',{name:'Alles entfernen',exact:true}).click();await page.locator('#local-files').setInputFiles({name:'searchable.pdf',buffer:output[1],mimeType:'application/pdf'})
 await page.getByRole('combobox',{name:'Ausgabe für searchable.pdf',exact:true}).selectOption('txt');await page.getByRole('button',{name:'Batch konvertieren'}).click()
 await expect(page.getByRole('link',{name:'Herunterladen'})).toHaveCount(1);const event=page.waitForEvent('download');await page.getByRole('link',{name:'Herunterladen'}).click();const stream=await(await event).createReadStream(),chunks=[];for await(const chunk of stream!)chunks.push(chunk);expect(Buffer.concat(chunks).toString()).toContain('LOCAL OCR 2468')
})
