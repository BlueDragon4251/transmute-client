# Locally distributed engines

All JavaScript/WASM runtime assets come from locked dependencies and are served
from this application's origin. `frontend/scripts/prepare-engines.mjs` copies
workers, PDF CMaps/fonts, FFmpeg, WOFF2, OCR, CAD and LibreOffice into the production assets at build
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
| tesseract.js 7.0.0 / tesseract.js-core 7.0.0 | Apache-2.0; https://github.com/naptha/tesseract.js and https://github.com/naptha/tesseract.js-core |
| @tesseract.js-data/eng and /deu 1.0.0 | MIT packaging; Tesseract trained models Apache-2.0; https://github.com/naptha/tessdata and https://github.com/tesseract-ocr/tessdata_best |
| occt-import-js 0.0.23 / OpenCascade | LGPL-2.1 wrapper; OCCT LGPL-2.1 with exception, retained dist/license.occt.txt; https://github.com/kovacsv/occt-import-js |
| @mlightcad/libredwg-web 0.8.0 / LibreDWG | GPL-3.0; https://github.com/mlightcad/libredwg-web and https://github.com/LibreDWG/libredwg |
| dxf-parser 1.1.2 | MIT; https://github.com/gdsestimating/dxf-parser |
| zetajs 1.2.0 | MIT UNO bridge; https://github.com/allotropia/zetajs |
| LibreOffice / ZetaOffice WASM binary | LibreOffice MPL-2.0 / LGPL-3.0-or-later; third-party components have their own notices (LICENSE-LibreOffice.html / NOTICE-LibreOffice.txt), including Qt LGPL/GPL; source links below |
| @ffmpeg/core 0.12.10 | **GPL-2.0-or-later**, includes FFmpeg/codecs; source and build recipe: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build |

The FFmpeg core is a separate locally served WASM program with a message-based
worker interface. Its GPL obligations apply when distributing that core; do not
relabel it as MIT. Keep corresponding source/build instructions available with
redistributions. Dependency license texts are retained in the runtime
`engines/licenses` directory by the build script.

`public/fonts/DejaVuSans.ttf` and `DejaVuSans-Bold.ttf` are subsets of DejaVu Sans (Latin, Greek, Cyrillic,
common punctuation). The original Bitstream/DejaVu license is included beside
it in `LICENSE-DejaVu.txt`. Text outside that coverage fails instead of drawing
missing glyphs. User-provided fonts have their own license/embedding rights.

The pinned WOFF2 JavaScript glue receives a deterministic, fail-closed build patch
(`scripts/patch-woff2.mjs`): three dynamically generated callback wrappers are
replaced with equivalent closures. This keeps `unsafe-eval` out of the CSP. The
WOFF2 WASM binary is unchanged. Browser roundtrips run against this patched glue.

Rich PDF exports embed regular/bold DejaVu fonts. Italic is synthesized by shearing glyphs while preserving the text baseline. Original Office font families are not embedded or fetched.

The pinned LibreOffice bundle is acquired **at build time only**, from the
`wasm-v1.0.0` release of https://github.com/mapo80/libreoffice-web. The four
runtime files match the May 2025 ZetaOffice distribution. Archive and individual
file SHA-256 values are recorded in `frontend/scripts/office-assets.lock.json`;
changed or missing bytes fail the build. No binary is downloaded from another
host when an employee converts a document.

Corresponding ZetaOffice source/build entry points published by its upstream:
- https://git.libreoffice.org/core/+/refs/heads/distro/allotropia/zeta-24-2
- https://git.libreoffice.org/core/+/refs/heads/distro/allotropia/zeta-24-2/static/README.wasm.md
- https://github.com/allotropia/emscripten/commits/fixed-3.1.65
- https://github.com/allotropia/qt5/tree/5.15.2%2Bwasm
- https://github.com/allotropia/qtbase/tree/5.15.2%2Bwasm

Keep these source/build references and the locally served license directory with
redistributions. The binary release mirror does not compile LibreOffice itself;
its release label is not a LibreOffice version number. This application does not
modify the LibreOffice, OpenCascade, LibreDWG or OCR WASM binaries. Its integration
scripts are repository source. LibreDWG and FFmpeg are separate worker programs;
their copyleft licenses must remain visible rather than being replaced by the
application's license.

The main application's CSP permits WASM without JavaScript `unsafe-eval`.
LibreOffice's engine frame/worker and the CAD worker require scoped `unsafe-eval`
for their pinned Emscripten glue. LibreOffice runs with `--headless`, disabled
macros, disabled document updates and a network guard permitting only exact local
engine asset paths, without bodies, custom headers, credentials or query strings.
Its large assets and shared-memory requirements are documented in the format
matrix and deployment guide. The optional structural Office exporter continues
to use the DejaVu font behavior described above; native LibreOffice uses its
bundled fonts and may substitute missing document fonts.

`LICENSE-LibreOffice.html` is generated from the upstream branch's `readlicense_oo/license/license.xml` with its `license_html.xsl`, retaining the comprehensive component notices (some components may not be in this WASM build). MPL, LGPL and GPL texts and upstream NOTICE are also retained locally.
