/* Browser-only WASM worker. No files, paths or conversion results are sent over HTTP. */
self.onmessage=async({data})=>{
 try {
  const {kind,from,to,bytes}=data
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>64*1024*1024)throw Error('CAD-Datei überschreitet 64 MiB')
  self.postMessage({progress:8,message:'Lokale CAD-Engine laden'})
  if(kind==='solid'){
   importScripts('./cad/occt-import-js.js')
   const engine=await occtimportjs({locateFile:name=>new URL('./cad/'+name,self.location.href).href,print:()=>{},printErr:()=>{}})
   const methods={step:'ReadStepFile',stp:'ReadStepFile',iges:'ReadIgesFile',igs:'ReadIgesFile',brep:'ReadBrepFile'}
   if(!methods[from])throw Error('Nicht unterstütztes CAD-Körperformat')
   self.postMessage({progress:25,message:'CAD-Körper triangulieren'})
   const parsed=engine[methods[from]](new Uint8Array(bytes),{linearUnit:'millimeter',linearDeflectionType:'absolute_value',linearDeflection:0.1,angularDeflection:0.5})
   if(!parsed.success||!parsed.meshes?.length)throw Error('Keine lesbaren CAD-Flächen vorhanden')
   let triangles=0
   const meshes=parsed.meshes.map(mesh=>{
    triangles+=mesh.index.array.length/3
    if(triangles>2000000)throw Error('CAD-Modell überschreitet zwei Millionen Dreiecke')
    const positions=new Float32Array(mesh.attributes.position.array),indices=new Uint32Array(mesh.index.array),normals=mesh.attributes.normal?new Float32Array(mesh.attributes.normal.array):undefined
    if(!positions.length||positions.length%3||indices.length%3||!positions.every(Number.isFinite)||!indices.every(i=>i<positions.length/3))throw Error('Ungültige CAD-Geometrie')
    return {name:String(mesh.name||'CAD mesh'),positions,indices,normals,color:mesh.color}
   })
   const transfer=meshes.flatMap(m=>[m.positions.buffer,m.indices.buffer,...(m.normals?[m.normals.buffer]:[])])
   self.postMessage({result:{meshes}},transfer)
  }else if(kind==='drawing'){
   const {LibreDwg,Dwg_File_Type}=await import('./cad/dwg/dist/libredwg-web.js')
   const engine=await LibreDwg.create(new URL('./cad/dwg/wasm',self.location.href).href)
   self.postMessage({progress:25,message:'DWG-Zeichnung lokal lesen'})
   const pointer=engine.dwg_read_data(bytes,Dwg_File_Type.DWG)
   if(!pointer)throw Error('DWG konnte nicht gelesen werden')
   try {
    const {database,stats}=engine.convertEx(pointer)
    if(!database.entities?.length)throw Error('DWG enthält keine unterstützten Modellraum-Objekte')
    if(database.entities.length>200000)throw Error('DWG überschreitet 200000 Objekte')
    let content
    if(to==='dxf'){content=engine.dwg_write_dxf(bytes);if(!content?.length)throw Error('DWG-DXF-Ausgabe fehlgeschlagen')}
    else if(to==='json')content=JSON.stringify(database,(_key,value)=>typeof value==='bigint'?value.toString():value,2)
    else content=engine.dwg_to_svg(database)
    if((typeof content==='string'?new TextEncoder().encode(content).byteLength:content.byteLength)>256*1024*1024)throw Error('CAD-Ausgabe überschreitet 256 MiB')
    self.postMessage({result:{content,unknown:stats.unknownEntityCount}})
   } finally {engine.dwg_free(pointer)}
  }else throw Error('Unbekannter CAD-Auftrag')
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)})}
}
