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
  await page.screenshot({path:'test-results/workspace.png',fullPage:true})
  // A disabled user cannot keep using an existing token.
  const member=(await memberAuth.json()).user
  expect((await request.patch(base+'/api/users/'+member.uuid,{headers,data:{disabled:true}})).status()).toBe(200)
  expect((await request.get(base+'/api/settings',{headers:memberHeaders})).status()).toBe(403)
  expect((await request.delete(base+'/api/users/'+member.uuid,{headers})).status()).toBe(200)
})
