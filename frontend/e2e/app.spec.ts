import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
const base = process.env.PRODUCTION_URL || 'http://127.0.0.1:9040'
const marker = 'PRIVATE_MARKER_42'
test('production account flow, heterogeneous batch, local download and no file traffic', async ({page,request,context})=>{
  const username = 'admin'+Date.now(), password = 'Strong-Test-2468'
  const bootstrap=await request.get(base+'/api/users/bootstrap-status')
  const setup=await bootstrap.json()
  // A fresh CI database gets its admin. Local repeated runs log in as the stable test admin.
  const admin='e2eadmin'
  if(setup.requires_setup) expect((await request.post(base+'/api/users',{data:{username:admin,password,role:'admin'}})).status()).toBe(201)
  const auth=await request.post(base+'/api/users/authenticate',{data:{username:admin,password}});expect(auth.status()).toBe(200)
  const token=(await auth.json()).access_token
  const headers={Authorization:'Bearer '+token}
  expect((await request.get(base+'/api/users',{headers})).status()).toBe(200)
  expect((await request.post(base+'/api/users',{headers,data:{username,password,role:'member'}})).status()).toBe(201)
  const memberAuth=await request.post(base+'/api/users/authenticate',{data:{username,password}})
  const memberToken=(await memberAuth.json()).access_token,memberHeaders={Authorization:'Bearer '+memberToken}
  expect((await request.get(base+'/api/users',{headers:memberHeaders})).status()).toBe(403)
  expect([403,422]).toContain((await request.patch(base+'/api/users/me',{headers:memberHeaders,data:{role:'admin'}})).status())
  expect((await request.patch(base+'/api/settings',{headers:memberHeaders,data:{theme:'albedo'}})).status()).toBe(200)
  expect((await (await request.get(base+'/api/settings',{headers:memberHeaders})).json()).theme).toBe('albedo')
  expect((await (await request.get(base+'/api/settings',{headers})).json()).theme).not.toBe('albedo')
  expect((await request.post(base+'/api/users/authenticate',{data:{username:admin,password,file:marker}})).status()).toBe(403)
  for(const route of ['/api/files/upload','/api/conversions','/api/jobs','/api/compressions','/api/settings/upload']) expect((await request.post(base+route,{headers,data:{file:marker}})).status()).toBe(403)
  const response=await request.get(base+'/');expect(response.headers()['content-security-policy']).toContain("connect-src 'self'")
  await page.addInitScript(token=>{localStorage.setItem('transmute-access-token',token);localStorage.setItem('transmute-language','de')},memberToken)
  const writes:string[]=[]
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(url.origin!==new URL(base).origin) throw Error('External traffic '+url.href)
    expect(url.href).not.toContain(marker);expect(req.postData()||'').not.toContain(marker)
    if(!['GET','HEAD'].includes(req.method())) writes.push(req.url())
    await route.continue()
  })
  await page.goto(base+'/')
  await expect(page.getByRole('heading',{name:'Dateien lokal konvertieren'})).toBeVisible()
  writes.length=0
  await page.locator('#local-files').setInputFiles([{name:marker+'.txt',mimeType:'text/plain',buffer:Buffer.from(marker+' äöü')},{name:'data.json',mimeType:'application/json',buffer:Buffer.from('[{"name":"'+marker+'"}]')}])
  await page.getByRole('combobox',{name:'Ausgabe für '+marker+'.txt'}).selectOption('pdf')
  await page.getByRole('combobox',{name:'Ausgabe für data.json'}).selectOption('csv')
  await page.getByRole('button',{name:'Batch konvertieren'}).click()
  await expect(page.getByRole('heading',{name:'Lokale Ergebnisse'})).toBeVisible()
  await expect(page.getByRole('link',{name:'Herunterladen'})).toHaveCount(2)
  expect(writes).toEqual([])
  const event=page.waitForEvent('download');await page.getByRole('link',{name:'Herunterladen'}).first().click();const download=await event
  const stream=await download.createReadStream(),chunks=[]
  for await(const chunk of stream!) chunks.push(chunk)
  expect((await PDFDocument.load(Buffer.concat(chunks))).getPageCount()).toBe(1)
  await page.locator('main').evaluate(el=>{el.scrollTop=0})
  await page.screenshot({path:`test-results/workspace-${test.info().project.name}.png`,fullPage:true})
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  // A disabled user cannot keep using an existing token.
  const member=(await memberAuth.json()).user
  expect((await request.patch(base+'/api/users/'+member.uuid,{headers,data:{disabled:true}})).status()).toBe(200)
  expect((await request.get(base+'/api/settings',{headers:memberHeaders})).status()).toBe(403)
  expect((await request.delete(base+'/api/users/'+member.uuid,{headers})).status()).toBe(200)
})

