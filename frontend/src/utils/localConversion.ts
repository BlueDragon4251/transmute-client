import { checkpoint, type ConversionOptions } from './engines/common'
import { documentInputs, sheetInputs, slideInputs, audioInputs, videoInputs, audioOutputs, videoOutputs } from './engines/capabilities'
/** Entirely local conversions. No fetch, XMLHttpRequest, or server fallback. */
export type LocalFormat = 'png'|'jpeg'|'webp'|'bmp'|'ico'|'txt'|'json'|'csv'|'tsv'|'html'|'xml'|'md'|'yaml'|'yml'|'pdf'|'zip'|'tar'|'wav'|'gz'|'gunzip'|'webm'|'mp4'|'mkv'|'gif'|'mp3'|'flac'|'ogg'|'m4a'|'opus'|'obj'|'stl'|'ply'|'gltf'|'glb'|'ttf'|'woff'|'woff2'|'docx'|'odt'|'xlsx'|'ods'|'xls'|'pptx'|'odp'|'pdf-extract'|'pdf-split'|'pdf-rotate'|'pdf-png'|'pdf-jpeg'
export type Output = { blob: Blob; extension: string }
const textTypes = new Set(['txt','json','csv','tsv','html','xml','md','yaml','yml'])
const imageTypes = new Set(['png','jpeg','webp','bmp','ico','svg'])
const ext = (s:string) => s.split('.').pop()?.toLowerCase() || ''
const mime: Record<string,string> = {png:'image/png',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',txt:'text/plain',html:'text/html',xml:'application/xml',json:'application/json',csv:'text/csv',tsv:'text/tab-separated-values',md:'text/markdown',pdf:'application/pdf',zip:'application/zip'}
const blob = (value:string, format:string):Output => ({blob:new Blob([value],{type:mime[format]||'text/plain'}),extension:format})
export const formatsFor = (file: File): LocalFormat[] => {
  const e = ext(file.name)
  let formats: string[] = []
  if (e === 'pdf') formats = ['txt','pdf-png','pdf-jpeg','pdf-extract','pdf-split','pdf-rotate']
  else if (documentInputs.includes(e)) formats = ['docx','odt','txt','html','pdf']
  else if (sheetInputs.includes(e)) formats = ['xlsx','ods','xls','csv','tsv','json','txt','html','pdf']
  else if (slideInputs.includes(e)) formats = ['pptx','odp','txt','html','pdf']
  else if (['stl','obj','ply','gltf','glb'].includes(e)) formats = ['stl','obj','ply','gltf','glb']
  else if (['ttf','otf','woff','woff2'].includes(e)) formats = ['ttf','woff','woff2']
  else if (['zip','tar'].includes(e)) formats = e === 'zip' ? ['tar'] : ['zip']
  else if (e === 'gz') formats = ['gunzip']
  else if (videoInputs.includes(e)) formats = [...videoOutputs,...audioOutputs]
  else if (audioInputs.includes(e)) formats = audioOutputs
  else if (imageTypes.has(e) || ['jpg','jfif','gif','avif'].includes(e) || file.type.startsWith('image/')) formats = ['png','jpeg','webp','bmp','ico','pdf']
  else if (['json','yaml','yml','xml','csv','tsv'].includes(e)) formats = ['txt','json','yaml','xml','csv','tsv','gz','pdf',...(['csv','tsv'].includes(e) ? ['xlsx','ods','xls','html'] : [])]
  else if (textTypes.has(e)) formats = ['txt','gz','pdf','docx','odt','pptx','odp']
  return formats.filter(f => f !== e) as LocalFormat[]
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
  return rows.map(r=>r.map(v=>csvEscape(v && typeof v === 'object' ? JSON.stringify(v) : String(v??''),sep)).join(sep)).join('\r\n')
}
function readStructured(s:string,from:string):unknown {
  if(from==='json')return JSON.parse(s)
  if(from==='csv'||from==='tsv'){
    const rows=parseDelimited(s,from==='csv'?',':'\t')
    if(!rows.length)return []
    const [keys,...entries]=rows
    if (new Set(keys).size !== keys.length || keys.some(k => !k)) throw Error('CSV benötigt eindeutige, nicht leere Spaltennamen')
    if (entries.some(row => row.length !== keys.length)) throw Error('CSV-Zeilen haben unterschiedliche Spaltenzahlen')
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
  await (await import('./engines/images')).validateImageSource(file)
  const bitmap=await createImageBitmap(file)
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw Error('Bild überschreitet 40 Megapixel')
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas nicht verfügbar')
    if(to==='jpeg'||to==='bmp'){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)}
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

async function gzip(file: File, decompress: boolean): Promise<Output> {
  const stream = file.stream().pipeThrough(decompress ? new DecompressionStream('gzip') : new CompressionStream('gzip'))
  const reader = stream.getReader(), chunks: ArrayBuffer[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > 256 * 1024 * 1024) throw Error('GZIP überschreitet 256 MiB')
      chunks.push(value.slice().buffer as ArrayBuffer)
    }
  } finally { await reader.cancel() }
  return { blob: new Blob(chunks, {type: decompress ? 'application/octet-stream' : 'application/gzip'}), extension: decompress ? (file.name.replace(/\.gz$/i, '').includes('.') ? ext(file.name.replace(/\.gz$/i, '')) : 'bin') : ext(file.name) + '.gz' }
}

