import { unzipSync } from 'fflate'
import { tarFiles, zipFiles } from '../localArchives'
import { extension, type Result } from './common'
const LIMIT = 256 * 1024 * 1024
export function safeEntry(name: string): string {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some(s => s === '..') || Array.from(normalized).some(c => c.charCodeAt(0) < 32)) throw Error('Unsicherer Archivpfad')
  return normalized.split('/').filter(s => s && s !== '.').join('/')
}
export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  let size = 0, count = 0
  const entries = unzipSync(bytes, { filter(entry) {
    safeEntry(entry.name)
    size += entry.originalSize; count++
    if (size > LIMIT || count > 2000) throw Error('Archiv zu groß: maximal 256 MiB entpackt / 2000 Einträge')
    return !entry.name.endsWith('/')
  } })
  let actual = 0
  for (const value of Object.values(entries)) actual += value.length
  if (actual > LIMIT) throw Error('Archiv überschreitet Entpacklimit')
  return entries
}
export async function extractArchive(file: File): Promise<File[]> {
  if (extension(file.name) === 'zip') return Object.entries(readZip(new Uint8Array(await file.arrayBuffer()))).map(([name, data]) => new File([data.slice().buffer as ArrayBuffer], safeEntry(name)))
  const bytes = new Uint8Array(await file.arrayBuffer()), decoder = new TextDecoder(), files: File[] = []
  let offset = 0, total = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every(v => v === 0)) break
    const field = (a: number, b: number) => decoder.decode(header.subarray(a, b)).split('\0')[0].trim()
    const stored = parseInt(field(148, 156), 8)
    const checksum = header.reduce((sum, v, i) => sum + (i >= 148 && i < 156 ? 32 : v), 0)
    if (stored !== checksum) throw Error('Ungültige TAR-Prüfsumme')
    const size = parseInt(field(124, 136) || '0', 8)
    const name = safeEntry([field(345, 500), field(0, 100)].filter(Boolean).join('/'))
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) throw Error('Beschädigtes TAR')
    total += size
    if (total > LIMIT || files.length >= 2000) throw Error('TAR überschreitet Entpacklimit')
    if (header[156] === 48 || header[156] === 0) files.push(new File([bytes.slice(offset + 512, offset + 512 + size).buffer], name))
    else if (header[156] !== 53) throw Error('TAR enthält nicht unterstützte Links/PAX-Einträge')
    offset += 512 + Math.ceil(size / 512) * 512
  }
  if (!files.length) throw Error('Archiv enthält keine regulären Dateien')
  return files
}
export async function archiveConvert(file: File, to: string): Promise<Result> {
  const files = await extractArchive(file)
  return { blob: to === 'zip' ? await zipFiles(files) : await tarFiles(files), extension: to }
}