test('production CSP permits locally bundled Office, media, fonts, mesh and PDF workers',async({page,request,context})=>{
  test.setTimeout(180000)
  const {readFileSync,mkdtempSync}=await import('node:fs'),{execFileSync}=await import('node:child_process'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
  const {unzipSync}=await import('fflate'),XLSX=await import('xlsx'),{Font}=await import('fonteditor-core')
  if ((await (await request.get(base+'/api/users/bootstrap-status')).json()).requires_setup) await request.post(base+'/api/users',{data:{username:'e2eadmin',password:'Strong-Test-2468',role:'admin'}})
  const auth=await request.post(base+'/api/users/authenticate',{data:{username:'e2eadmin',password:'Strong-Test-2468'}}),token=(await auth.json()).access_token
  await page.addInitScript(token=>localStorage.setItem('transmute-access-token',token),token)
  const requests:string[]=[]
  await context.route('**/*',async route=>{
    const req=route.request();expect(new URL(req.url()).origin).toBe(new URL(base).origin)
    expect(req.url()).not.toContain(marker);expect(req.postData()||'').not.toContain(marker)
    if(!['GET','HEAD'].includes(req.method()))requests.push(req.url())
    await route.continue()
  })
  const dir=mkdtempSync(join(tmpdir(),'transmute-production-')),video=join(dir,'source.mp4')
  execFileSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:r=10:d=0.5','-f','lavfi','-i','sine=frequency=440:duration=0.5','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',video])
  const pdf=await PDFDocument.create();pdf.addPage().drawText(marker)
  const fixture=JSON.parse(readFileSync('e2e/fixtures/fonts.json','utf8'))
  await page.goto(base+'/');await expect(page.getByRole('heading',{name:'Dateien lokal konvertieren'})).toBeVisible()
  await page.locator('#local-files').setInputFiles([
    {name:'text.txt',mimeType:'text/plain',buffer:Buffer.from(marker)},
    {name:'table.csv',mimeType:'text/csv',buffer:Buffer.from('name,value\n'+marker+',42')},
    {name:'font.otf',mimeType:'font/otf',buffer:Buffer.from(fixture.otf,'base64')},
    {name:'video.mp4',mimeType:'video/mp4',buffer:readFileSync(video)},
    {name:'mesh.obj',mimeType:'text/plain',buffer:Buffer.from('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3')},
    {name:'pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())},
  ])
  for(const [name,to] of [['text.txt','docx'],['table.csv','ods'],['font.otf','woff2'],['video.mp4','webm'],['mesh.obj','glb'],['pages.pdf','pdf-png']])await page.getByRole('combobox',{name:'Ausgabe für '+name}).selectOption(to)
  await page.getByRole('button',{name:'Batch konvertieren'}).click()
  await expect(page.getByRole('link',{name:'Herunterladen'})).toHaveCount(6,{timeout:90000})
  const outputs:Buffer[]=[]
  for(let i=0;i<6;i++){
    const event=page.waitForEvent('download');await page.getByRole('link',{name:'Herunterladen'}).nth(i).click();const download=await event,stream=await download.createReadStream(),chunks=[]
    for await(const chunk of stream!)chunks.push(chunk);outputs.push(Buffer.concat(chunks))
  }
  expect(Object.keys(unzipSync(outputs[0]))).toContain('word/document.xml')
  expect(XLSX.read(outputs[1],{type:'buffer'}).Sheets.Sheet1.A2.v).toBe(marker)
  expect(outputs[2].subarray(0,4).toString()).toBe('wOF2')
  expect(outputs[3].subarray(0,4)).toEqual(Buffer.from([0x1a,0x45,0xdf,0xa3]))
  expect(outputs[4].subarray(0,4).toString()).toBe('glTF')
  expect(Object.keys(unzipSync(outputs[5]))).toContain('page-1.png')
  expect(requests).toEqual([])
  // Font import validates the CFF fixture independently too.
  expect(Font.create(Buffer.from(fixture.otf,'base64'),{type:'otf'}).get().glyf.length).toBeGreaterThan(0)
})

test('production rich Office conversions retain formatting and images without file traffic',async({page,request,context})=>{
 const {richDocumentFixture}=await import('./officeFixtures'),{unzipSync}=await import('fflate')
 const auth=await request.post(base+'/api/users/authenticate',{data:{username:'e2eadmin',password:'Strong-Test-2468'}}),token=(await auth.json()).access_token
 await page.addInitScript(token=>localStorage.setItem('transmute-access-token',token),token)
 await context.route('**/*',async route=>{const req=route.request();expect(new URL(req.url()).origin).toBe(new URL(base).origin);expect(req.method()).toBe('GET');expect(req.url()).not.toContain('RICH_PRIVATE_OFFICE');await route.continue()})
 await page.goto(base+'/');await expect(page.getByRole('heading',{name:'Dateien lokal konvertieren'})).toBeVisible()
 const XLSX=await import('xlsx'),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['RICH_PRIVATE_OFFICE',42],['next',1234.5]]),'ProductionGrid')
 const spreadsheet=Buffer.from(XLSX.write(book,{type:'array',bookType:'xlsx'})),bytes=Buffer.from(await richDocumentFixture())
 await page.locator('#local-files').setInputFiles([{name:'rich.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:bytes},{name:'rich-pdf.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:bytes},{name:'rich-grid.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:spreadsheet}])
 await page.getByRole('combobox',{name:'Ausgabe für rich.docx',exact:true}).selectOption('odt')
 await page.getByRole('combobox',{name:'Ausgabe für rich-pdf.docx',exact:true}).selectOption('pdf')
 await page.getByRole('combobox',{name:'Ausgabe für rich-grid.xlsx',exact:true}).selectOption('pdf')
 await page.getByRole('button',{name:'Batch konvertieren'}).click();await expect(page.getByRole('link',{name:'Herunterladen'})).toHaveCount(3)
 const outputs:Buffer[]=[]
 for(let i=0;i<3;i++){const event=page.waitForEvent('download');await page.getByRole('link',{name:'Herunterladen'}).nth(i).click();const stream=await (await event).createReadStream(),chunks=[];for await(const chunk of stream!)chunks.push(chunk);outputs.push(Buffer.concat(chunks))}
 const odt=unzipSync(outputs[0]);expect(Object.keys(odt)).toContain('Pictures/image-1.png');expect(new TextDecoder().decode(odt['content.xml'])).toContain('fo:font-weight="bold"')
 const pdf=await PDFDocument.load(outputs[1]);expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3);expect(pdf.context.enumerateIndirectObjects().some(([,v])=>v.toString().includes('/Subtype /Image'))).toBe(true)
 const grid=await PDFDocument.load(outputs[2]);expect(grid.getPageCount()).toBe(1);expect(grid.getPage(0).getWidth()).toBeGreaterThan(grid.getPage(0).getHeight())
})
