export type ConversionOptions = {
  pages?: string; rotation?: number; scale?: number; quality?: number
  signal?: AbortSignal; onProgress?: (value: number, message: string) => void
}
export type Result = { blob: Blob; extension: string; warnings?: string[] }
export const extension = (name: string) => name.split('.').pop()?.toLowerCase() || ''
export const asset = (path: string) => new URL(path, document.baseURI).href
export function result(bytes: Uint8Array | ArrayBuffer | string, extension: string, type = 'application/octet-stream'): Result {
  return { blob: new Blob([typeof bytes === 'string' ? bytes : bytes instanceof Uint8Array ? bytes.slice().buffer as ArrayBuffer : bytes], { type }), extension }
}
export function checkpoint(options: ConversionOptions, value: number, message: string) {
  options.signal?.throwIfAborted()
  options.onProgress?.(value, message)
}
export const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
export function parseXml(source: string): Document {
  if (source.length > 32 * 1024 * 1024) throw Error('XML überschreitet 32 MiB')
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw Error('XML mit DTD/Entities wird abgelehnt')
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw Error('Ungültiges XML')
  return doc
}
