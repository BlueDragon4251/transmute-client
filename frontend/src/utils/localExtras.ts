/** Browser-only generators: real text/PDF and triangle-mesh CAD transformations.
 * No fetch, network access or server component.
 */
export type ExtraOutput = {blob:Blob;extension:string}
const pdfEscape=(s:string)=>s.replace(/[\\()]/g,ch=>'\\'+ch)
export async function plainTextPdf(file:File):Promise<ExtraOutput> {
  const source=await file.text()
  const lines=source.replace(/\r\n?/g,'\n').split('\n')
  const pages:string[][]=[]
  for(let i=0;i<lines.length;i+=48)pages.push(lines.slice(i,i+48))
  if(!pages.length)pages.push([])
  // Latin-1 baseline PDF using Type1 Courier. Reject characters that this
  // encoding cannot represent rather than silently mangling them.
  if([...source].some(c=>c.codePointAt(0)!>255)) throw Error('PDF-Text: nur Latin-1-Zeichen unterstützt')
  const objects:string[]=[]
  const add=(s:string)=>{objects.push(s);return objects.length}
  const catalog=add('');const root=add('');const font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>')
  const refs:number[]=[]
  for(const linesOfPage of pages) {
    const ops=['BT /F1 10 Tf 45 790 Td 13 TL']
    for(const [i,line] of linesOfPage.entries())ops.push((i?'T* ':'')+'('+pdfEscape(line)+') Tj')
    ops.push('ET')
    const commands=ops.join('\n')+'\n'
    const stream=add('<< /Length '+commands.length+' >>\nstream\n'+commands+'endstream')
    refs.push(add('<< /Type /Page /Parent '+root+' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 '+font+' 0 R >> >> /Contents '+stream+' 0 R >>'))
  }
  objects[catalog-1]='<< /Type /Catalog /Pages '+root+' 0 R >>'
  objects[root-1]='<< /Type /Pages /Count '+refs.length+' /Kids ['+refs.map(i=>i+' 0 R').join(' ')+'] >>'
  let result='%PDF-1.4\n'
  const offsets=[0]
  for(let i=0;i<objects.length;i++){offsets.push(result.length);result+=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n'}
  const xref=result.length
  result+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'
  for(const offset of offsets.slice(1)) result+=String(offset).padStart(10,'0')+' 00000 n \n'
  result+='trailer\n<< /Root '+catalog+' 0 R /Size '+(objects.length+1)+' >>\nstartxref\n'+xref+'\n%%EOF\n'
  // WinAnsi Type1 PDF stores bytes, not UTF-8. Convert deliberately.
  const bytes=Uint8Array.from([...result].map(c=>c.charCodeAt(0)&255))
  return {blob:new Blob([bytes],{type:'application/pdf'}),extension:'pdf'}
}
type Vec=[number,number,number]
type Tri=[Vec,Vec,Vec]
const finite=(n:number)=>{if(!Number.isFinite(n))throw Error('3D-Datei enthält ungültige Koordinaten');return n}
const vertex=(s:string[]):Vec=>{
  if(s.length<3)throw Error('3D-Datei enthält einen ungültigen Vertex')
  return [finite(Number(s[0])),finite(Number(s[1])),finite(Number(s[2]))]
}
async function trianglesFromStl(file:File):Promise<Tri[]> {
  const raw=await file.arrayBuffer()
  const bytes=new Uint8Array(raw),v=new DataView(raw)
  if(bytes.length>=84 && 84+v.getUint32(80,true)*50===bytes.length){
    const count=v.getUint32(80,true)
    if(count>1_000_000)throw Error('3D-Modell zu groß')
    const tris:Tri[]=[]
    for(let i=0;i<count;i++){
      const at=84+i*50+12
      const read=(a:number):Vec=>[finite(v.getFloat32(a,true)),finite(v.getFloat32(a+4,true)),finite(v.getFloat32(a+8,true))]
      tris.push([read(at),read(at+12),read(at+24)])
    }
    return tris
  }
  const src=await file.text()
  const verts:Vec[]=[]
  for(const line of src.split(/\r?\n/)){
    const m=line.trim().match(/^vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/i)
    if(m){verts.push(vertex(m.slice(1)));if(verts.length>3_000_000)throw Error('3D-Modell zu groß')}
  }
  if(verts.length===0||verts.length%3!==0)throw Error('Keine gültigen STL-Dreiecke gefunden')
  const triangles:Tri[]=[]
  for(let i=0;i<verts.length;i+=3)triangles.push([verts[i],verts[i+1],verts[i+2]])
  return triangles
}
async function trianglesFromObj(file:File):Promise<Tri[]>{
  const points:Vec[]=[],tris:Tri[]=[]
  for(const line of (await file.text()).split(/\r?\n/)){
    const bits=line.trim().split(/\s+/)
    if(bits[0]==='v'){points.push(vertex(bits.slice(1)));if(points.length>3_000_000)throw Error('3D-Modell zu groß')}
    if(bits[0]==='f'){
      const indices=bits.slice(1).map(part=>{
        const n=Number(part.split('/')[0])
        if(!Number.isInteger(n)||n===0)throw Error('Ungültiger OBJ-Face-Index')
        const pos=n>0?n-1:points.length+n
        if(pos<0||pos>=points.length)throw Error('OBJ-Face verweist auf unbekannten Vertex')
        return pos
      })
      if(indices.length<3)throw Error('OBJ-Face benötigt mindestens drei Punkte')
      for(let i=1;i<indices.length-1;i++){
        tris.push([points[indices[0]],points[indices[i]],points[indices[i+1]]])
        if(tris.length>1_000_000)throw Error('3D-Modell zu groß')
      }
    }
  }
  if(!tris.length)throw Error('Keine Dreiecke im OBJ gefunden')
  return tris
}
export async function meshConvert(file:File,to:'obj'|'stl'):Promise<ExtraOutput>{
  const from=file.name.split('.').pop()?.toLowerCase()
  if(!['stl','obj'].includes(from??'')||from===to)throw Error('Nicht unterstützte 3D-Konvertierung')
  const triangles=from==='stl'?await trianglesFromStl(file):await trianglesFromObj(file)
  if(to==='obj'){
    const lines=['# Triangulated STL to OBJ, entirely local']
    for(const tri of triangles){
      for(const p of tri)lines.push('v '+p.join(' '))
    }
    for(let i=0;i<triangles.length;i++)lines.push('f '+(i*3+1)+' '+(i*3+2)+' '+(i*3+3))
    return {blob:new Blob([lines.join('\n')+'\n'],{type:'text/plain'}),extension:'obj'}
  }
  const binary=new ArrayBuffer(84+triangles.length*50),view=new DataView(binary)
  view.setUint32(80,triangles.length,true)
  for(let i=0;i<triangles.length;i++){
    const start=84+i*50
    for(let p=0;p<3;p++)for(let axis=0;axis<3;axis++)
      view.setFloat32(start+12+p*12+axis*4,triangles[i][p][axis],true)
  }
  return {blob:new Blob([binary],{type:'model/stl'}),extension:'stl'}
}
