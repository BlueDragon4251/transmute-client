/* Permit only known immutable engine assets. This runs before parsing employee documents. */
(()=>{
 const directory=new URL('./',self.location.href),names=new Set(['soffice.js','soffice.wasm','soffice.data','soffice.data.js.metadata','zeta.js','office-worker.js','office-thread.js','network-guard.js'])
 function allowed(value,method='GET'){
  const url=new URL(value instanceof Request?value.url:String(value),directory)
  if(!['GET','HEAD'].includes(method.toUpperCase())||url.origin!==directory.origin||url.username||url.password||url.search||url.hash||!names.has(url.pathname.slice(directory.pathname.length))||!url.pathname.startsWith(directory.pathname))throw Error('Office network resource blocked')
  return url.href
 }
 // Conversion does not use the OS clipboard. Firefox does not implement these
 // permission names; returning denied also prevents Qt's optional probes crashing.
 const permissions=self.navigator?.permissions
 if(permissions){const query=permissions.query.bind(permissions);permissions.query=descriptor=>{
  if(['clipboard-read','clipboard-write'].includes(descriptor?.name))return Promise.resolve(Object.assign(new EventTarget(),{state:'denied',onchange:null}))
  return query(descriptor)
 }}
 const fetchOriginal=self.fetch.bind(self)
 Object.defineProperty(self,'fetch',{configurable:false,writable:false,value:(input,init={})=>{const method=init.method||(input instanceof Request?input.method:'GET');if([...new Headers(init.headers||(input instanceof Request?input.headers:undefined))].length)throw Error('Office network headers blocked');if(init.body||input instanceof Request&&input.body)throw Error('Office network body blocked');return fetchOriginal(allowed(input,method),{...init,method,credentials:'omit'})}})
 const XHR=self.XMLHttpRequest
 if(XHR){const open=XHR.prototype.open,send=XHR.prototype.send;XHR.prototype.open=function(method,url,...args){if(args[1]!=null||args[2]!=null)throw Error('Office network credentials blocked');return open.call(this,method,allowed(url,method),...args)};XHR.prototype.setRequestHeader=function(){throw Error('Office network headers blocked')};XHR.prototype.send=function(body){if(body!=null)throw Error('Office network body blocked');return send.call(this,null)}}
 for(const key of ['WebSocket','EventSource'])if(key in self)Object.defineProperty(self,key,{configurable:false,writable:false,value:class{constructor(){throw Error('Office network channel blocked')}}})
 if(self.navigator?.sendBeacon)self.navigator.sendBeacon=()=>false
 const OriginalWorker=self.Worker
 if(OriginalWorker)Object.defineProperty(self,'Worker',{configurable:false,writable:false,value:class extends OriginalWorker{constructor(url,options){super(allowed(url),options)}}})
})()
