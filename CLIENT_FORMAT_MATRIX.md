# Browser conversion matrix

The selector exposes the implementations below. No server conversion fallback
exists. Every result is generated from a local File/ArrayBuffer; engines and
fonts are served from this deployment, never from a runtime CDN.

| Input | Offered output / operation | Engine | Fidelity and limits |
|---|---|---|---|
| DOCX, ODT, FODT, DOC, RTF | DOCX, ODT, DOC, RTF, TXT, HTML, PDF | Locally hosted LibreOffice/ZetaOffice WASM; optional structured reader/writers | Default Office/PDF mode uses real Writer import/export filters, including page layout, tables, images, headers/footers and styles. DOC/RTF output and legacy inputs require LibreOffice. Font substitutions and format-specific losses remain possible; macros, external updates and active content are disabled. HTML/TXT use the structural model (legacy inputs first become DOCX); these are not exact page renderings. |
| PPTX, ODP, FODP, PPT | PPTX, ODP, PPT, TXT, HTML, PDF | Locally hosted LibreOffice/Impress WASM; optional structured reader/writers | Default Office/PDF mode preserves supported slide layout, images, charts, grouped objects and themes using Impress filters. Legacy PPT needs LibreOffice. Cross-format animations/proprietary features and fonts may change; no universal 1:1 guarantee. HTML/TXT use the structural model (legacy PPT first becomes PPTX). |
| XLSX, XLS, XLSB, ODS, FODS | XLSX, ODS, XLS, CSV, TSV, JSON, TXT, HTML, PDF | LibreOffice/Calc WASM and SheetJS CE 0.20.3 | Default Office/PDF mode uses Calc's print layout and native file filters. Basic formulas, multiple sheets and XLS formula export are tested. Network-dependent formulas cannot fetch remote data. Data/HTML/TXT exports and optional basis mode use SheetJS: no recalculation; XLS export in **basis mode** refuses formulas. CSV/TSV export the first sheet. Basis PDF creates paginated cell grids. |
| TXT/Markdown/HTML and other text sources | DOCX, ODT, PPTX, ODP, PDF, GZIP | Document writers and pdf-lib | Plain text reflow; markup is not an Office layout model. HTML -> TXT parses text without activating resources/scripts. Text PDF embeds a local DejaVu subset supporting Latin, Greek, Cyrillic and common punctuation. Unsupported characters fail explicitly. |
| PDF | Merge, extract/reorder selected pages, split into PDF ZIP, rotate | pdf-lib | No PDF/A, encryption-removal or guaranteed preservation of digital signatures, forms, bookmarks and document-level metadata. Encrypted inputs fail. Page ranges use `1-3,5`, blank means all. |
| PDF | TXT, PNG/JPEG pages as ZIP | PDF.js | Text-layer extraction, not OCR. Raster page rendering up to 40 million pixels/page. Layout of extracted text can differ from original. |
| PDF, browser-decodable images | OCR TXT, searchable OCR PDF | Tesseract.js 7 / local WASM and English/German models | Real recognition in a local worker. Scan PDFs are rendered at 2x, then recognized; OCR PDFs contain raster pages with an invisible search layer. Recognition can be wrong. No preservation of vectors, interactive forms or signatures. English, German or both; no runtime language downloads from third parties. |
| Browser-decodable raster/SVG | PNG, JPEG, WebP, BMP, ICO, PDF | Canvas + real BMP/ICO writers + pdf-lib | Single frame only; codec availability depends on browser. JPEG white background, BMP flattens alpha, ICO one 256px PNG-backed icon. SVG with external/active content rejected. Images can be combined into one PDF. |
| MP4, MOV, MKV, AVI, WebM, M4V, MPEG/MPG, TS | MP4 (H.264/AAC), WebM (VP8/Opus), MKV (H.264/AAC), GIF; audio extraction | FFmpeg WASM 0.12.10 | Real transcoding in a local worker. First video/audio streams only; subtitles and extra tracks omitted. GIF has no audio. Decode support depends on file codec. HTTPS/localhost required. |
| WAV, MP3, AAC, M4A, OGG, FLAC, Opus, AIFF, WMA | MP3, WAV (PCM16), FLAC, OGG (Vorbis), M4A (AAC), Opus | FFmpeg WASM | First audio stream only. Decoding depends on actual codec. No same-format copy advertised. |
| STL, OBJ, PLY, embedded GLTF, GLB | STL, OBJ, PLY, embedded GLTF, GLB | Three.js loaders/exporters | Triangle meshes; STL/OBJ/PLY lose material/UV/scene features. OBJ does not load MTL sidecars. External GLTF URIs and Draco/Meshopt/Basis compressed resources rejected. No promise to preserve animations/skins. |
| STEP/STP, IGES/IGS, BREP | STL, OBJ, PLY, GLTF, GLB | OpenCascade via occt-import-js 0.0.23 WASM | Real CAD-surface tessellation, linear tolerance 0.1 and angular tolerance 0.5. Output is a mesh; editable solids/features are lost. STEP/IGES normalize to mm; GLTF/GLB export in m. BREP has no stored unit and is treated as mm. External assembly parts are not loaded. |
| DWG | DXF, SVG, JSON, PNG, PDF | LibreDWG WASM 0.8.0 | Actual DWG read and native DXF write. SVG/PNG/PDF are 2D model-space views; PDF/PNG are rasterized. Complex/proprietary entities, layouts, external references and SHX fonts may be omitted. The converter reports unknown entities and refuses empty drawings. No DWG writer. |
| DXF | SVG, JSON, PNG, PDF | dxf-parser and bounded SVG writer | Real parsing; supports common lines, circles/arcs, polylines, ellipses, text and block inserts in a 2D view. Curves are approximated; unsupported entity types are reported. No remote image/font/xref loading. |
| Static TTF, OTF, WOFF, WOFF2 | TTF, WOFF, WOFF2 | fonteditor-core + Google WOFF2 WASM | SFNT wrapping preserves tables; CFF OTF -> TTF approximates cubic outlines and may lose layout/hinting tables. No OTF writer. Variable/color fonts rejected. Respect font embedding/licensing rights. |
| CSV, TSV, JSON, YAML/YML, XML | CSV, TSV, JSON, YAML, XML | Strict delimited parser, js-yaml JSON schema, inert XML parser | Duplicate/empty CSV columns rejected. Nested CSV values encoded as JSON. XML output uses a typed `urn:transmute:data` tree; arbitrary XML imports as a tree with attributes/text. YAML anchors/aliases and XML DTD/entities rejected. |
| Any local files | ZIP, TAR | Local writers | No ZIP64; safe normalized entry names; limits described below. |
| ZIP, TAR | Extract local entries; ZIP <-> TAR | fflate and USTAR reader | No encryption, symlinks, PAX, RAR, 7z. Path traversal rejected. Downloads are individual links or converted archive. |
| Text sources / GZIP | GZIP / decompressed original bytes | CompressionStream / DecompressionStream | Binary-safe decompression; extension restored from `name.ext.gz`, otherwise generic binary extension. |

