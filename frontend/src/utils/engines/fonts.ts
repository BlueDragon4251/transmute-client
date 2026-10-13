import { inflateSync, deflateSync } from 'fflate'
import { Font, woff2 } from 'fonteditor-core'
import { asset, checkpoint, extension, result, type ConversionOptions, type Result } from './common'
let initialization: Promise<unknown> | undefined
export async function fontConvert(file: File, to: 'ttf' | 'woff' | 'woff2', options: ConversionOptions): Promise<Result> {
  const bytes = await file.arrayBuffer(), from = extension(file.name)
  const header = new DataView(bytes)
  if (bytes.byteLength < 12) throw Error('Ungültige Schriftdatei')
  // Rebuilding through fonteditor drops variable/color tables. Refuse these fonts.
  if (from === 'ttf' || from === 'otf') {
    const tables = header.getUint16(4)
    for (let i = 0; i < tables; i++) {
      const start = 12 + i * 16
      if (start + 16 > bytes.byteLength) throw Error('Beschädigte Schrifttabelle')
      const tag = String.fromCharCode(...new Uint8Array(bytes, start, 4))
      if (['fvar', 'COLR', 'CBDT', 'sbix', 'SVG '].includes(tag)) throw Error('Variable/Color-Fonts werden zum Schutz vor Datenverlust nicht konvertiert')
    }
  }
  if (from === 'woff2' || to === 'woff2') {
    checkpoint(options, 10, 'Lokale WOFF2-Engine laden')
    initialization ||= woff2.init(asset('engines/woff2.wasm')).catch(error => { initialization = undefined; throw error })
    await initialization
  }
  checkpoint(options, 35, 'Schrift lokal lesen')
  const font = Font.create(bytes, { type: from as 'ttf', hinting: true, inflate: data => Array.from(inflateSync(new Uint8Array(data))) })
  const data = font.get()
  if (!data.glyf?.length) throw Error('Keine unterstützten Schriftkonturen vorhanden')
  checkpoint(options, 60, 'Schrift lokal schreiben')
  const output = font.write({ type: to, hinting: true, deflate: data => Array.from(deflateSync(new Uint8Array(data))) })
  return result(output as ArrayBuffer, to, `font/${to}`)
}