export async function convertLocal(file: File, to: LocalFormat, options: ConversionOptions = {}): Promise<Output> {
  const from = ext(file.name)
  if (!formatsFor(file).includes(to)) throw Error('Dieses Formatpaar ist nicht lokal unterstützt')
  if (file.size > 256 * 1024 * 1024) throw Error('Datei überschreitet 256 MiB Browser-Limit')
  if (documentInputs.includes(from) || sheetInputs.includes(from) || slideInputs.includes(from) || textTypes.has(from)) {
    if (file.size > 32 * 1024 * 1024) throw Error('Office/Textdatei überschreitet 32 MiB')
  }
  checkpoint(options, 0, 'Lokal vorbereiten')
  // Yield before CPU work so the progress state can paint.
  await new Promise(resolve => setTimeout(resolve, 0))
  let output: Output
  if (from === 'pdf') output = await (await import('./engines/pdf')).transformPdf(file, to, options)
  else if (documentInputs.includes(from) || sheetInputs.includes(from) || slideInputs.includes(from) || ['docx','odt','pptx','odp','xlsx','ods','xls'].includes(to) || from === 'html' && ['txt','pdf'].includes(to) || ['csv','tsv'].includes(from) && ['html','pdf'].includes(to)) output = await (await import('./engines/office')).officeConvert(file, to, options)
  else if (['stl','obj','ply','gltf','glb'].includes(from)) output = await (await import('./engines/mesh')).meshConvertAdvanced(file, to, options)
  else if (['ttf','otf','woff','woff2'].includes(from)) output = await (await import('./engines/fonts')).fontConvert(file, to as 'ttf'|'woff'|'woff2', options)
  else if (['zip','tar'].includes(from)) output = await (await import('./engines/archives')).archiveConvert(file, to)
  else if (audioInputs.includes(from) || videoInputs.includes(from)) output = await (await import('./engines/media')).mediaConvert(file, to, options)
  else if (to === 'gz' || to === 'gunzip') output = await gzip(file, to === 'gunzip')
  else if (imageTypes.has(from) || ['jpg','jfif','gif','avif'].includes(from) || file.type.startsWith('image/')) {
    output = to === 'pdf' ? await (await import('./engines/pdf')).imagesPdf([file], options) : await imageOutput(file, to)
  } else if (to === 'pdf') output = await (await import('./engines/pdf')).textPdf(await file.text(), options)
  else if (to === 'txt' && ['json','yaml','yml','xml'].includes(from)) {
    const engine = await import('./engines/data')
    output = blob(engine.writeData(engine.readData(await file.text(), from), 'json'), 'txt')
  } else if (to === 'txt') output = blob(await file.text(), to)
  else if (['csv','tsv','json','yaml','yml','xml'].includes(from) && ['csv','tsv','json','yaml','xml'].includes(to)) {
    const engine = await import('./engines/data')
    const data = ['csv','tsv'].includes(from) ? readStructured(await file.text(), from) : engine.readData(await file.text(), from)
    output = blob(['csv','tsv'].includes(to) ? encodeStructured(data, to) : engine.writeData(data, to), to)
  }
  else throw Error('Keine lokale Umwandlung für diese Kombination vorhanden')
  checkpoint(options, 100, 'Fertig')
  return output
}