## Resource limits

- 256 MiB maximum input/result expansion where implemented; archive expansion
  capped at 256 MiB and 2000 entries; no ZIP64.
- Office/text and font input: 32 MiB. XML: 200000 elements / 128 levels. Document tables: 10000 rows / 50000 cells / 256 columns. Spreadsheet PDF: 100000 cells total / 10000 rows per sheet / 256 columns, split into 8-column bands. Images/PDF pages: 40 MP. Meshes: 2 million triangles.
- FFmpeg: single-thread worker, ten-minute execution timeout per file.
- OCR: 64 MiB input, 20 MP/page, 50 selected PDF pages, five-minute deadline.
- CAD: 64 MiB input, two-minute worker deadline, 2 million mesh triangles / 200000 drawing entities.
- LibreOffice: 32 MiB input, five-minute deadline, approximately 250 MiB of local engine assets and 1 GiB shared-memory reservation. Requires HTTPS/localhost and cross-origin isolation; engine is released after 30 seconds idle. Desktop browsers with sufficient RAM are the target.
- Large/complex files can exceed available browser RAM. Failure is reported;
  no file upload or server fallback occurs.
- Abort stops FFmpeg immediately. Synchronous parsers/writers can only observe
  cancellation at their next checkpoint; the browser may briefly be busy.

## Explicitly not offered

Universal lossless Office conversion, macro execution, PDF/A,
DWG output, mesh-to-parametric-STEP reconstruction, OTF creation, RAR/7z extraction, remote sidecar loading,
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

Rich Office regression fixtures (`e2e/rich-office.spec.ts`) check styled runs, headings, images, table spans, slide coordinates/dimensions, selectable PDF text and page breaks. PDF pages are rendered and attached to the CI browser report. The production UI also converts rich DOCX to ODT/PDF under CSP and blocks write/external requests.

Additional engine fixtures (`e2e/extended-engines.spec.ts`, `e2e/native-office.spec.ts`, `e2e/production-engines.spec.ts`) test real OCR/searchable scans, STEP/IGES/BREP triangles, native DWG->DXF parsing, drawing images/PDFs, Writer headers/footers/images/tables, Calc formulas/sheets and Impress chart/layout export. Native Office tests run through the built server and verify same-origin network guards, legacy DOC/XLS/PPT, XLSB, flat ODF and OOXML/ODF roundtrips, startup cancellation and malformed CAD errors.
