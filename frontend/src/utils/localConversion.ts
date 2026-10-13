/** Entirely local conversions. No fetch, XMLHttpRequest, or server fallback. */
export type LocalFormat = 'png'|'jpeg'|'webp'|'bmp'|'ico'|'svg'|'txt'|'json'|'csv'|'tsv'|'html'|'xml'|'md'|'yaml'|'yml'|'pdf'|'zip'
export type Output = { blob: Blob; extension: string }
const textTypes = new Set(['txt','json','csv','tsv','html','xml','md','yaml','yml'])
const imageTypes = new Set(['png','jpeg','webp','bmp','ico','svg'])
const ext = (s:string) => s.split('.').pop()?.toLowerCase() || ''
const mime: Record<string,string> = {png:'image/png',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',txt:'text/plain',html:'text/html',xml:'application/xml',json:'application/json',csv:'text/csv',tsv:'text/tab-separated-values',md:'text/markdown',pdf:'application/pdf',zip:'application/zip'}
const blob = (value:string, format:string):Output => ({blob:new Blob([value],{type:mime[format]||'text/plain'}),extension:format})
export const formatsFor = (file:File):LocalFormat[] => {
  const e=ext(file.name)
  if (imageTypes.has(e) || file.type.startsWith('image/')) return ['png','jpeg','webp','bmp','ico']
  if (textTypes.has(e)) return ['txt','json','csv','tsv','html','xml','md','yaml','yml']
  if (e==='pdf') return ['pdf']
  return []
}
const csvEscape = (s:string, sep:string) => /["\r\n]/.test(s)||s.includes(sep) ? '"'+s.replace(/"/g,'""')+'"' : s
function parseDelimited(s:string,sep:string):string[][] {
  const rows:string[][]=[];let row:string[]=[],part='',quoted=false
  for(let i=0;i<s.length;i++){const ch=s[i]
    if(quoted){if(ch==='"' && s[i+1]==='"'){part+='"';i++}else if(ch==='"')quoted=false;else part+=ch}
    else if(ch==='"' && part==='')quoted=true
    else if(ch===sep){row.push(part);part=''}
    else if(ch==='\n'){row.push(part.replace(/\r$/,''));rows.push(row);row=[];part=''}
    else part+=ch
  }
  if(part||row.length){row.push(part);rows.push(row)}
  if(quoted)throw Error('CSV: nicht geschlossene Anführungszeichen')
  return rows
}
function toDelimited(rows:unknown[][],sep:string):string {
  return rows.map(r=>r.map(v=>csvEscape(String(v??''),sep)).join(sep)).join('\r\n')
}
function readStructured(s:string,from:string):unknown {
  if(from==='json')return JSON.parse(s)
  if(from==='csv'||from==='tsv'){
    const rows=parseDelimited(s,from==='csv'?',':'\t')
    if(!rows.length)return []
    const [keys,...entries]=rows
    return entries.map(row=>Object.fromEntries(keys.map((k,i)=>[k,row[i]??''])))
  }
  throw Error('Dieses Eingabeformat kann nur als Text ausgegeben werden')
}
function encodeStructured(data:unknown,to:string):string {
  if(to==='json')return JSON.stringify(data,null,2)
  if(to==='csv'||to==='tsv'){
    const arr=Array.isArray(data)?data:[data]
    const keys=[...new Set(arr.flatMap(o=>o && typeof o==='object'&&!Array.isArray(o)?Object.keys(o):['value']))]
    const rows=[keys,...arr.map(o=>keys.map(k=>o && typeof o==='object'&&!Array.isArray(o)?(o as Record<string,unknown>)[k] :k==='value'?o:''))]
    return toDelimited(rows,to==='csv'?',':'\t')
  }
  throw Error('Ziel ist kein strukturiertes Datenformat')
}
async function imageOutput(file:File,to:LocalFormat):Promise<Output> {
  if(to==='svg') throw Error('Bitmap-zu-SVG-Vektorisierung wird nicht unterstützt')
  const bitmap=await createImageBitmap(file)
  try {
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas nicht verfügbar')
    if(to==='jpeg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)}
    ctx.drawImage(bitmap,0,0)
    if(to==='bmp'){
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height)
      const stride=(canvas.width*3+3)&~3;const size=54+stride*canvas.height
      const buf=new ArrayBuffer(size);const view=new DataView(buf);const out=new Uint8Array(buf)
      out[0]=66;out[1]=77;view.setUint32(2,size,true);view.setUint32(10,54,true)
      view.setUint32(14,40,true);view.setInt32(18,canvas.width,true);view.setInt32(22,canvas.height,true)
      view.setUint16(26,1,true);view.setUint16(28,24,true);view.setUint32(34,size-54,true)
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const src=(y*canvas.width+x)*4,dst=54+(canvas.height-y-1)*stride+x*3
        out[dst]=pixels.data[src+2];out[dst+1]=pixels.data[src+1];out[dst+2]=pixels.data[src]
      }
      return {blob:new Blob([buf],{type:'image/bmp'}),extension:'bmp'}
    }
    if(to==='ico'){
      const small=document.createElement('canvas');small.width=small.height=256
      const c=small.getContext('2d');if(!c)throw Error('Canvas nicht verfügbar')
      c.drawImage(canvas,0,0,256,256)
      const png=await new Promise<Blob>((resolve,reject)=>small.toBlob(x=>x?resolve(x):reject(Error('PNG-Encoder fehlgeschlagen')),'image/png'))
      const bytes=new Uint8Array(await png.arrayBuffer()),buf=new Uint8Array(22+bytes.length),v=new DataView(buf.buffer)
      v.setUint16(2,1,true);v.setUint16(4,1,true);v.setUint16(10,1,true);v.setUint16(12,32,true);v.setUint32(14,bytes.length,true);v.setUint32(18,22,true);buf.set(bytes,22)
      return {blob:new Blob([buf],{type:'image/x-icon'}),extension:'ico'}
    }
    const kind=mime[to];if(!kind)throw Error('Nicht unterstütztes Bildformat')
    const result=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(Error('Browser unterstützt den Encoder nicht')),kind,0.92))
    if(result.type!==kind)throw Error('Browser unterstützt das Zielformat nicht')
    return {blob:result,extension:to==='jpeg'?'jpg':to}
  } finally {bitmap.close()}
}
export async function convertLocal(file:File,to:LocalFormat):Promise<Output> {
  const from=ext(file.name)
  if(!formatsFor(file).includes(to))throw Error('Dieses Formatpaar ist nicht lokal unterstützt')
  if(imageTypes.has(from)||file.type.startsWith('image/'))return imageOutput(file,to)
  if(from==='pdf'){
    if(to==='pdf')return {blob:file,extension:'pdf'}
    throw Error('PDF-Transformation benötigt eine gesonderte lokale Engine')
  }
  const source=await file.text()
  if(to==='txt')return blob(source,to)
  if(from===to)return blob(source,to)
  if((from==='csv'||from==='tsv'||from==='json')&&(to==='csv'||to==='tsv'||to==='json'))
    return blob(encodeStructured(readStructured(source,from),to),to)
  throw Error('Keine verlustfreie lokale Umwandlung für diese Kombination vorhanden')
}
