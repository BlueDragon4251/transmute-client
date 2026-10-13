import { inflateSync, deflateSync } from 'fflate'
import core, { Font, woff2 } from 'fonteditor-core'
import { asset, checkpoint, extension, result, type ConversionOptions, type Result } from './common'
let initialization: Promise<unknown> | undefined
export async function fontConvert(file: File, to: 'ttf' | 'woff' | 'woff2', options: ConversionOptions): Promise<Result> {
  let bytes = await file.arrayBuffer()
  const from = extension(file.name)
  if (bytes.byteLength < 12 || bytes.byteLength > 32 * 1024 * 1024) throw Error('Ungültige Schrift oder mehr als 32 MiB')
  if (from === 'woff2' || to === 'woff2') {
    checkpoint(options, 10, 'Lokale WOFF2-Engine laden')
    initialization ||= new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(Error('Lokale WOFF2-Engine konnte nicht initialisiert werden')), 30000)
      woff2.init(asset('engines/woff2.wasm')).then(value => {clearTimeout(timeout);resolve(value)}, error => {clearTimeout(timeout);reject(error)})
    }).catch(error => { initialization = undefined; throw error })
    await initialization
  }
  checkpoint(options, 35, 'Schrift lokal lesen')
  if (['woff','woff2'].includes(from) && (bytes.byteLength < 48 || new DataView(bytes).getUint32(16) > 32 * 1024 * 1024)) throw Error('Entpackte Schrift überschreitet 32 MiB')
  if (from === 'woff') bytes = core.woff2ttf(bytes, { inflate: data => Array.from(inflateSync(new Uint8Array(data))) })
  if (from === 'woff2') bytes = woff2.decode(bytes).slice().buffer as ArrayBuffer
  const header = new DataView(bytes)
  if (bytes.byteLength < 12 || ![0x00010000,0x4f54544f].includes(header.getUint32(0))) throw Error('Unbekannter SFNT-Schrifttyp')
  const tables = header.getUint16(4)
  for (let i = 0; i < tables; i++) {
    const start = 12 + i * 16
    if (start + 16 > bytes.byteLength) throw Error('Beschädigte Schrifttabelle')
    const tag = String.fromCharCode(...new Uint8Array(bytes, start, 4))
    if (['fvar', 'COLR', 'CBDT', 'sbix', 'SVG '].includes(tag)) throw Error('Variable/Color-Fonts werden zum Schutz vor Datenverlust nicht konvertiert')
    if (header.getUint32(start + 8) + header.getUint32(start + 12) > bytes.byteLength) throw Error('Beschädigte Schrifttabellen-Länge')
  }
  // Wrapping static SFNT fonts preserves shaping/layout tables. Only CFF -> TTF
  // requires outline rebuilding; that explicitly documented path is lossy.
  if (to === 'ttf' && header.getUint32(0) === 0x4f54544f) bytes = Font.create(bytes, {type:'otf',hinting:true}).write({type:'ttf',hinting:true}) as ArrayBuffer
  checkpoint(options, 60, 'Schrift lokal schreiben')
  if (to === 'woff') {
    const output = core.ttf2woff(bytes, { metadata: undefined, deflate: data => Array.from(deflateSync(new Uint8Array(data))) })
    // fonteditor's WOFF writer assumes TrueType; preserve the CFF SFNT flavor.
    new DataView(output).setUint32(4, new DataView(bytes).getUint32(0))
    return result(output, to, 'font/woff')
  }
  if (to === 'woff2') return result(woff2.encode(bytes), to, 'font/woff2')
  return result(bytes, to, 'font/ttf')
}
