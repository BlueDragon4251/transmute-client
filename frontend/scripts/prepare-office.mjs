// Build-time acquisition only: no runtime CDN and no employee file processing.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'fflate'
const lock=JSON.parse(await readFile(new URL('./office-assets.lock.json',import.meta.url),'utf8'))
const cache=new URL('../.engine-cache/',import.meta.url),target=new URL('../public/engines/office/',import.meta.url)
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
await mkdir(cache,{recursive:true});await mkdir(target,{recursive:true})
let prepared=true
for(const [name,sha] of Object.entries(lock.files)){
 const bytes=await readFile(new URL(name,target)).catch(()=>null)
 if(!bytes||digest(bytes)!==sha){prepared=false;break}
}
if(!prepared){
const cached=new URL(lock.sha256+'.tar.gz',cache)
let archive=await readFile(cached).catch(()=>null)
if(!archive||digest(archive)!==lock.sha256){
 console.log('Fetching pinned LibreOffice WASM assets for local hosting')
 const response=await fetch(lock.url,{signal:AbortSignal.timeout(180000)})
 if(!response.ok)throw Error('LibreOffice build asset download failed: '+response.status)
 archive=Buffer.from(await response.arrayBuffer())
 if(digest(archive)!==lock.sha256)throw Error('LibreOffice archive integrity mismatch; refusing changed engine bytes')
 await writeFile(cached,archive)
}
// Only four known names are copied; no tar paths are extracted to the filesystem.
const tar=gunzipSync(archive),found=new Set()
if(tar.byteLength>512*1024*1024)throw Error('LibreOffice archive expansion exceeds 512 MiB')
for(let offset=0;offset+512<=tar.length;){
 const header=tar.subarray(offset,offset+512),text=(a,b)=>new TextDecoder().decode(header.subarray(a,b)).replace(/\0.*$/,'')
 const name=text(0,100).split('/').pop(),size=parseInt(text(124,136).trim()||'0',8)
 if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw Error('Invalid pinned Office tar')
 const bytes=tar.subarray(offset+512,offset+512+size)
 if(lock.files[name]&&(header[156]===0||header[156]===48)){if(digest(bytes)!==lock.files[name])throw Error('Office engine file integrity mismatch: '+name);await writeFile(new URL(name,target),bytes);found.add(name)}
 offset+=512+Math.ceil(size/512)*512
}
if(found.size!==Object.keys(lock.files).length)throw Error('Office archive is missing required engine assets')

}
