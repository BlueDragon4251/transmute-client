import { FFmpeg } from '@ffmpeg/ffmpeg'
import { asset, checkpoint, extension, result, type ConversionOptions, type Result } from './common'
import { audioOutputs } from './capabilities'
const codecs: Record<string, string[]> = {
  mp4: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:a', 'aac', '-movflags', '+faststart'],
  mkv: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-c:a', 'aac'],
  webm: ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '1M', '-c:a', 'libopus'],
  gif: ['-an', '-vf', 'fps=12,scale=640:-1:flags=lanczos', '-loop', '0'],
  mp3: ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'], wav: ['-vn', '-c:a', 'pcm_s16le'],
  flac: ['-vn', '-c:a', 'flac'], ogg: ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
  m4a: ['-vn', '-c:a', 'aac', '-b:a', '192k'], opus: ['-vn', '-c:a', 'libopus', '-b:a', '128k'],
}
export async function mediaConvert(file: File, to: string, options: ConversionOptions): Promise<Result> {
  if (!window.isSecureContext) throw Error('Medien-WASM benötigt HTTPS oder localhost. Caddy mit lokalem TLS verwenden.')
  if (file.size > 256 * 1024 * 1024) throw Error('Medien sind auf 256 MiB pro Datei begrenzt')
  const ffmpeg = new FFmpeg()
  const abort = () => ffmpeg.terminate()
  options.signal?.addEventListener('abort', abort, { once: true })
  // Logs may contain document metadata; keep them only in local memory, never send them.
  const log: string[] = []
  ffmpeg.on('log', ({ message }) => { log.push(message); if (log.length > 12) log.shift() })
  ffmpeg.on('progress', ({ progress }) => checkpoint(options, 15 + Math.min(1, Math.max(0, progress)) * 80, 'Medien lokal kodieren'))
  try {
    checkpoint(options, 2, 'Lokale Medien-Engine laden (ca. 32 MiB)')
    await ffmpeg.load({ classWorkerURL: asset('engines/ffmpeg/worker.js'), coreURL: asset('engines/ffmpeg-core.js'), wasmURL: asset('engines/ffmpeg-core.wasm') })
    checkpoint(options, 15, 'Datei in lokalen WASM-Speicher laden')
    const input = 'input.' + extension(file.name), output = 'output.' + to
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()))
    const audioOnly = audioOutputs.includes(to)
    const status = await ffmpeg.exec(['-hide_banner', '-nostdin', '-i', input, '-map', audioOnly ? '0:a:0' : '0:v:0', ...(!audioOnly && to !== 'gif' ? ['-map', '0:a:0?'] : []), ...codecs[to], '-y', output], 10 * 60 * 1000)
    options.signal?.throwIfAborted()
    if (status !== 0) throw Error('Codec/Datei nicht unterstützt oder Zeitlimit erreicht: ' + log.slice(-3).join(' ').slice(0, 400))
    const bytes = await ffmpeg.readFile(output)
    if (typeof bytes === 'string' || !bytes.length) throw Error('Medien-Engine erzeugte keine Datei')
    return result(bytes, to, to === 'gif' ? 'image/gif' : `${audioOnly ? 'audio' : 'video'}/${to}`)
  } finally { options.signal?.removeEventListener('abort', abort); ffmpeg.terminate() }
}
