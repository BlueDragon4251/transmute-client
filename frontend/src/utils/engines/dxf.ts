import type {IDxf} from 'dxf-parser'
import {xmlEscape} from './common'
type Point={x:number;y:number;z?:number;bulge?:number}
type Entity={type:string;vertices?:Point[];center?:Point;radius?:number;startAngle?:number;endAngle?:number;position?:Point;startPoint?:Point;text?:string;textHeight?:number;height?:number;rotation?:number;name?:string;xScale?:number;yScale?:number;shape?:boolean;paperSpace?:boolean;majorAxisEndPoint?:Point;axisRatio?:number;startParameter?:number;endParameter?:number}
export function dxfSvg(database:IDxf):{svg:string;warnings:string[]}{
 const objects:string[]=[],unsupported=new Set<string>();let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,points=0
 function measure(p:Point){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('DXF enthält ungültige Koordinaten');if(++points>2000000)throw Error('DXF überschreitet zwei Millionen Punkte');minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);return `${p.x},${p.y}`}
 function polyline(values:Point[],map:(p:Point)=>Point,closed=false){const mapped=values.map(map);objects.push(`<${closed?'polygon':'polyline'} points="${mapped.map(measure).join(' ')}"/>`)}
 function render(raw:unknown,map:(p:Point)=>Point,depth=0){
  if(depth>16)throw Error('DXF-Blockreferenzen zu tief oder zyklisch')
  const e=raw as Entity;if(e.paperSpace)return
  if(e.type==='LINE'||e.type==='LWPOLYLINE'||e.type==='POLYLINE'||e.type==='SOLID'||e.type==='3DFACE'){
   const vertices=e.vertices||[];if(vertices.length<2)return
   const expanded:Point[]=[]
   for(let i=0;i<vertices.length;i++){
    const p=vertices[i];expanded.push(p);const next=vertices[(i+1)%vertices.length],bulge=p.bulge||0
    if(bulge&&(i<vertices.length-1||e.shape)){
     const dx=next.x-p.x,dy=next.y-p.y,d=Math.hypot(dx,dy);if(!d)continue
     const factor=(1-bulge*bulge)/(4*bulge),center={x:(p.x+next.x)/2-dy*factor,y:(p.y+next.y)/2+dx*factor},angle=4*Math.atan(bulge),start=Math.atan2(p.y-center.y,p.x-center.x),radius=Math.hypot(p.x-center.x,p.y-center.y),count=Math.min(256,Math.max(8,Math.ceil(Math.abs(angle)*24)))
     for(let j=1;j<count;j++)expanded.push({x:center.x+radius*Math.cos(start+angle*j/count),y:center.y+radius*Math.sin(start+angle*j/count)})
    }
   }
   polyline(expanded,map,!!e.shape||e.type==='SOLID'||e.type==='3DFACE')
  }else if(e.type==='CIRCLE'||e.type==='ARC'){
   if(!e.center||!Number.isFinite(e.radius)||e.radius!<=0)throw Error('Ungültiger DXF-Kreis')
   const start=e.type==='ARC'?e.startAngle||0:0,angle=e.type==='ARC'?((e.endAngle||0)-start+Math.PI*2)%(Math.PI*2)||Math.PI*2:Math.PI*2
   polyline(Array.from({length:97},(_,i)=>({x:e.center!.x+e.radius!*Math.cos(start+angle*i/96),y:e.center!.y+e.radius!*Math.sin(start+angle*i/96)})),map,e.type==='CIRCLE')
  }else if(e.type==='ELLIPSE'&&e.center&&e.majorAxisEndPoint){
   const major=e.majorAxisEndPoint,ratio=e.axisRatio||1,start=e.startParameter||0,end=e.endParameter||Math.PI*2
   polyline(Array.from({length:97},(_,i)=>{const t=start+(end-start)*i/96;return {x:e.center!.x+major.x*Math.cos(t)-major.y*ratio*Math.sin(t),y:e.center!.y+major.y*Math.cos(t)+major.x*ratio*Math.sin(t)}}),map)
  }else if(e.type==='TEXT'||e.type==='MTEXT'){
   const p=e.startPoint||e.position;if(!p)return;const at=map(p),height=Math.abs((e.textHeight||e.height||2)*(map({x:0,y:1}).y-map({x:0,y:0}).y))||2
   measure(at);measure({x:at.x+String(e.text||'').length*height*.7,y:at.y+height})
   const text=String(e.text||'').replace(/\\P/g,' ').replace(/\\U\+([0-9a-f]{4})/gi,(_all,code)=>String.fromCharCode(parseInt(code,16)))
   objects.push(`<text transform="translate(${at.x} ${at.y}) scale(1 -1)" font-family="sans-serif" font-size="${height}" fill="#111" stroke="none">${xmlEscape(text)}</text>`)
  }else if(e.type==='INSERT'&&e.name){
   const block=database.blocks?.[e.name];if(!block){unsupported.add('fehlender/externer Block');return}
   const position=e.position||{x:0,y:0},base=block.position||{x:0,y:0},angle=(e.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle)
   const mapped=(p:Point)=>{const x=(p.x-base.x)*(e.xScale??1),y=(p.y-base.y)*(e.yScale??1);return map({x:position.x+c*x-s*y,y:position.y+s*x+c*y})}
   for(const entity of block.entities||[])render(entity,mapped,depth+1)
  }else if(e.type==='POINT'&&e.position){const p=map(e.position);measure(p);objects.push(`<circle cx="${p.x}" cy="${p.y}" r="0.1"/>`)}
  else unsupported.add(e.type)
 }
 for(const entity of database.entities)render(entity,p=>p)
 if(!objects.length||![minX,minY,maxX,maxY].every(Number.isFinite))throw Error('DXF enthält keine darstellbaren 2D-Objekte')
 const span=Math.max(maxX-minX,maxY-minY,1),pad=span*.03,width=maxX-minX+pad*2,height=maxY-minY+pad*2,scale=Math.min(1600/width,1200/height),stroke=span*.001
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1,Math.round(width*scale))}" height="${Math.max(1,Math.round(height*scale))}" viewBox="${minX-pad} ${minY-pad} ${width} ${height}"><rect x="${minX-pad}" y="${minY-pad}" width="${width}" height="${height}" fill="white"/><g transform="translate(0 ${minY+maxY}) scale(1 -1)" fill="none" stroke="#111" stroke-width="${stroke}">${objects.join('')}</g></svg>`
 return {svg,warnings:['2D-Modellraum-Ansicht; Kurven werden angenähert. Layouts, Bemaßungen, Schraffuren, SHX und externe Referenzen sind eingeschränkt.',...(unsupported.size?[`Ausgelassene DXF-Objekte: ${[...unsupported].join(', ')}`]:[])]}
}
