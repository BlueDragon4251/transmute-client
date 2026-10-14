import { createWorker, OEM, type Worker } from 'tesseract.js'
import { PDFDocument } from 'pdf-lib'
import { asset, checkpoint, extension, result, type ConversionOptions, type Result } from './common'
import { pageIndices } from './pdf'
import { validateImageSource } from './images'

/** Language/core/worker bytes are deployment assets; employee images stay in RAM. */
export async function ocrConvert(file: File, to: 'ocr-txt'|'ocr-pdf', options: ConversionOptions): Promise<Result> {
  if (file.size > 64 * 1024 * 1024) throw Error('OCR-Eingabe überschreitet 64 MiB')
  const language = options.ocrLanguage || 'deu+eng'
  if (!['eng','deu','deu+eng'].includes(language)) throw Error('Nicht lokal installierte OCR-Sprache')
  let worker: Worker | undefined, disposePdf: (() => Promise<void>) | undefined, current = 0, count = 1
  let cancelled = false, rejectAbort: (reason: Error) => void = () => {}
  const interrupted = new Promise<never>((_,reject) => { rejectAbort = reject })
  const abort = () => { cancelled = true; rejectAbort(Error('OCR abgebrochen')); if (worker) void worker.terminate() }
  const timer = setTimeout(() => { cancelled = true; rejectAbort(Error('OCR überschreitet fünf Minuten')); if(worker)void worker.terminate() }, 300000)
  options.signal?.addEventListener('abort', abort, {once:true})
  const race = <T>(operation: Promise<T>) => Promise.race([operation, interrupted])
  try {
    checkpoint(options, 2, 'Lokale OCR-Engine laden')
    const creation = createWorker(language, OEM.LSTM_ONLY, {
      workerPath:asset('engines/ocr/worker.min.js'),corePath:asset('engines/ocr/'),langPath:asset('engines/ocr/languages/'),
      workerBlobURL:false,cacheMethod:'none',gzip:true,
      logger:event => { if (!cancelled && event.status === 'recognizing text') options.onProgress?.(10 + (current + event.progress) / count * 80, `Texterkennung · Seite ${current+1}/${count}`) },
    })
    void creation.then(w => { if(cancelled)void w.terminate() }).catch(() => {})
    worker = await race(creation)
    const output = await PDFDocument.create(),texts:string[] = []
    async function recognize(canvas: HTMLCanvasElement) {
      const recognized = await race(worker!.recognize(canvas, {pdfTextOnly:false}, {text:true,pdf:to==='ocr-pdf'}))
      texts.push(recognized.data.text)
      if (to==='ocr-pdf') {
        if(!recognized.data.pdf)throw Error('OCR-Engine hat keine PDF-Textschicht erzeugt')
        const pagePdf = await PDFDocument.load(new Uint8Array(recognized.data.pdf))
        for(const page of await output.copyPages(pagePdf,pagePdf.getPageIndices()))output.addPage(page)
      }
      canvas.width=canvas.height=0
    }
    if(extension(file.name)==='pdf') {
      const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=asset('engines/pdf.worker.min.mjs')
      const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,cMapUrl:asset('engines/cmaps/'),cMapPacked:true,standardFontDataUrl:asset('engines/standard_fonts/'),wasmUrl:asset('engines/pdf-wasm/')})
      disposePdf=()=>task.destroy()
      const pdf=await race(task.promise),indices=pageIndices(options.pages,pdf.numPages);count=indices.length
      if(count>50)throw Error('OCR verarbeitet höchstens 50 PDF-Seiten pro Auftrag')
      for(const [index,number] of indices.entries()) {
        current=index;checkpoint(options,10+index/count*80,'Scan-PDF lokal rendern')
        const page=await pdf.getPage(number+1),viewport=page.getViewport({scale:2})
        if(viewport.width*viewport.height>20_000_000)throw Error('OCR-Seite überschreitet 20 Megapixel')
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
        try {await race(page.render({canvas,viewport,background:'rgb(255,255,255)'}).promise);await recognize(canvas)} finally {canvas.width=canvas.height=0;page.cleanup()}
      }
    } else {
      await validateImageSource(file)
      const {loadLocalImage}=await import('./images'),image=await loadLocalImage(file)
      try {
        if(image.width*image.height>20_000_000)throw Error('OCR-Bild überschreitet 20 Megapixel')
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
        const ctx=canvas.getContext('2d');if(!ctx)throw Error('Canvas nicht verfügbar')
        ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image.source,0,0)
        try {await recognize(canvas)} finally {canvas.width=canvas.height=0}
      } finally {image.close()}
    }
    checkpoint(options,95,'OCR-Ergebnis lokal speichern')
    const converted=to==='ocr-txt'?result(texts.join('\n\f\n'),'txt','text/plain;charset=utf-8'):result(await output.save(),'pdf','application/pdf')
    return {...converted,warnings:[...(texts.every(text=>!text.trim())?['Kein Text erkannt. Prüfe Bildqualität, Sprache und Seitenwahl.']:[]),'OCR kann Zeichen falsch erkennen. OCR-PDF enthält gerenderte Seiten mit Suchtext; Vektoren, Formulare und Signaturen werden nicht erhalten.']}
  } finally {clearTimeout(timer);options.signal?.removeEventListener('abort',abort);if(worker)await worker.terminate();if(disposePdf)await disposePdf()}
}
