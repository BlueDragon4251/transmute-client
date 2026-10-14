import {asset,checkpoint,type ConversionOptions} from './common'
/** Each WASM invocation has an isolated virtual filesystem and is released on completion/abort. */
export function runEngineWorker<T>(script:string,payload:Record<string,unknown>,bytes:ArrayBuffer,options:ConversionOptions):Promise<T> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(asset('engines/'+script)),timer=setTimeout(()=>finish(Error('Browser-Engine überschreitet zwei Minuten')),120000)
    let closed=false
    const abort=()=>finish(Error('Konvertierung abgebrochen'))
    function finish(error?:Error,value?:T){if(closed)return;closed=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);worker.terminate();if(error)reject(error);else resolve(value!)}
    worker.onmessage=event=>{const data=event.data;if(data.progress!==undefined){checkpoint(options,data.progress,data.message||'Lokale WASM-Engine');return}if(data.error)finish(Error(data.error));else finish(undefined,data.result as T)}
    worker.onerror=event=>{event.preventDefault();finish(Error(event.message||'WASM-Worker fehlgeschlagen'))}
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted){abort();return}
    worker.postMessage({...payload,bytes},[bytes])
  })
}
