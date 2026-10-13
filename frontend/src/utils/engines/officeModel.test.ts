import {describe,expect,it} from 'vitest'
import {strToU8} from 'fflate'
import {parseXml} from './common'
import {boundedTableRows,localPart,relationships,namespaces as ns} from './officeModel'
import {readRichDocument} from './documentReader'
const flat=(content:string,styles='')=>`<office:document xmlns:office="${ns.office}" xmlns:style="${ns.style}" xmlns:fo="${ns.fo}" xmlns:text="${ns.text}" xmlns:table="${ns.table}" xmlns:draw="${ns.draw}" xmlns:xlink="${ns.xlink}"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text>${content}</office:text></office:body></office:document>`
describe('Office package safety and document model',()=>{
 it('resolves only internal resources and skips external relationships',()=>{
  expect(localPart('ppt/slides/slide1.xml','../media/image.png')).toBe('ppt/media/image.png')
  for(const target of ['https://example.test/x','/root','../../../outside','%2e%2e/x','media%2foutside'])expect(()=>localPart('word/document.xml',target)).toThrow()
  const map=relationships({'word/_rels/document.xml.rels':strToU8('<Relationships><Relationship Id="external" TargetMode="External" Target="https://example.test/x"/><Relationship Id="local" Target="media/a.png"/></Relationships>')},'word/document.xml')
  expect(map.has('external')).toBe(false);expect(map.get('local')).toBe('word/media/a.png')
 })
 it('rejects deep XML and entity definitions before converting',()=>{
  expect(()=>parseXml('<x>'.repeat(130)+'text'+'</x>'.repeat(130))).toThrow(/Ebenen/)
  expect(()=>parseXml('<!DOCTYPE x [<!ENTITY a "test">]><x>&a;</x>')).toThrow(/Entities/)
 })
 it('retains inherited styles, overrides and flat ODF page sizes',async()=>{
  const styles='<style:style style:name="Base" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#112233"/></style:style><style:style style:name="Child" style:family="text" style:parent-style-name="Base"><style:text-properties fo:font-style="italic"/></style:style><style:page-layout style:name="p"><style:page-layout-properties fo:page-width="700pt" fo:page-height="900pt"/></style:page-layout>'
  const model=await readRichDocument(new File([flat('<text:h text:outline-level="2"><text:span text:style-name="Child">Styled</text:span></text:h>',styles)],'sample.fodt'))
  expect(model.width).toBe(700);expect(model.height).toBe(900);expect(model.blocks[0]).toMatchObject({kind:'paragraph',heading:2,runs:[{text:'Styled',bold:true,italic:true,color:'112233'}]})
 })
 it('rejects out-of-range table repetitions instead of silently truncating data',async()=>{
  for(const value of ['-1','0','1001','Infinity','1.5'])await expect(readRichDocument(new File([flat(`<table:table><table:table-row table:number-rows-repeated="${value}"><table:table-cell><text:p>cell</text:p></table:table-cell></table:table-row></table:table>`)],'sample.fodt'))).rejects.toThrow(/Grenzen/)
  expect(()=>boundedTableRows([Array.from({length:3},()=>({span:100,blocks:[]}))])).toThrow(/Spalten/)
 })
 it('rejects external ODF image references without loading them',async()=>{
  await expect(readRichDocument(new File([flat('<text:p><draw:frame><draw:image xlink:href="https://example.test/image.png"/></draw:frame></text:p>')],'sample.fodt'))).rejects.toThrow(/Externe/)
 })
})
