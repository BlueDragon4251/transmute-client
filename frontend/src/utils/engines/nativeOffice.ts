import {asset,checkpoint,extension,result,parseXml,type ConversionOptions,type Result} from './common'
import {readZip} from './archives'
const protocol='transmute-office'
type EngineMessage={protocol:string;session:string;ready?:boolean;id?:string;progress?:number;message?:string;error?:string;bytes?:ArrayBuffer}
type Session={frame:HTMLIFrameElement;session:string;ready:Promise<void>;pending?:{id:string;resolve:(bytes:ArrayBuffer)=>void;reject:(error:Error)=>void};progress?:(value:number,message:string)=>void;dispose:()=>void}
let current:Session|undefined,idle:ReturnType<typeof setTimeout>|undefined,queue:Promise<void>=Promise.resolve()
function boot():Session{
 if(!window.crossOriginIsolated)throw Error('LibreOffice benötigt HTTPS/localhost sowie COOP-/COEP-Isolationsheader. Der Basisexport ist alternativ verfügbar.')
 const frame=document.createElement('iframe'),session=crypto.randomUUID()
 frame.src=asset('engines/office/frame.html')+'#'+session;frame.title='Lokale Office-Engine';frame.setAttribute('aria-hidden','true');frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.style.cssText='position:fixed;left:-2000px;top:-2000px;width:1024px;height:768px;border:0;pointer-events:none'
 let resolveReady:()=>void=()=>{},rejectReady:(error:Error)=>void=()=>{}
 const ready=new Promise<void>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject}),timer=setTimeout(()=>rejectReady(Error('LibreOffice-Ladevorgang überschreitet drei Minuten')),180000)
 const state:Session={frame,session,ready,dispose:()=>{clearTimeout(timer);window.removeEventListener('message',onMessage);frame.remove();rejectReady(Error('Office-Engine beendet'));state.pending?.reject(Error('Office-Engine beendet'));if(current===state)current=undefined}}
 function onMessage(event:MessageEvent<EngineMessage>){
  const message=event.data;if(event.source!==frame.contentWindow||event.origin!==location.origin||message?.protocol!==protocol||message.session!==session)return
  if(message.ready){clearTimeout(timer);resolveReady()}
  else if(message.progress!==undefined)state.progress?.(message.progress,message.message||'Office-Engine laden')
  else if(message.error){const error=Error(message.error);clearTimeout(timer);rejectReady(error);state.pending?.reject(error)}
  else if(message.bytes&&state.pending&&state.pending.id===message.id)state.pending.resolve(message.bytes)
 }
 window.addEventListener('message',onMessage);document.body.appendChild(frame);return state
}
async function perform(file:File,to:string,options:ConversionOptions):Promise<Result>{
 if(file.size>32*1024*1024)throw Error('Office-Datei überschreitet 32 MiB')
 if(idle)clearTimeout(idle)
 checkpoint(options,2,'Office-Datei lokal prüfen')
 const bytes=await file.arrayBuffer()
 if(['fodt','fods','fodp'].includes(extension(file.name)))parseXml(new TextDecoder().decode(bytes))
 if(new Uint8Array(bytes)[0]===80&&new Uint8Array(bytes)[1]===75){
  const entries=readZip(new Uint8Array(bytes))
  for(const [name,content] of Object.entries(entries))if(name.endsWith('.rels')){
   const xml=parseXml(new TextDecoder().decode(content))
   for(const rel of Array.from(xml.getElementsByTagName('Relationship')))if(rel.getAttribute('TargetMode')==='External'&&!rel.getAttribute('Type')?.endsWith('/hyperlink'))throw Error('Extern verknüpfte Office-Ressourcen werden nicht geladen')
  }
 }
 const state=current||(current=boot()),id=crypto.randomUUID()
 let rejectAbort:(error:Error)=>void=()=>{},closed=false
 const interrupted=new Promise<never>((_,reject)=>{rejectAbort=reject}),abort=()=>{closed=true;rejectAbort(Error('Office-Konvertierung abgebrochen'));state.dispose()},timeout=setTimeout(()=>{closed=true;rejectAbort(Error('Office-Konvertierung überschreitet fünf Minuten'));state.dispose()},300000)
 options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort()
 state.progress=(value,message)=>{if(!closed)options.onProgress?.(Math.min(35,value),message)}
 try{
  await Promise.race([state.ready,interrupted]);checkpoint(options,40,'LibreOffice konvertiert lokal')
  const converted=new Promise<ArrayBuffer>((resolve,reject)=>{state.pending={id,resolve,reject};state.frame.contentWindow!.postMessage({protocol,session:state.session,id,from:extension(file.name),to,bytes},location.origin,[bytes])})
  const output=await Promise.race([converted,interrupted]);if(output.byteLength>256*1024*1024)throw Error('Office-Ausgabe überschreitet 256 MiB')
  checkpoint(options,95,'Office-Ergebnis lokal speichern')
  return {...result(output,to,to==='pdf'?'application/pdf':to==='html'?'text/html;charset=utf-8':to==='txt'?'text/plain;charset=utf-8':'application/octet-stream'),warnings:['LibreOffice exportiert das Dokument mit seinen Import-/Exportfiltern. Fehlende Schriftarten können ersetzt werden; Makros, aktive Inhalte und externe Nachlade-Ressourcen werden nicht ausgeführt. CSV/TSV exportiert das aktive Tabellenblatt.']}
 }catch(error){state.dispose();throw error}
 finally{clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);state.pending=undefined;state.progress=undefined;if(current===state)idle=setTimeout(()=>state.dispose(),30000)}
}
export function nativeOfficeConvert(file:File,to:string,options:ConversionOptions):Promise<Result>{
 const work=queue.then(()=>perform(file,to,options));queue=work.then(()=>{},()=>{});return work
}
