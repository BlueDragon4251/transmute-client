# Browser conversion matrix

The selector exposes the implementations below. No server conversion fallback
exists. Every result is generated from a local File/ArrayBuffer; engines and
fonts are served from this deployment, never from a runtime CDN.

| Input | Offered output / operation | Engine | Fidelity and limits |
|---|---|---|---|
| DOCX, ODT, FODT | DOCX, ODT, TXT, HTML, PDF | XML package reader, docx, ODF writer, pdf-lib | **Text-content reflow.** Paragraph text only; no original formatting, images, table geometry, headers, tracked changes or pagination. Not an Office rendering engine. |
| PPTX, ODP, FODP | PPTX, ODP, TXT, HTML, PDF | XML package reader, PptxGenJS, ODF writer | **Text-content reflow.** Text grouped in slide order. No original placement, images, charts, masters, transitions or animations. Long text may create additional PPTX slides. |
| XLSX, XLS, XLSB, ODS, FODS | XLSX, ODS, XLS, CSV, TSV, JSON, TXT, HTML, PDF | SheetJS CE 0.20.3 | Cell values, multiple sheets and supported formulas; not full styling/charts/macros. Formulas are not recalculated. **XLS export refuses workbooks containing formulas** because the writer would drop them. CSV/TSV exports first sheet; JSON includes all sheets; PDF is a plain text report. |
| TXT/Markdown/HTML and other text sources | DOCX, ODT, PPTX, ODP, PDF, GZIP | Document writers and pdf-lib | Plain text reflow; markup is not an Office layout model. HTML -> TXT parses text without activating resources/scripts. Text PDF embeds a local DejaVu subset supporting Latin, Greek, Cyrillic and common punctuation. Unsupported characters fail explicitly. |
| PDF | Merge, extract/reorder selected pages, split into PDF ZIP, rotate | pdf-lib | No OCR, PDF/A, encryption-removal or guaranteed preservation of digital signatures, forms, bookmarks and document-level metadata. Encrypted inputs fail. Page ranges use `1-3,5`, blank means all. |
| PDF | TXT, PNG/JPEG pages as ZIP | PDF.js | Text-layer extraction, not OCR. Raster page rendering up to 40 million pixels/page. Layout of extracted text can differ from original. |
| Browser-decodable raster/SVG | PNG, JPEG, WebP, BMP, ICO, PDF | Canvas + real BMP/ICO writers + pdf-lib | Single frame only; codec availability depends on browser. JPEG white background, BMP flattens alpha, ICO one 256px PNG-backed icon. SVG with external/active content rejected. Images can be combined into one PDF. |
| MP4, MOV, MKV, AVI, WebM, M4V, MPEG/MPG, TS | MP4 (H.264/AAC), WebM (VP8/Opus), MKV (H.264/AAC), GIF; audio extraction | FFmpeg WASM 0.12.10 | Real transcoding in a local worker. First video/audio streams only; subtitles and extra tracks omitted. GIF has no audio. Decode support depends on file codec. HTTPS/localhost required. |
| WAV, MP3, AAC, M4A, OGG, FLAC, Opus, AIFF, WMA | MP3, WAV (PCM16), FLAC, OGG (Vorbis), M4A (AAC), Opus | FFmpeg WASM | First audio stream only. Decoding depends on actual codec. No same-format copy advertised. |
| STL, OBJ, PLY, embedded GLTF, GLB | STL, OBJ, PLY, embedded GLTF, GLB | Three.js loaders/exporters | Triangle meshes; STL/OBJ/PLY lose material/UV/scene features. OBJ does not load MTL sidecars. External GLTF URIs and Draco/Meshopt/Basis compressed resources rejected. No promise to preserve animations/skins. |
| Static TTF, OTF, WOFF, WOFF2 | TTF, WOFF, WOFF2 | fonteditor-core + Google WOFF2 WASM | SFNT wrapping preserves tables; CFF OTF -> TTF approximates cubic outlines and may lose layout/hinting tables. No OTF writer. Variable/color fonts rejected. Respect font embedding/licensing rights. |
| CSV, TSV, JSON, YAML/YML, XML | CSV, TSV, JSON, YAML, XML | Strict delimited parser, js-yaml JSON schema, inert XML parser | Duplicate/empty CSV columns rejected. Nested CSV values encoded as JSON. XML output uses a typed `urn:transmute:data` tree; arbitrary XML imports as a tree with attributes/text. YAML anchors/aliases and XML DTD/entities rejected. |
| Any local files | ZIP, TAR | Local writers | No ZIP64; safe normalized entry names; limits described below. |
| ZIP, TAR | Extract local entries; ZIP <-> TAR | fflate and USTAR reader | No encryption, symlinks, PAX, RAR, 7z. Path traversal rejected. Downloads are individual links or converted archive. |
| Text sources / GZIP | GZIP / decompressed original bytes | CompressionStream / DecompressionStream | Binary-safe decompression; extension restored from `name.ext.gz`, otherwise generic binary extension. |

## Resource limits

- 256 MiB maximum input/result expansion where implemented; archive expansion
  capped at 256 MiB and 2000 entries; no ZIP64.
- Office/text and font input: 32 MiB. Images/PDF pages: 40 MP. Meshes: 2 million triangles.
- FFmpeg: single-thread worker, ten-minute execution timeout per file.
- Large/complex files can exceed available browser RAM. Failure is reported;
  no file upload or server fallback occurs.
- Abort stops FFmpeg immediately. Synchronous parsers/writers can only observe
  cancellation at their next checkpoint; the browser may briefly be busy.

## Explicitly not offered

Binary DOC/PPT, full-fidelity Office rendering, macro execution, OCR, PDF/A,
DWG/STEP conversion, OTF creation, RAR/7z extraction, remote sidecar loading,
server-side codecs and universal preservation of every format feature.

## Verification

`frontend/e2e/engines.spec.ts` checks real browser outputs using independent
readers: PDF page count/rotation/text/rendering, Office XML packages and text
roundtrips, table cells/formulas/sheets, mesh roundtrips, font glyph counts,
archive bytes, image signatures and FFprobe media streams. It blocks external
requests and write requests during engine conversion.

`frontend/e2e/app.spec.ts` exercises the production build: bootstrap, admin/member
permissions, isolated user settings, disabled accounts, blocked upload routes,
mixed batch, local PDF download, CSP and network recording. CI runs the built
Docker image behind Caddy, scans access logs for the fixture marker and asserts
that no upload/output/chunk directories exist. See Actions for the latest result;
fixture success does not certify every possible input file.
