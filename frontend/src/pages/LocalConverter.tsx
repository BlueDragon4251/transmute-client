import { useEffect, useRef, useState } from 'react'

type Format = 'png' | 'jpeg' | 'webp'
const MIME: Record<Format, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif', 'image/avif'])

async function convertImage(file: File, target: Format): Promise<Blob> {
  if (!ACCEPTED.has(file.type)) throw new Error('Eingabeformat wird hier noch nicht unterstützt.')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    // JPEG does not support alpha.
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas nicht verfügbar')
    if (target === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob || blob.type !== MIME[target]) {
          reject(new Error('Dieser Browser unterstützt das gewählte Ausgabeformat nicht.'))
        } else resolve(blob)
      }, MIME[target], 0.92)
    })
  } finally {
    bitmap.close()
  }
}

export default function LocalConverter() {
  const [files, setFiles] = useState<File[]>([])
  const [format, setFormat] = useState<Format>('png')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(0)
  const urls = useRef<string[]>([])
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL) }, [])

  async function run() {
    setBusy(true)
    setError('')
    setDone(0)
    try {
      for (const file of files) {
        const blob = await convertImage(file, format)
        const url = URL.createObjectURL(blob)
        urls.current.push(url)
        const link = document.createElement('a')
        link.href = url
        link.download = file.name.replace(/\.[^.]+$/, '') + '.' + (format === 'jpeg' ? 'jpg' : format)
        document.body.appendChild(link)
        link.click()
        link.remove()
        setDone(count => count + 1)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Konvertierung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6 text-text">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">Transmute Client Only</p>
        <h1 className="mt-2 text-3xl font-bold">Lokal konvertieren</h1>
        <p className="mt-3 text-text-muted">Dateien bleiben in deinem Browser. Keine Datei-Uploads, kein Server-Fallback.</p>
      </div>
      <section className="rounded-2xl border border-surface-dark bg-surface-light/50 p-6 shadow-lg">
        <label htmlFor="local-files" className="block cursor-pointer rounded-xl border-2 border-dashed border-primary/50 p-12 text-center hover:bg-surface-dark/40">
          <span className="block text-lg font-semibold">Dateien auf diesem Gerät auswählen</span>
          <span className="mt-2 block text-sm text-text-muted">PNG, JPEG, WebP, BMP, GIF und AVIF (soweit der Browser sie dekodieren kann)</span>
        </label>
        <input id="local-files" type="file" multiple accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,image/avif" className="sr-only"
          onChange={e => { setFiles(Array.from(e.target.files ?? [])); setDone(0); setError('') }} />
        <div className="mt-6 flex flex-wrap items-end gap-4">
          <div className="flex-1">
            <label htmlFor="local-format" className="mb-2 block text-sm font-semibold">Ausgabeformat</label>
            <select id="local-format" value={format} onChange={e => setFormat(e.target.value as Format)}
              className="w-full rounded-lg border border-surface-dark bg-surface-dark p-3 text-text">
              <option value="png">PNG</option><option value="jpeg">JPEG</option><option value="webp">WebP</option>
            </select>
          </div>
          <button type="button" disabled={!files.length || busy} onClick={run}
            className="rounded-lg bg-primary px-6 py-3 font-bold text-white disabled:opacity-50">
            {busy ? 'Verarbeite lokal…' : 'Lokal konvertieren'}
          </button>
        </div>
        <p className="mt-4 text-sm text-text-muted">{files.length} Datei(en) ausgewählt · {done} verarbeitet</p>
        {error && <p role="alert" className="mt-4 text-red-400">{error}</p>}
      </section>
      <p className="mt-5 text-sm text-text-muted">
        Phase 1: Bilder werden lokal per Browser-Canvas verarbeitet. Animierte Bilder werden nur als Einzelbild exportiert.
        Audio, Video, PDF, Office, Archive und CAD sind noch nicht freigeschaltet.
      </p>
    </div>
  )
}
