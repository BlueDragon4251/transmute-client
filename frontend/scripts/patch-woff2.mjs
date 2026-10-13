// The pinned Emscripten embind glue builds callbacks with Function(). Replace
// its three wrapper generators with equivalent closures; WASM remains unchanged.
import { readFile, writeFile } from 'node:fs/promises'
const file = new URL('../node_modules/fonteditor-core/woff2/woff2.js', import.meta.url)
let source = await readFile(file,'utf8')
if(source.includes('/* transmute-csp-closures-v2 */')) process.exit(0)
if(!source.includes('/* transmute-csp-closures */')) {
  const named = /return new Function\("body",[\s\S]*?\)\(body\)/
  const call = 'return new Function("dynCall","rawFunction",body)(dynCall,rawFunction)'
  if(!named.test(source) || !source.includes(call) || (source.match(/new Function/g)||[]).length!==2) throw Error('WOFF2 glue changed; review CSP patch')
  source=source.replace(named,'return function(){return body.apply(this,arguments)}')
  source=source.replace(call,'return function(){return dynCall.apply(null,[rawFunction].concat(Array.prototype.slice.call(arguments)))}')
}
const start=source.indexOf('function craftInvokerFunction('), end=source.indexOf('function __embind_register_class_function',start)
if(start<0 || end<0 || !source.slice(start,end).includes('new_(Function,args1)')) throw Error('WOFF2 embind changed; review CSP patch')
const wrapper=`function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){
  var argCount=argTypes.length;
  if(argCount<2)throwBindingError('argTypes array size mismatch');
  var isMethod=argTypes[1]!==null&&classType!==null, needsStack=false;
  for(var i=1;i<argCount;i++)if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined)needsStack=true;
  return function(){
    if(arguments.length!==argCount-2)throwBindingError('function '+humanName+' called with '+arguments.length+' arguments, expected '+(argCount-2));
    var destructors=needsStack?[]:null, wired=[cppTargetFunc], converted=[];
    if(isMethod){converted[1]=argTypes[1].toWireType(destructors,this);wired.push(converted[1]);}
    for(var i=2;i<argCount;i++){converted[i]=argTypes[i].toWireType(destructors,arguments[i-2]);wired.push(converted[i]);}
    var rv=cppInvokerFunc.apply(null,wired);
    if(needsStack)runDestructors(destructors);
    else for(var i=isMethod?1:2;i<argCount;i++)if(argTypes[i].destructorFunction!==null)argTypes[i].destructorFunction(converted[i]);
    if(argTypes[0].name!=='void')return argTypes[0].fromWireType(rv);
  };
}`
source=source.slice(0,start)+wrapper+source.slice(end)
if(/new Function|new_\(Function/.test(source))throw Error('Unpatched dynamic WOFF2 code')
await writeFile(file,'/* transmute-csp-closures-v2 */\n'+source)
