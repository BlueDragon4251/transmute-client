import { describe,expect,it } from 'vitest'
import { readData,writeData } from './data'
import { readZip } from './archives'
import { zipSync,strToU8 } from 'fflate'
import { validateImageSource } from './images'
import { pageIndices } from './pdf'
describe('structured formats and bounded parsing',()=>{
 it('roundtrips YAML and XML without type or nested-value loss',()=>{
  const data={name:'äöü',items:[1,true,null,{value:'<&"'}],empty:''}
  for(const format of ['yaml','xml'])expect(readData(writeData(data,format),format)).toEqual(data)
 })
 it('reads external XML as a data tree, without entity expansion',()=>{
  expect(readData('<root><item id="a">one</item><item>two</item></root>','xml')).toEqual({root:{item:[{$attributes:{id:'a'},$text:'one'},'two']}})
  expect(()=>readData('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x>&a;</x>','xml')).toThrow()
  expect(()=>readData('x: &x [*x]','yaml')).toThrow()
 })
 it('rejects archive traversal and expansions before writing output',()=>{
  expect(()=>readZip(zipSync({'../secret.txt':strToU8('secret')}))).toThrow(/Archivpfad/)
 })
 it('rejects active or externally referenced SVG for every export path',async()=>{
  for(const source of ['<svg><image href="https://evil.example/x"/></svg>','<svg><script>evil()</script></svg>','<svg><style>@import url(https://evil)</style></svg>'])await expect(validateImageSource(new File([source],'x.svg'))).rejects.toThrow()
  await expect(validateImageSource(new File(['<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="red"/></svg>'],'x.svg'))).resolves.toBeUndefined()
 })
 it('validates PDF page selection, order and duplicate elimination',()=>{
  expect(pageIndices('3,1-2,2',3)).toEqual([2,0,1])
  for(const bad of ['0','4','2-1','1-','a'])expect(()=>pageIndices(bad,3)).toThrow()
 })
})
