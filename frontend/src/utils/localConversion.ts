/** Entirely local conversions. No fetch, XMLHttpRequest, or server fallback. */
export type LocalFormat = 'png'|'jpeg'|'webp'|'bmp'|'ico'|'svg'|'txt'|'json'|'csv'|'tsv'|'html'|'xml'|'md'|'yaml'|'yml'|'pdf'|'zip'|'wav'|'gz'|'webm'
export type Output = { blob: Blob; extension: string }
const textTypes = new Set(['txt','json','csv','tsv','html','xml','md','yaml','yml'])
const imageTypes = new Set(['png','jpeg','webp','bmp','ico','svg'])
const ext = (s:string) => s.split('.').pop()?.toLowerCase() || ''
const mime: Record<string,string> = {png:'image/png',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',txt:'text/plain',html:'text/html',xml:'application/xml',json:'application/json',csv:'text/csv',tsv:'text/tab-separated-values',md:'text/markdown',pdf:'application/pdf',zip:'application/zip'}
const blob = (value:string, format:string):Output => ({blob:new Blob([value],{type:mime[format]||'text/plain'}),extension:format})
export const formatsFor = (file:File):LocalFormat[] => {
  const e=ext(file.name)
  if (e === 'jpg' || e === 'jfif') return ['png','jpeg','webp','bmp','ico']
  if (imageTypes.has(e) || file.type.startsWith('image/')) return ['png','jpeg','webp','bmp','ico']
  if (e==='json'||e==='csv'||e==='tsv') return (['txt','json','csv','tsv','gz'] as LocalFormat[]).filter(to => to !== e)
  if (textTypes.has(e)) return e === 'txt' ? ['gz'] : ['txt', 'gz']
  if (['wav','mp3','m4a','aac','ogg','flac','opus','webm'].includes(e) && (file.type.startsWith('audio/') || ['wav','mp3','m4a','aac','ogg','flac','opus'].includes(e))) return ['wav']
  if (e === 'gz') return ['txt']
  // Video is not listed until a validated local transcoder is integrated.
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

async function audioToWav(file:File):Promise<Output> {
  const AudioContextClass = window.AudioContext
  if (!AudioContextClass) throw Error('Web Audio API in diesem Browser nicht verfügbar')
  const context = new AudioContextClass()
  try {
    const audio = await context.decodeAudioData(await file.arrayBuffer())
    const channels = Math.min(audio.numberOfChannels, 2)
    const sampleRate = audio.sampleRate
    const length = audio.length
    const dataBytes = length * channels * 2
    if (dataBytes > 0xFFFFFFFF - 44) throw Error('Audio zu groß für klassisches WAV')
    const buffer = new ArrayBuffer(44+dataBytes)
    const v = new DataView(buffer)
    const write = (offset:number,value:string) => {for(let i=0;i<value.length;i++)v.setUint8(offset+i,value.charCodeAt(i))}
    write(0,'RIFF');v.setUint32(4,36+dataBytes,true);write(8,'WAVE');write(12,'fmt ')
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true)
    v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*channels*2,true)
    v.setUint16(32,channels*2,true);v.setUint16(34,16,true)
    write(36,'data');v.setUint32(40,dataBytes,true)
    const samples=Array.from({length:channels},(_,i)=>audio.getChannelData(i))
    let offset=44
    for(let i=0;i<length;i++)for(let c=0;c<channels;c++){
      const value=Math.max(-1,Math.min(1,samples[c][i]))
      v.setInt16(offset,value<0?value*32768:value*32767,true);offset+=2
    }
    return {blob:new Blob([buffer],{type:'audio/wav'}),extension:'wav'}
  } finally {await context.close()}
}


async function gzipText(file:File):Promise<Output> {
  if (!('CompressionStream' in window))throw Error('GZIP wird in diesem Browser nicht unterstützt')
  const stream=file.stream().pipeThrough(new CompressionStream('gzip'))
  const result=await new Response(stream).blob()
  return {blob:new Blob([result],{type:'application/gzip'}),extension:'gz'}
}
async function unzipGzip(file:File):Promise<Output> {
  if (!('DecompressionStream' in window))throw Error('GZIP-Dekomprimierung nicht unterstützt')
  const stream=file.stream().pipeThrough(new DecompressionStream('gzip'))
  const result=await new Response(stream).blob()
  return {blob:new Blob([result],{type:'text/plain'}),extension:'txt'}
}
async function videoWebm():Promise<Output> {
  if (!('MediaRecorder' in window))throw Error('MediaRecorder nicht verfügbar')
  // This first pass intentionally refuses video transcoding until audio-preserving
  // muxing, lifetime and codec negotiation have been implemented.
  throw Error('Video-Transkodierung ist noch nicht verfügbar; keine Datei wurde hochgeladen')
}

export async function convertLocal(file:File,to:LocalFormat):Promise<Output> {
  const from=ext(file.name)
  if(!formatsFor(file).includes(to))throw Error('Dieses Formatpaar ist nicht lokal unterstützt')
  if(imageTypes.has(from)||from==='jpg'||from==='jfif'||file.type.startsWith('image/'))return imageOutput(file,to)
  if(to==='wav') return audioToWav(file)
  if(to==='webm')return videoWebm()
  if(to==='gz')return gzipText(file)
  if(from==='gz' && to==='txt')return unzipGzip(file)
  const source=await file.text()
  if(to==='txt')return blob(source,to)
  if((from==='csv'||from==='tsv'||from==='json')&&(to==='csv'||to==='tsv'||to==='json'))
    return blob(encodeStructured(readStructured(source,from),to),to)
  throw Error('Keine verlustfreie lokale Umwandlung für diese Kombination vorhanden')
}
