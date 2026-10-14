/* Isolated engine document. The input is posted from the parent into a memory-only FS. */
const protocol='transmute-office',session=location.hash.slice(1),base=new URL('./',location.href),notify=data=>parent.postMessage({protocol,session,...data},location.origin)
let port,ready=false,busy=false
const failures=new Set()
self.Module={
 arguments:['--headless','--norestore','--nodefault','--nofirststartwizard'],
 canvas:document.getElementById('qtcanvas'),uno_scripts:[new URL('zeta.js',base).href,new URL('office-thread.js',base).href],
 mainScriptUrlOrBlob:new URL('office-worker.js',base).href,
 locateFile:path=>{const name=path.split('/').pop();if(!['soffice.wasm','soffice.data','soffice.data.js.metadata'].includes(name))throw Error('Unknown Office engine asset');return new URL(name,base).href},
 print:()=>{},printErr:()=>{},onAbort:()=>notify({error:'LibreOffice-WASM konnte nicht gestartet werden'}),
 setStatus:status=>{if(!ready)notify({progress:Math.min(30,status?.includes('Preparing')?25:10),message:'LibreOffice lokal laden'})},
}
const script=document.createElement('script');script.src=new URL('soffice.js',base).href
script.onerror=()=>notify({error:'Lokale LibreOffice-Dateien fehlen'})
script.onload=()=>Module.uno_main.then(value=>{
 port=value
 port.onmessage=event=>{
  const data=event.data
  if(data.cmd==='ready'){ready=true;notify({ready:true});return}
  if(data.cmd==='converted'){
   try {const bytes=FS.readFile('/tmp/transmute-output');notify({id:data.id,bytes:bytes.slice().buffer})}catch(error){notify({id:data.id,error:String(error)})}
   finally {try{FS.unlink(data.from)}catch{}try{FS.unlink('/tmp/transmute-output')}catch{}busy=false}
  }else if(data.cmd==='failed'){try{FS.unlink(data.from)}catch{}try{FS.unlink('/tmp/transmute-output')}catch{}busy=false;notify({id:data.id,error:data.error})}
 }
}).catch(()=>notify({error:'LibreOffice-Initialisierung fehlgeschlagen'}))
self.addEventListener('message',event=>{
 if(event.source!==parent||event.origin!==location.origin||event.data?.protocol!==protocol||event.data.session!==session)return
 const {id,bytes,from,to}=event.data
 if(!ready||busy){notify({id,error:'LibreOffice ist noch nicht bereit'});return}
 if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>32*1024*1024||!/^[a-z0-9]+$/.test(from)||!['doc','rtf','ppt','docx','odt','xlsx','ods','xls','pptx','odp','pdf','html','txt','csv','tsv'].includes(to)){notify({id,error:'Ungültiger Office-Auftrag'});return}
 busy=true;const path='/tmp/transmute-input.'+from
 try{FS.writeFile(path,new Uint8Array(bytes));port.postMessage({cmd:'convert',id,from:path,to})}catch(error){busy=false;notify({id,error:String(error)})}
})
self.addEventListener('error',event=>{if(!failures.has(event.message)){failures.add(event.message);notify({error:'Office-Engine: '+(event.error?.message||event.message)})}})
document.body.appendChild(script)
