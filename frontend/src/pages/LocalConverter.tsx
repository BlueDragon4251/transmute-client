import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { convertLocal, formatsFor, type LocalFormat } from '../utils/localConversion'
import { zipFiles, tarFiles } from '../utils/localArchives'

export default function LocalConverter() {
  const { t } = useTranslation()
  const [files, setFiles] = useState<File[]>([])
  const [format, setFormat] = useState<LocalFormat>('png')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<string[]>([])
  const urls = useRef<string[]>([])
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL) }, [])
  const available = files.length ? files.map(formatsFor).reduce((a,b) => a.filter(f=>b.includes(f))) : []
  const selected = available.includes(format) ? format : available[0]

  async function makeArchive(kind: 'zip' | 'tar') {
    if (!files.length) return
    setBusy(true); setError('')
    try {
      const output = kind === 'zip' ? await zipFiles(files) : await tarFiles(files)
      const url = URL.createObjectURL(output)
      urls.current.push(url)
      const link = document.createElement('a'); link.href=url;link.download='files.'+kind
      document.body.appendChild(link);link.click();link.remove()
    } catch(e) {setError(e instanceof Error ? e.message : 'Archivierung fehlgeschlagen')}
    finally {setBusy(false)}
  }

  async function run() {
    if (!selected) return
    setBusy(true); setError(''); setDone(0); setFailed([])
    try {
      for (const file of files) {
        try {
          const output = await convertLocal(file, selected)
          const url = URL.createObjectURL(output.blob)
          urls.current.push(url)
          const link = document.createElement('a')
          link.href = url
          link.download = file.name.replace(/\.[^.]+$/, '') + '.' + output.extension
          document.body.appendChild(link);link.click();link.remove()
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Unbekannter Fehler'
          setFailed(previous => [...previous, file.name + ': ' + message])
        } finally {
          setDone(count => count + 1)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konvertierung fehlgeschlagen')
    } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-4xl p-6 text-text">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">{t('app.name')} Client Only</p>
        <h1 className="mt-2 text-3xl font-bold">Lokal konvertieren</h1>
        <p className="mt-3 text-text-muted">Keine Datei-Uploads. Dateien werden auf diesem Gerät im Browser verarbeitet.</p>
      </div>
      <section className="rounded-2xl border border-surface-dark bg-surface-light/50 p-6 shadow-lg">
        <label htmlFor="local-files" className="block cursor-pointer rounded-xl border-2 border-dashed border-primary/50 p-12 text-center hover:bg-surface-dark/40">
          <span className="block text-lg font-semibold">Dateien lokal auswählen</span>
          <span className="mt-2 block text-sm text-text-muted">Bilder (PNG, JPEG, WebP, GIF, BMP, AVIF, ICO), Textdaten (JSON, CSV, TSV, TXT, HTML, XML, Markdown) und PDF (Kopie)</span>
        </label>
        <input id="local-files" type="file" multiple className="sr-only" onChange={e => {
          setFiles(Array.from(e.target.files ?? []));setDone(0);setFailed([]);setError('')
        }} />
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <label htmlFor="local-format" className="mb-2 block text-sm font-semibold">Ausgabeformat</label>
            <select id="local-format" value={selected || ''} onChange={e => setFormat(e.target.value as LocalFormat)}
              className="w-full rounded-lg border border-surface-dark bg-surface-dark p-3 text-text">
              {available.length===0 && <option value="">Keine gemeinsame Konvertierung verfügbar</option>}
              {available.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
            </select>
          </div>
          <button type="button" disabled={!files.length || !selected || busy} onClick={run}
            className="rounded-lg bg-primary px-6 py-3 font-bold text-white disabled:opacity-50">
            {busy ? 'Verarbeite lokal…' : 'Lokal konvertieren'}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!files.length || busy} onClick={() => makeArchive("zip")} className="rounded-lg border border-primary px-4 py-2 text-primary disabled:opacity-50">Lokal ZIP erstellen</button>
          <button type="button" disabled={!files.length || busy} onClick={() => makeArchive("tar")} className="rounded-lg border border-primary px-4 py-2 text-primary disabled:opacity-50">Lokal TAR erstellen</button>
        </div>
        <p className="mt-4 text-sm text-text-muted" role="status" aria-live="polite">{files.length} Datei(en) ausgewählt · {done} bearbeitet · {failed.length} fehlgeschlagen</p>
        <progress className="mt-2 w-full accent-primary" max={Math.max(files.length, 1)} value={done} aria-label="Batch-Fortschritt" />
        {failed.length > 0 && <div role="alert" className="mt-4 text-red-400"><p className="font-semibold">Fehler bei {failed.length} Dateien:</p><ul className="list-disc pl-5">{failed.map((message, index) => <li key={index}>{message}</li>)}</ul></div>}
        {error && <p role="alert" className="mt-4 text-red-400">{error}</p>}
      </section>
      <p className="mt-5 text-sm text-text-muted">
        Bildexport ist auf Einzelbilder beschränkt. Browser-Unterstützung hängt vom jeweiligen Encoder ab.
        CSV/TSV/JSON werden strukturiert konvertiert. Andere Textdateien und PDFs können nur lokal kopiert werden.
        Nicht unterstützte Formate werden niemals zum Server gesendet.
      </p>
    </div>
  )
}
