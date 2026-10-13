import { PDFDocument, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { zipFiles } from '../localArchives'
import { asset, checkpoint, result, type ConversionOptions, type Result } from './common'

export function pageIndices(spec: string | undefined, count: number): number[] {
  if (!spec?.trim()) return Array.from({ length: count }, (_, i) => i)
  const indices: number[] = []
  for (const part of spec.split(',')) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part)
    if (!match) throw Error('Seitenbereich: z. B. 1-3,5')
    const a = Number(match[1]), b = Number(match[2] || a)
    if (a < 1 || b < a || b > count) throw Error(`Seitenbereich außerhalb 1–${count}`)
    for (let i = a; i <= b; i++) if (!indices.includes(i - 1)) indices.push(i - 1)
  }
  return indices
}

export async function textPdf(text: string, options: ConversionOptions = {}): Promise<Result> {
  checkpoint(options, 10, 'PDF-Schrift laden')
  const response = await fetch(asset('fonts/DejaVuSans.ttf'))
  if (!response.ok) throw Error('Lokale PDF-Schrift fehlt')
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await response.arrayBuffer(), { subset: true })
  const supported = new Set(font.getCharacterSet())
  for (const c of text) if (!/[\r\n\t]/.test(c) && !supported.has(c.codePointAt(0)!)) throw Error('Zeichen nicht in der eingebetteten PDF-Schrift vorhanden')
  let page = pdf.addPage([595.28, 841.89]), y = 790
  for (const line of text.replace(/\r/g, '').replace(/\t/g, '    ').split('\n')) {
    let wrapped = ''
    for (const char of line) {
      if (font.widthOfTextAtSize(wrapped + char, 11) > 495) {
        if (y < 50) { page = pdf.addPage([595.28, 841.89]); y = 790 }
        page.drawText(wrapped, { x: 50, y, size: 11, font }); y -= 16; wrapped = ''
      }
      wrapped += char
    }
    if (y < 50) { page = pdf.addPage([595.28, 841.89]); y = 790 }
    if (wrapped) page.drawText(wrapped, { x: 50, y, size: 11, font })
    y -= 16
  }
  checkpoint(options, 90, 'PDF speichern')
  return result(await pdf.save(), 'pdf', 'application/pdf')
}

export async function imagesPdf(files: File[], options: ConversionOptions = {}): Promise<Result> {
  const pdf = await PDFDocument.create()
  for (const [i, file] of files.entries()) {
    checkpoint(options, i / files.length * 90, 'Bild in PDF einbetten')
    await (await import('./images')).validateImageSource(file)
    const bitmap = await createImageBitmap(file)
    try {
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      if (canvas.width * canvas.height > 40_000_000) throw Error('Bild überschreitet 40 Megapixel')
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('PNG-Export fehlgeschlagen')), 'image/png'))
      const image = await pdf.embedPng(await png.arrayBuffer())
      const scale = Math.min(495 / image.width, 742 / image.height, 1)
      const page = pdf.addPage([595.28, 841.89]); page.drawImage(image, { x: 50, y: 50, width: image.width * scale, height: image.height * scale })
    } finally { bitmap.close() }
  }
  return result(await pdf.save(), 'pdf', 'application/pdf')
}

export async function mergePdfs(files: File[], options: ConversionOptions = {}): Promise<Result> {
  const pdf = await PDFDocument.create()
  for (const [i, file] of files.entries()) {
    checkpoint(options, i / files.length * 90, 'PDF zusammenführen')
    const source = await PDFDocument.load(await file.arrayBuffer())
    for (const page of await pdf.copyPages(source, source.getPageIndices())) pdf.addPage(page)
  }
  if (!pdf.getPageCount()) throw Error('Keine PDF-Seiten vorhanden')
  return result(await pdf.save(), 'pdf', 'application/pdf')
}

export async function transformPdf(file: File, to: string, options: ConversionOptions): Promise<Result> {
  if (['pdf-extract', 'pdf-split', 'pdf-rotate'].includes(to)) {
    const source = await PDFDocument.load(await file.arrayBuffer())
    const indices = pageIndices(options.pages, source.getPageCount())
    if (to === 'pdf-split') {
      const files: File[] = []
      for (const i of indices) {
        checkpoint(options, files.length / indices.length * 90, 'PDF aufteilen')
        const pdf = await PDFDocument.create(); pdf.addPage((await pdf.copyPages(source, [i]))[0])
        files.push(new File([(await pdf.save()).slice().buffer as ArrayBuffer], `page-${i + 1}.pdf`))
      }
      return { blob: await zipFiles(files), extension: 'zip' }
    }
    const pdf = await PDFDocument.create()
    for (const page of await pdf.copyPages(source, indices)) {
      if (to === 'pdf-rotate') page.setRotation(degrees((page.getRotation().angle + (options.rotation || 90)) % 360))
      pdf.addPage(page)
    }
    return result(await pdf.save(), 'pdf', 'application/pdf')
  }
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = asset('engines/pdf.worker.min.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false,
    cMapUrl: asset('engines/cmaps/'), cMapPacked: true, standardFontDataUrl: asset('engines/standard_fonts/'), wasmUrl: asset('engines/pdf-wasm/') })
  const abort = () => { void task.destroy() }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    const pdf = await task.promise
    const indices = pageIndices(options.pages, pdf.numPages), outputs: File[] = [], text: string[] = []
    for (const [index,i] of indices.entries()) {
      checkpoint(options, index / indices.length * 90, 'PDF-Seite lesen')
      const page = await pdf.getPage(i + 1)
      if (to === 'txt') {
        const content = await page.getTextContent()
        let value = '', previous: {str:string;width:number;height:number;transform:number[];hasEOL?:boolean} | undefined
        for (const item of content.items) {
          if (!('str' in item)) continue
          if (previous) {
            const lineChanged = previous.hasEOL || Math.abs(item.transform[5]-previous.transform[5]) > Math.max(item.height,previous.height)*0.6
            if (lineChanged && !value.endsWith('\n')) value+='\n'
            else if (!lineChanged && !/\s$/.test(value) && !/^\s/.test(item.str) && item.transform[4]-(previous.transform[4]+previous.width)>Math.max(0.1,item.height*0.12)) value+=' '
          }
          value+=item.str; previous=item
        }
        text.push(value)
      } else {
        const viewport = page.getViewport({ scale: options.scale || 1.5 })
        if (viewport.width * viewport.height > 40_000_000) throw Error('PDF-Seite überschreitet 40 Megapixel')
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport }).promise
        const type = to === 'pdf-jpeg' ? 'image/jpeg' : 'image/png'
        const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('PDF-Bildexport fehlgeschlagen')), type, 0.92))
        outputs.push(new File([image], `page-${i + 1}.${to === 'pdf-jpeg' ? 'jpg' : 'png'}`))
        canvas.width = canvas.height = 0
      }
      page.cleanup()
    }
    return to === 'txt' ? result(text.join('\n\n'), 'txt', 'text/plain;charset=utf-8') : { blob: await zipFiles(outputs), extension: 'zip' }
  } finally { options.signal?.removeEventListener('abort', abort); await task.destroy() }
}
