import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { convertLocal, formatsFor, type LocalFormat } from '../utils/localConversion'
import { zipFiles, tarFiles } from '../utils/localArchives'
import { extension } from '../utils/engines/common'

type Item = { id: number; file: File; format: LocalFormat | ''; state: 'ready'|'running'|'done'|'error'; progress: number; message: string }
type Download = { file: File; url: string }
const labels: Partial<Record<LocalFormat, string>> = { 'pdf-extract': 'PDF · Seiten extrahieren', 'pdf-split': 'PDF · einzelne Seiten als ZIP', 'pdf-rotate': 'PDF · Seiten drehen', 'pdf-png': 'PNG · alle Seiten als ZIP', 'pdf-jpeg': 'JPEG · alle Seiten als ZIP', 'ocr-txt': 'OCR · Text erkennen', 'ocr-pdf': 'OCR · durchsuchbares PDF', gunzip: 'GZIP entpacken · Originalformat' }
const formatLabel = (format: LocalFormat) => labels[format] || format.toUpperCase()
function formatNotice(file: File): string {
  const ext = extension(file.name)
  if (['docx','odt','fodt'].includes(ext)) return 'Dokumente: Absätze, Überschriften, grundlegende Textformatierung, Rasterbilder und Tabellen werden übernommen. Der genauere Export übernimmt auch Seitenlayout und Kopf-/Fußzeilen. Schriftarten und komplexe Importfilter können abweichen; der Basisexport erhält weniger Details. Verluste erscheinen als Hinweise.'
  if (['pptx','odp','fodp'].includes(ext)) return 'Folien: Textformatierung, Positionen, Rasterbilder, einfache Formen und Tabellen. Der genauere Export übernimmt auch unterstützte Diagramme und Master-Layouts. Schriftarten, Animationen und komplexe Importfilter können abweichen; Hinweise werden pro Ergebnis angezeigt.'
  if (['xlsx','xls','xlsb','ods','fods','csv','tsv'].includes(ext)) return 'Tabellen: Der genauere Office-Export nutzt Layout, Druckbereiche und Formelberechnung von LibreOffice. Externe Daten und Makros bleiben gesperrt. Der Basisexport verwendet Werte und gespeicherte Formelergebnisse; CSV/TSV exportiert das erste Blatt.'
  if (['doc','rtf','ppt'].includes(ext)) return 'Dieses ältere Office-Format benötigt den genaueren Office-Export auf HTTPS/localhost. Makros und externe Nachlade-Ressourcen werden gesperrt.'
  if (['step','stp','iges','igs','brep'].includes(ext)) return 'CAD-Körper werden lokal als Mesh trianguliert. Körperparameter gehen verloren; STEP/IGES werden auf Millimeter normalisiert, GLTF/GLB auf Meter. Externe Bauteile werden nicht geladen.'
  if (['dwg','dxf'].includes(ext)) return 'Zeichnungen: DXF-/Datenexport und 2D-Ansicht. Proprietäre Objekte, Layouts und Schriftformen können abweichen. Externe Referenzen werden nicht geladen; keine DWG-Ausgabe.'
  if (ext === 'pdf') return 'PDF-Bilder enthalten alle ausgewählten Seiten als ZIP. TXT liest die Textschicht; OCR erkennt Text in Scans (Deutsch/Englisch). OCR-PDF rendert Seiten neu und kann Erkennungsfehler enthalten. Änderungen können digitale Signaturen ungültig machen. Geschützte PDFs werden abgelehnt.'
  if (['stl','obj','ply','gltf','glb'].includes(ext)) return '3D-Meshes: STL/OBJ/PLY verlieren Materialien, UVs und Szenenfunktionen. GLTF muss Ressourcen einbetten. Keine externen Ressourcen oder Kompressions-Erweiterungen.'
  if (['ttf','otf','woff','woff2'].includes(ext)) return 'Statische Kontur-Schriften: TTF/WOFF/WOFF2. CFF-OTF wird in quadratische Konturen umgewandelt; Layouttabellen können verloren gehen. Variable/Color-Fonts und OTF-Ausgabe sind nicht unterstützt.'
  if (['mp4','mov','mkv','avi','webm','m4v','mpeg','mpg','ts','wav','mp3','aac','m4a','ogg','flac','opus','aiff','wma'].includes(ext)) return 'FFmpeg-WASM: lokale Kodierung; HTTPS/localhost erforderlich. Maximal 256 MiB und 10 Minuten Laufzeit pro Datei. Nur erste Video-/Audiospur; Untertitel/weitere Spuren gehen verloren. GIF ohne Ton.'
  if (file.type.startsWith('image/') || ['svg','png','jpg','gif','avif','bmp','ico'].includes(ext)) return 'Bildexport: Einzelbild; Animation geht verloren. JPEG/BMP ohne Transparenz. ICO: ein 256px-Symbol. Decoder abhängig vom Browser; SVG mit aktiven/externen Ressourcen wird abgelehnt.'
  if (['zip','tar'].includes(ext)) return 'Archive: ZIP/TAR ohne Verschlüsselung; 256 MiB entpackt und 2000 Einträge. Links, PAX und unsichere Pfade werden abgelehnt. Dateinamen werden beim Erstellen für Downloads normalisiert.'
  return 'Text-PDF und Office-Export setzen den Text neu. Keine Ausführung von HTML, XML, Makros oder Skripten.'
}

