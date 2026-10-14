import * as THREE from 'three'
import {checkpoint,extension,result,parseXml,type ConversionOptions,type Result} from './common'
import {runEngineWorker} from './engineWorker'
import {exportMeshScene} from './mesh'
import {validateImageSource} from './images'
import {dxfSvg} from './dxf'

type SolidResult={meshes:{name:string;positions:Float32Array;indices:Uint32Array;normals?:Float32Array;color?:number[]}[]}
type DrawingResult={content:string|Uint8Array;unknown:number}
export async function cadConvert(file:File,to:string,options:ConversionOptions):Promise<Result>{
 if(file.size>64*1024*1024)throw Error('CAD-Datei überschreitet 64 MiB')
 const from=extension(file.name)
 if(['step','stp','iges','igs','brep'].includes(from)){
  const parsed=await runEngineWorker<SolidResult>('cad-worker.js',{kind:'solid',from,to},await file.arrayBuffer(),options),scene=new THREE.Scene()
  for(const item of parsed.meshes){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(item.positions,3));geometry.setIndex(new THREE.BufferAttribute(item.indices,1));if(item.normals)geometry.setAttribute('normal',new THREE.BufferAttribute(item.normals,3));else geometry.computeVertexNormals()
   if(to==='gltf'||to==='glb')geometry.scale(0.001,0.001,0.001)
   const c=item.color,material=new THREE.MeshStandardMaterial({color:c?new THREE.Color(c[0],c[1],c[2]):0xb0c4de}),mesh=new THREE.Mesh(geometry,material);mesh.name=item.name;scene.add(mesh)
  }
  const output=await exportMeshScene(scene,to,options)
  return {...output,warnings:['CAD-Flächen werden trianguliert (0,1 Einheit Toleranz); Körper-/Feature-Parameter gehen verloren. STEP/IGES: Millimeter, GLTF/GLB: Meter. BREP hat keine gespeicherte Einheit; die Koordinaten werden als Millimeter behandelt.']}
 }
 let content:string|Uint8Array,unknown=0,warnings:string[]=[]
 if(from==='dwg'){
  const converted=await runEngineWorker<DrawingResult>('cad-worker.js',{kind:'drawing',from,to},await file.arrayBuffer(),options);content=converted.content;unknown=converted.unknown
  warnings=['DWG-Konvertierung kann komplexe/proprietäre Objekte, Layouts, Schriftformen und externe Referenzen verlieren. Externe Dateien werden nicht geladen.',...(unknown?[`${unknown} nicht unterstützte DWG-Objekte wurden ausgelassen.`]:[])]
 }else{
  checkpoint(options,20,'DXF-Zeichnung lokal lesen')
  const {default:DxfParser}=await import('dxf-parser'),database=new DxfParser().parseSync(await file.text())
  if(!database?.entities?.length)throw Error('Keine lesbaren DXF-Objekte vorhanden')
  if(database.entities.length>200000)throw Error('DXF überschreitet 200000 Objekte')
  if(to==='json')content=JSON.stringify(database,null,2)
  else {const rendered=dxfSvg(database);content=rendered.svg;warnings=rendered.warnings}
 }
 if(to==='json')return {...result(content,'json','application/json'),warnings}
 if(to==='dxf')return {...result(content,'dxf','application/dxf'),warnings}
 let drawing=new File([content instanceof Uint8Array?content.slice().buffer as ArrayBuffer:content],'drawing.svg',{type:'image/svg+xml'})
 await validateImageSource(drawing)
 const xml=parseXml(await drawing.text()),root=xml.documentElement,view=(root.getAttribute('viewBox')||'').trim().split(/[\s,]+/).map(Number)
 if(view.length!==4||!view.every(Number.isFinite)||view[2]<0||view[3]<0||!root.querySelector('line,path,polyline,polygon,circle,ellipse,text'))throw Error('Keine darstellbare 2D-Zeichnung vorhanden')
 const span=Math.max(view[2],view[3],1),pad=span*.02,w=view[2]+pad*2,h=view[3]+pad*2,scale=Math.min(1600/w,1200/h)
 root.setAttribute('viewBox',`${view[0]-pad} ${view[1]-pad} ${w} ${h}`);root.setAttribute('width',String(Math.max(1,Math.round(w*scale))));root.setAttribute('height',String(Math.max(1,Math.round(h*scale))))
 drawing=new File([new XMLSerializer().serializeToString(root)],'drawing.svg',{type:'image/svg+xml'})
 if(to==='svg')return {...result(await drawing.text(),'svg','image/svg+xml'),warnings}
 const {convertLocal}=await import('../localConversion'),output=await convertLocal(drawing,to as 'png'|'pdf',options)
 return {...output,warnings:[...warnings,'PNG/PDF enthält eine gerasterte 2D-Ansicht des Modellraums.']}
}
