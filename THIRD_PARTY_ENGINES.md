# Locally distributed engines

All JavaScript/WASM runtime assets come from locked dependencies and are served
from this application's origin. `frontend/scripts/prepare-engines.mjs` copies
workers, PDF CMaps/fonts, FFmpeg and WOFF2 into the production assets at build
time. No document-processing dependency is fetched from a CDN at runtime.

| Package | License / upstream |
|---|---|
| pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1 | MIT; https://github.com/Hopding/pdf-lib and https://github.com/Hopding/fontkit |
| pdfjs-dist 5.4.624 | Apache-2.0; https://github.com/mozilla/pdf.js |
| xlsx 0.20.3 (official SheetJS tarball) | Apache-2.0; https://git.sheetjs.com/sheetjs/sheetjs |
| docx 9.5.1 | MIT; https://github.com/dolanmiu/docx |
| pptxgenjs 4.0.1 | MIT; https://github.com/gitbrent/PptxGenJS |
| three 0.180.0 | MIT; https://github.com/mrdoob/three.js |
| fonteditor-core 2.6.3 | MIT; https://github.com/kekee000/fonteditor-core |
| fflate 0.8.2 | MIT; https://github.com/101arrowz/fflate |
| js-yaml 4.1.1 | MIT; https://github.com/nodeca/js-yaml |
| @ffmpeg/ffmpeg 0.12.15 | MIT wrapper; https://github.com/ffmpegwasm/ffmpeg.wasm |
| @ffmpeg/core 0.12.10 | **GPL-2.0-or-later**, includes FFmpeg/codecs; source and build recipe: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build |

The FFmpeg core is a separate locally served WASM program with a message-based
worker interface. Its GPL obligations apply when distributing that core; do not
relabel it as MIT. Keep corresponding source/build instructions available with
redistributions. Dependency license texts are retained in the runtime
`engines/licenses` directory by the build script.

`public/fonts/DejaVuSans.ttf` is a subset of DejaVu Sans (Latin, Greek, Cyrillic,
common punctuation). The original Bitstream/DejaVu license is included beside
it in `LICENSE-DejaVu.txt`. Text outside that coverage fails instead of drawing
missing glyphs. User-provided fonts have their own license/embedding rights.

The pinned WOFF2 JavaScript glue receives a deterministic, fail-closed build patch
(`scripts/patch-woff2.mjs`): three dynamically generated callback wrappers are
replaced with equivalent closures. This keeps `unsafe-eval` out of the CSP. The
WOFF2 WASM binary is unchanged. Browser roundtrips run against this patched glue.