export default function LocalConverter() {
  const { t } = useTranslation()
  const [items, setItems] = useState<Item[]>([])
  const [downloads, setDownloads] = useState<Download[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pages, setPages] = useState('')
  const [rotation, setRotation] = useState(90)
  const [officeEngine,setOfficeEngine] = useState<'libreoffice'|'structured'>('libreoffice')
  const [ocrLanguage,setOcrLanguage] = useState<'eng'|'deu'|'deu+eng'>('deu+eng')
  const [globalFormat, setGlobalFormat] = useState<LocalFormat | ''>('')
  const controller = useRef<AbortController | null>(null)
  const urls = useRef<string[]>([]), sequence = useRef(0)
  useEffect(() => () => { controller.current?.abort(); urls.current.forEach(URL.revokeObjectURL) }, [])
  const hasOffice = items.some(i=>['docx','odt','fodt','doc','rtf','xlsx','xls','xlsb','ods','fods','pptx','odp','fodp','ppt'].includes(extension(i.file.name)))
  const hasOcr = items.some(i=>formatsFor(i.file).includes('ocr-txt'))
  const files = items.map(i => i.file)
  const common = items.length ? items.map(i => formatsFor(i.file)).reduce((a,b) => a.filter(f => b.includes(f))) : []
  const completed = items.filter(i => ['done','error'].includes(i.state)).length
  const overall = items.length ? items.reduce((sum,i) => sum + i.progress, 0) / items.length : 0
  const patch = (id: number, update: Partial<Item>) => setItems(previous => previous.map(i => i.id === id ? {...i,...update} : i))
  function add(files: File[]) {
    setError('')
    setItems(previous => [...previous, ...files.map(file => ({ id: ++sequence.current, file, format: formatsFor(file)[0] || '', state: 'ready' as const, progress: 0, message: '' }))])
  }
  function addDownload(file: File) {
    const url = URL.createObjectURL(file); urls.current.push(url)
    setDownloads(previous => [...previous, {file,url}])
  }
  function clear() {
    urls.current.forEach(URL.revokeObjectURL); urls.current = []
    setDownloads([]); setItems([]); setError('')
  }
  async function batch() {
    const abort = new AbortController(); controller.current = abort
    setBusy(true); setError('')
    try {
      for (const item of items) {
        if (abort.signal.aborted) break
        if (!item.format) { patch(item.id, {state:'error',progress:100,message:'Für diese Datei ist kein Konverter verfügbar'}); continue }
        patch(item.id, {state:'running',progress:0,message:'Lokal vorbereiten'})
        try {
          const output = await convertLocal(item.file, item.format, { pages, rotation, officeEngine, ocrLanguage, signal: abort.signal, onProgress: (progress,message) => patch(item.id,{progress,message}) })
          const name = item.file.name.replace(/\.[^.]+$/, '') + '.' + output.extension
          addDownload(new File([output.blob],name,{type:output.blob.type}))
          patch(item.id,{state:'done',progress:100,message:'Fertig · Download bereit'+(output.warnings?.length?' · Hinweise: '+output.warnings.join(' '):'')})
        } catch (e) { patch(item.id,{state:'error',progress:100,message:abort.signal.aborted ? 'Abgebrochen' : e instanceof Error ? e.message : 'Konvertierung fehlgeschlagen'}) }
      }
    } finally { controller.current = null; setBusy(false) }
  }
  async function group(action: 'zip'|'tar'|'merge'|'images'|'extract'|'results') {
    setBusy(true); setError(''); const abort = new AbortController(); controller.current = abort
    try {
      if (action === 'extract') {
        for (const file of files) { abort.signal.throwIfAborted(); for (const extracted of await (await import('../utils/engines/archives')).extractArchive(file)) addDownload(extracted) }
      } else {
        const output = action === 'merge' ? (await (await import('../utils/engines/pdf')).mergePdfs(files, {signal:abort.signal})).blob
          : action === 'images' ? (await (await import('../utils/engines/pdf')).imagesPdf(files,{signal:abort.signal})).blob
          : action === 'tar' ? await tarFiles(files)
          : await zipFiles(action === 'results' ? downloads.map(d => d.file) : files)
        addDownload(new File([output], action === 'merge' || action === 'images' ? 'combined.pdf' : action === 'tar' ? 'files.tar' : 'files.zip', {type:output.type}))
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Verarbeitung fehlgeschlagen') }
    finally { controller.current = null; setBusy(false) }
  }
  const button = 'rounded-xl border border-primary/40 px-4 py-2 text-sm font-semibold text-primary-light hover:bg-primary/10 disabled:opacity-40'
  return <div className="mx-auto max-w-6xl p-4 sm:p-8 text-text">
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-light">Transmute · Browser Workspace</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Dateien lokal konvertieren</h1>
        <p className="mt-3 max-w-2xl text-text-muted">Office, PDF, Medien, Bilder, 3D, Schriften und Archive. Verarbeitung auf diesem Gerät; Downloads bleiben unter deiner Kontrolle.</p></div>
      <span className="rounded-full border border-success/30 bg-success/10 px-4 py-2 text-sm font-semibold text-success">Keine Datei-Uploads</span>
    </div>
    <section className="rounded-2xl border border-surface-light bg-surface-dark/60 p-5 sm:p-7">
      <label htmlFor="local-files" onDragOver={e => {e.preventDefault()}} onDrop={e => {e.preventDefault(); if(!busy) add(Array.from(e.dataTransfer.files))}}
        className={`block cursor-pointer rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-8 text-center hover:bg-primary/10 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
        <span className="block text-xl font-semibold">Dateien auswählen oder hier ablegen</span>
        <span className="mt-2 block text-sm text-text-muted">Batch mit verschiedenen Dateitypen · maximal 256 MiB pro Datei · keine Server-Konvertierung</span>
      </label>
      <input id="local-files" type="file" multiple disabled={busy} className="sr-only" onChange={e => {add(Array.from(e.target.files || []));e.target.value=''}} />
      {!!items.length && <>
        <div className="my-5 flex flex-wrap items-center gap-3">
          <label htmlFor="batch-format" className="text-sm font-semibold">Batch-Ziel</label>
          <select id="batch-format" disabled={busy} value={common.includes(globalFormat as LocalFormat) ? globalFormat : ''} className="rounded-lg bg-surface-light p-2" onChange={e => {const format=e.target.value as LocalFormat;setGlobalFormat(format);setItems(previous => previous.map(i=>({...i,format})))}}>
            <option value="">Individuell pro Datei</option>{common.map(f=><option key={f} value={f}>{formatLabel(f)}</option>)}
          </select>
          <button disabled={busy} onClick={clear} className={button}>Alles entfernen</button>
        </div>
        <ul className="space-y-3">{items.map(item => <li key={item.id} className="rounded-xl border border-surface-light bg-surface-light/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1"><p className="break-all font-semibold">{item.file.name}</p><p className="mt-1 text-xs text-text-muted">{(item.file.size/1024/1024).toFixed(2)} MiB · {extension(item.file.name).toUpperCase() || 'Unbekannt'}</p></div>
            <select aria-label={`Ausgabe für ${item.file.name}`} disabled={busy} value={item.format} onChange={e => patch(item.id,{format:e.target.value as LocalFormat})} className="max-w-full rounded-lg bg-surface-light p-2">
              {!item.format && <option value="">Nicht unterstützt</option>}{formatsFor(item.file).map(f=><option key={f} value={f}>{formatLabel(f)}</option>)}
            </select>
            <button disabled={busy} aria-label={`Entfernen ${item.file.name}`} className={button} onClick={()=>setItems(previous=>previous.filter(i=>i.id!==item.id))}>×</button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-text-muted">{formatNotice(item.file)}</p>
          <progress className="mt-3 w-full accent-primary" max={100} value={item.progress} aria-label={`Fortschritt ${item.file.name}`} />
          {item.message && <p role={item.state==='error'?'alert':'status'} className={`mt-1 text-sm ${item.state==='error'?'text-red-400':'text-text-muted'}`}>{item.message}</p>}
        </li>)}</ul>
        {(hasOffice||hasOcr) && <div className="mt-5 flex flex-wrap gap-4 rounded-xl bg-surface-light/30 p-4">
          {hasOffice && <label className="text-sm">Office/PDF-Export<select aria-label={t("localConverter.officeEngine", "Office-Engine")} value={officeEngine} disabled={busy} onChange={e=>setOfficeEngine(e.target.value as 'libreoffice'|'structured')} className="mt-2 block rounded-lg bg-surface-light p-2"><option value="libreoffice">Genaueres Layout · mehr Speicher</option><option value="structured">Schneller Basisexport</option></select></label>}
          {hasOcr && <label className="text-sm">OCR-Sprache<select aria-label={t("localConverter.ocrLanguage", "OCR-Sprache")} value={ocrLanguage} disabled={busy} onChange={e=>setOcrLanguage(e.target.value as 'eng'|'deu'|'deu+eng')} className="mt-2 block rounded-lg bg-surface-light p-2"><option value="deu+eng">Deutsch + Englisch</option><option value="deu">Deutsch</option><option value="eng">Englisch</option></select></label>}
        </div>}
        {files.some(f=>extension(f.name)==='pdf') && <div className="mt-5 flex flex-wrap gap-4 rounded-xl bg-surface-light/30 p-4">
          <label className="text-sm">PDF-Seiten (leer = alle)<input aria-label={t("localConverter.pages", "PDF-Seiten")} value={pages} disabled={busy} onChange={e=>setPages(e.target.value)} placeholder={t("localConverter.pageExample", "1-3,5")} className="mt-2 block rounded-lg bg-surface-light p-2" /></label>
          <label className="text-sm">Drehung<select aria-label={t("localConverter.rotation", "PDF-Drehung")} value={rotation} disabled={busy} onChange={e=>setRotation(Number(e.target.value))} className="mt-2 block rounded-lg bg-surface-light p-2">{[90,180,270].map(v=><option key={v} value={v}>{v}°</option>)}</select></label>
        </div>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button disabled={busy || !items.some(i=>i.format)} onClick={batch} className="rounded-xl bg-primary px-6 py-3 font-bold text-white hover:brightness-110 disabled:opacity-40">{busy?'Verarbeite lokal…':'Batch konvertieren'}</button>
          {busy && <button className={button} onClick={()=>controller.current?.abort()}>Abbrechen</button>}
          <button disabled={busy} className={button} onClick={()=>group('zip')}>ZIP erstellen</button>
          <button disabled={busy} className={button} onClick={()=>group('tar')}>TAR erstellen</button>
          {files.every(f=>extension(f.name)==='pdf') && <button disabled={busy} className={button} onClick={()=>group('merge')}>PDFs zusammenführen</button>}
          {files.every(f=>f.type.startsWith('image/') && extension(f.name)!=='svg') && <button disabled={busy} className={button} onClick={()=>group('images')}>Bilder in ein PDF</button>}
          {files.every(f=>['zip','tar'].includes(extension(f.name))) && <button disabled={busy} className={button} onClick={()=>group('extract')}>Archiv entpacken</button>}
        </div>
        <p role="status" aria-live="polite" className="mt-5 text-sm text-text-muted">{completed}/{items.length} bearbeitet · {items.filter(i=>i.state==='error').length} Fehler · {Math.round(overall)}%</p>
      </>}
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-red-400">{error}</p>}
    </section>
    {!!downloads.length && <section className="mt-6 rounded-2xl border border-success/25 bg-surface-dark/60 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Lokale Ergebnisse</h2><button disabled={busy} onClick={()=>group('results')} className={button}>Ergebnisse als ZIP</button></div>
      <ul className="mt-4 space-y-2">{downloads.map((d,i)=><li key={d.url} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-light/30 p-3"><span className="break-all text-sm">{i+1}. {d.file.name} · {(d.file.size/1024).toFixed(1)} KiB</span><a download={d.file.name.replace(/[/\\]/g,'_')} href={d.url} className={button}>Herunterladen</a></li>)}</ul>
      <p className="mt-4 text-xs text-text-muted">Ergebnisse liegen nur im Arbeitsspeicher dieses Tabs. Vor dem Schließen herunterladen.</p>
    </section>}
    <details className="mt-6 rounded-2xl border border-surface-light p-5 text-sm text-text-muted"><summary className="cursor-pointer font-semibold text-text">Unterstützung und Grenzen</summary>
      <p className="mt-3 leading-relaxed">Der genauere Office/PDF-Export lädt eine große lokale Engine, benötigt mehr Arbeitsspeicher und setzt HTTPS/localhost voraus. HTML-/Textausgabe verwendet das strukturierte Modell. Die Auswahlliste zeigt echte lokale Konverter. DOCX/ODT erhalten grundlegende Formatierung, Bilder und Tabellen; PPTX/ODP übernehmen unterstützte Folienobjekte und Positionen. Komplexe Office-Layouts bleiben eingeschränkt. OCR, CAD-Körper und DWG-Zeichnungen haben eigene lokale Engines. PDF/A, OTF-Erstellung, RAR/7z und neue DWG-Dateien werden nicht angeboten. Beschädigte, verschlüsselte oder vom Decoder nicht unterstützte Dateien erhalten einen Fehler.</p>
      <p className="mt-3 leading-relaxed">Aktuelle Desktop-Browser verwenden. Medien und komplexe Dateien brauchen Arbeitsspeicher und können länger dauern. Der Server speichert nur Konten und Einstellungen; keine Dateinamen, Konvertierungshistorie oder Inhalte.</p>
    </details>
  </div>
}
