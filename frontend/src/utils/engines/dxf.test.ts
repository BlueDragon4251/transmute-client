import {describe,it,expect} from 'vitest'
import type {IDxf} from 'dxf-parser'
import {dxfSvg} from './dxf'
const drawing=(entities:unknown[],blocks:unknown={})=>({entities,blocks} as IDxf)
describe('DXF rendering boundaries',()=>{
 it('escapes drawing text and reports unsupported objects',()=>{
  const out=dxfSvg(drawing([{type:'TEXT',position:{x:1,y:2},text:'<script>alert("x")</script>',height:2},{type:'SPLINE'}]))
  expect(out.svg).toContain('&lt;script&gt;');expect(out.svg).not.toContain('<script>');expect(out.warnings.join()).toContain('SPLINE')
 })
 it('rejects cyclic block references, invalid coordinates and empty geometry',()=>{
  const insert={type:'INSERT',name:'loop',position:{x:0,y:0}}
  expect(()=>dxfSvg(drawing([insert],{loop:{position:{x:0,y:0},entities:[insert]}}))).toThrow(/zyklisch/)
  expect(()=>dxfSvg(drawing([{type:'LINE',vertices:[{x:NaN,y:0},{x:1,y:1}]}]))).toThrow(/Koordinaten/)
  expect(()=>dxfSvg(drawing([{type:'SPLINE'}]))).toThrow(/darstellbaren/)
 })
 it('applies block scale and translation to rendered coordinates',()=>{
  const out=dxfSvg(drawing([{type:'INSERT',name:'line',position:{x:10,y:20},xScale:2,yScale:3}],{line:{position:{x:0,y:0},entities:[{type:'LINE',vertices:[{x:0,y:0},{x:1,y:1}]}]}}))
  expect(out.svg).toContain('points="10,20 12,23"')
 })
})
