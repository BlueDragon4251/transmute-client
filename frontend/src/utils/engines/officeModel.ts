import { extension, parseXml } from './common'
import { readZip } from './archives'

export type TextStyle = { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; size?: number }
export type TextPiece = TextStyle & { text: string }
export type EmbeddedImage = { kind: 'image'; data: Uint8Array; width: number; height: number; alt: string }
export type ParagraphBlock = { kind: 'paragraph'; runs: TextPiece[]; align?: 'left'|'center'|'right'|'justify'; heading?: number; pageBreak?: boolean }
export type TableCellModel = { blocks: DocumentBlock[]; span?: number; fill?: string }
export type TableBlock = { kind: 'table'; rows: TableCellModel[][] }
export type DocumentBlock = ParagraphBlock | TableBlock | EmbeddedImage
export type RichDocument = { blocks: DocumentBlock[]; width: number; height: number; margin: number; warnings: string[] }
export const namespaces = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
}
export const elements = (parent: Document | Element, ns: string, name: string) => Array.from(parent.getElementsByTagNameNS(ns, name))
export const child = (parent: Element | undefined, ns: string, name: string): Element | undefined => parent ? Array.from(parent.children).find(e => e.namespaceURI === ns && e.localName === name) : undefined
export const attribute = (element: Element | undefined, ns: string, name: string) => element?.getAttributeNS(ns, name) || ''
export const colorValue = (value: string) => /^[0-9a-f]{6}$/i.test(value.replace(/^#/,'')) ? value.replace(/^#/,'').toUpperCase() : undefined
export function lengthPoints(value: string): number | undefined {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(cm|mm|in|pt|px)?$/.exec(value)
  if (!match) return undefined
  const factors: Record<string,number> = {cm:72/2.54,mm:72/25.4,in:72,pt:1,px:0.75}
  const n = Number(match[1]) * (factors[match[2] || 'pt'] || 1)
  return Number.isFinite(n) ? n : undefined
}
export function localPart(base: string, target: string): string {
  if (/^[a-z][a-z0-9+.-]*:|^\/|^\\/i.test(target)) throw Error('Externe Office-Ressource wird abgelehnt')
  const parts = base.split('/').slice(0,-1)
  for (const part of target.replace(/\\/g,'/').split('/')) {
    if (part === '..') { if (!parts.length) throw Error('Office-Ressource außerhalb des Pakets'); parts.pop() }
    else if (part && part !== '.') parts.push(decodeURIComponent(part))
  }
  if (parts.some(p => p.includes('/') || p === '..')) throw Error('Ungültiger Office-Ressourcenpfad')
  return parts.join('/')
}
export function relationships(entries: Record<string,Uint8Array>, part: string): Map<string,string> {
  const directory = part.split('/').slice(0,-1).join('/'), name = part.split('/').pop()!
  const bytes = entries[(directory ? directory+'/' : '')+'_rels/'+name+'.rels']
  const map = new Map<string,string>()
  if (!bytes) return map
  const xml = parseXml(new TextDecoder().decode(bytes))
  for (const rel of Array.from(xml.getElementsByTagName('Relationship'))) {
    const target = rel.getAttribute('Target') || ''
    if (rel.getAttribute('TargetMode') === 'External') continue
    map.set(rel.getAttribute('Id') || '', localPart(part,target))
  }
  return map
}
export async function packageEntries(file: File): Promise<{ entries: Record<string,Uint8Array>; flat?: Document }> {
  if (extension(file.name).startsWith('fo')) return {entries:{},flat:parseXml(await file.text())}
  return {entries:readZip(new Uint8Array(await file.arrayBuffer()))}
}
export function packageXml(entries: Record<string,Uint8Array>, name: string): Document {
  if (!entries[name]) throw Error('Office-Struktur fehlt: '+name)
  return parseXml(new TextDecoder().decode(entries[name]))
}
export async function embeddedImage(bytes: Uint8Array | undefined, width?: number, height?: number, alt = ''): Promise<EmbeddedImage> {
  if (!bytes || !bytes.length) throw Error('Eingebettetes Office-Bild fehlt; externe Bilder werden nicht geladen')
  const signature = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if (bytes.length >= 24 && signature.getUint32(0) === 0x89504e47 && signature.getUint32(16)*signature.getUint32(20)>40_000_000) throw Error('Office-Bild überschreitet 40 Megapixel')
  const supported = bytes[0]===0x89 && bytes[1]===0x50 || bytes[0]===255 && bytes[1]===216 || bytes[0]===71 && bytes[1]===73 || bytes[0]===66 && bytes[1]===77 || new TextDecoder().decode(bytes.slice(8,12))==='WEBP'
  if (!supported) throw Error('Office-Bildformat nicht unterstützt (nur PNG/JPEG/GIF/BMP/WebP)')
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer]))
  try {
    if (bitmap.width*bitmap.height>40_000_000) throw Error('Office-Bild überschreitet 40 Megapixel')
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas nicht verfügbar');ctx.drawImage(bitmap,0,0)
    const png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Office-Bildexport fehlgeschlagen')),'image/png'))
    return {kind:'image',data:new Uint8Array(await png.arrayBuffer()),width:Math.max(1,Math.min(width||bitmap.width*0.75,2000)),height:Math.max(1,Math.min(height||bitmap.height*0.75,2000)),alt}
  } finally { bitmap.close() }
}
export function blockText(blocks: DocumentBlock[]): string {
  return blocks.map(b=>b.kind==='paragraph' ? b.runs.map(r=>r.text).join('') : b.kind==='image' ? (b.alt ? '[Bild: '+b.alt+']' : '') : b.rows.map(row=>row.map(c=>blockText(c.blocks)).join('\t')).join('\n')).join('\n')
}
export function dataUri(image: EmbeddedImage): string {
  let text='';for(let i=0;i<image.data.length;i+=8192)text+=String.fromCharCode(...image.data.subarray(i,i+8192))
  return 'data:image/png;base64,'+btoa(text)
}

export function positiveCount(value:string,limit=100):number {
  if(!value)return 1
  const count=Number(value)
  if(!Number.isSafeInteger(count)||count<1||count>limit)throw Error('Office-Wiederholung/Zellspanne außerhalb unterstützter Grenzen')
  return count
}
export function boundedTableRows(rows:TableCellModel[][]):void {
  if(rows.length>10000 || rows.reduce((total,row)=>total+row.length,0)>50000)throw Error('Office-Tabelle überschreitet 10000 Zeilen / 50000 Zellen')
  if(rows.some(row=>row.reduce((total,cell)=>total+positiveCount(String(cell.span||1)),0)>256))throw Error('Office-Tabelle überschreitet 256 Spalten')
}
