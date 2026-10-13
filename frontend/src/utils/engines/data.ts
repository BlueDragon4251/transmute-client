import { load, dump, JSON_SCHEMA } from 'js-yaml'
import { parseXml, xmlEscape } from './common'
const NS = 'urn:transmute:data'
function valueXml(value: unknown, key?: string): string {
  const attr = key === undefined ? '' : ` key="${xmlEscape(key)}"`
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (type === 'object') return `<value type="object"${attr}>${Object.entries(value as object).map(([k,v])=>valueXml(v,k)).join('')}</value>`
  if (type === 'array') return `<value type="array"${attr}>${(value as unknown[]).map(v=>valueXml(v)).join('')}</value>`
  return `<value type="${type}"${attr}>${value === null ? '' : xmlEscape(String(value))}</value>`
}
function taggedValue(element: Element): unknown {
  const type = element.getAttribute('type')
  if (type === 'object') return Object.fromEntries(Array.from(element.children).map(e=>[e.getAttribute('key') || '',taggedValue(e)]))
  if (type === 'array') return Array.from(element.children).map(taggedValue)
  if (type === 'null') return null
  if (type === 'number') {const value=Number(element.textContent);if(!Number.isFinite(value))throw Error('Ungültige XML-Zahl');return value}
  if (type === 'boolean') return element.textContent === 'true'
  return element.textContent || ''
}
function genericXml(element: Element): unknown {
  if (!element.children.length && !element.attributes.length) return element.textContent || ''
  const object: Record<string,unknown> = {}
  if (element.attributes.length) object.$attributes=Object.fromEntries(Array.from(element.attributes).map(a=>[a.name,a.value]))
  for (const child of Array.from(element.children)) {
    const v=genericXml(child)
    if (child.tagName in object) object[child.tagName] = Array.isArray(object[child.tagName]) ? [...object[child.tagName] as unknown[],v] : [object[child.tagName],v]
    else object[child.tagName]=v
  }
  const text=Array.from(element.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()
  if(text)object.$text=text
  return object
}
export function readData(source: string, type: string): unknown {
  if (type === 'json') return JSON.parse(source)
  if (type === 'yaml' || type === 'yml') {
    if (/(^|[\s[{,])[&*][\w-]+/m.test(source)) throw Error('YAML-Anker/Aliase werden zum Schutz vor Expansion abgelehnt')
    return load(source,{schema:JSON_SCHEMA})
  }
  const root=parseXml(source).documentElement
  return root.namespaceURI===NS && root.localName==='json' ? taggedValue(root.children[0]) : {[root.tagName]:genericXml(root)}
}
export function writeData(value: unknown, type: string): string {
  if(type==='yaml')return dump(value,{schema:JSON_SCHEMA,noRefs:true,lineWidth:100})
  if(type==='xml')return `<?xml version="1.0" encoding="UTF-8"?><json xmlns="${NS}">${valueXml(value)}</json>`
  return JSON.stringify(value,null,2)
}
