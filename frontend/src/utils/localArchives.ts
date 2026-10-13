/** Self-contained ZIP/TAR archiving. Files never leave the browser. */
const encoder = new TextEncoder()

function crc32(bytes:Uint8Array):number {
  let crc=-1
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  return (crc^-1)>>>0
}
const safeName=(s:string)=>s.split(String.fromCharCode(92)).join('/').split('/').filter(x=>x&&x!=='.'&&x!=='..').join('_').slice(0,160)||'file'
export async function zipFiles(files:File[]):Promise<Blob> {
  if(!files.length)throw Error('Keine Dateien ausgewählt')
  const chunks:Uint8Array[]=[];const directory:Uint8Array[]=[]
  let offset=0;let count=0
  for(const file of files){
    const name=encoder.encode(safeName(file.name))
    const data=new Uint8Array(await file.arrayBuffer())
    if(data.length>0xffffffff || offset+data.length+30+name.length>0xffffffff)throw Error('ZIP64 wird noch nicht unterstützt')
    const crc=crc32(data)
    const local=new Uint8Array(30+name.length), lv=new DataView(local.buffer)
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true)
    lv.setUint16(8,0,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true)
    lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30)
    const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer)
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true)
    cv.setUint16(8,0x800,true);cv.setUint16(10,0,true);cv.setUint32(16,crc,true)
    cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true)
    cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.set(name,46)
    chunks.push(local,data);directory.push(central);offset+=local.length+data.length;count++
    if(count>65535)throw Error('Zu viele Dateien für klassisches ZIP')
  }
  const directorySize=directory.reduce((n,x)=>n+x.length,0)
  const end=new Uint8Array(22),v=new DataView(end.buffer)
  v.setUint32(0,0x06054b50,true);v.setUint16(8,count,true);v.setUint16(10,count,true)
  v.setUint32(12,directorySize,true);v.setUint32(16,offset,true)
  // Uint8Array<ArrayBufferLike> is accepted as BlobPart via concrete ArrayBuffer copies.
  const parts:BlobPart[]=[...chunks,...directory,end].map(x=>x.slice().buffer as ArrayBuffer)
  return new Blob(parts,{type:'application/zip'})
}
export async function tarFiles(files:File[]):Promise<Blob>{
  if(!files.length)throw Error('Keine Dateien ausgewählt')
  const parts:BlobPart[]=[]
  for(const file of files){
    const name=encoder.encode(safeName(file.name))
    if(name.length>100)throw Error('Dateiname für TAR zu lang')
    const header=new Uint8Array(512);header.set(name)
    const oct=(offset:number,length:number,n:number)=>{const value=n.toString(8).padStart(length-1,'0')+String.fromCharCode(0);header.set(encoder.encode(value),offset)}
    oct(100,8,0o644);oct(108,8,0);oct(116,8,0);oct(124,12,file.size)
    oct(136,12,Math.floor(file.lastModified/1000));header.fill(32,148,156)
    header[156]=48;header.set(encoder.encode('ustar'+String.fromCharCode(0)),257);header.set(encoder.encode('00'),263)
    const sum=header.reduce((a,b)=>a+b,0);oct(148,8,sum)
    parts.push(header.buffer as ArrayBuffer,file)
    const pad=(512-file.size%512)%512;if(pad)parts.push(new Uint8Array(pad).buffer as ArrayBuffer)
  }
  parts.push(new Uint8Array(1024).buffer as ArrayBuffer)
  return new Blob(parts,{type:'application/x-tar'})
}
