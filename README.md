# Transmute Client Only

Self-hosted conversion workspace for employees. Files are processed exclusively
in the browser. The server serves the app and manages accounts, authentication
and settings. There are no server file/conversion/job APIs and no runtime CDN.

This fork continues Transmute on **`agent/client-only-conversion`**. Draft
[PR #1](https://github.com/BlueDragon4251/transmute-client/pull/1) remains unmerged.
Use this branch and the dedicated client-only Compose file when hosting it.

```powershell
git clone https://github.com/BlueDragon4251/transmute-client.git
cd transmute-client
git checkout agent/client-only-conversion
docker compose -f docker-compose.client-only.yml up --build -d
```

The local endpoint is **http://127.0.0.1:9040**. For employees on the LAN, add
the existing Caddy container to `transmute_proxy` and use trusted HTTPS at
`transmute.home.arpa`. Full commands for the existing `shizzi-caddy` setup are
in [DEPLOY_CLIENT_ONLY.md](DEPLOY_CLIENT_ONLY.md).

| Area | Browser functionality |
|---|---|
| Office documents / slides | LibreOffice-WASM Writer/Impress import/export, including DOC/RTF/PPT, Office/PDF layouts, headers/footers/images/tables/charts; optional fast basis mode |
| Spreadsheets | XLSX/ODS/XLS data conversion, multiple sheets, supported formulas, CSV/TSV/JSON/HTML/text and paginated PDF grids |
| PDF | Create, merge, extract/reorder, split, rotate, rasterize, extract text; local English/German OCR and searchable scan PDFs |
| Video / audio | Local FFmpeg-WASM MP4/WebM/MKV/GIF and MP3/WAV/FLAC/OGG/M4A/Opus |
| CAD / 3D | STL/OBJ/PLY/embedded GLTF/GLB; STEP/IGES/BREP tessellation; DWG->DXF/SVG/JSON and local 2D raster/PDF views |
| Fonts | Static TTF/OTF/WOFF/WOFF2 input; TTF/WOFF/WOFF2 output |
| Images / data / archives | Browser raster exports, JSON/CSV/TSV/YAML/XML, ZIP/TAR creation/extraction/conversion, binary-safe GZIP |

The workspace supports heterogeneous batches, per-file targets, progress,
errors, cancellation, explicit local downloads and an all-results ZIP.
Accounts and settings are isolated per employee; only admins manage users.

**Read the [format matrix](CLIENT_FORMAT_MATRIX.md).** The default Office/PDF mode now uses a complete LibreOffice WASM engine. It preserves substantially more layout, but font substitutions and format-specific losses remain possible. HTML/text and the fast basis mode use the structural model. OCR can misrecognize text; CAD meshes lose solid parameters. PDF/A, new DWG files, OTF creation and RAR/7z are not offered.

Current desktop Chromium (Chrome/Edge family) and Firefox are covered by browser
fixtures. Safari, mobile and every possible codec/file variant are not certified.
Media and the native Office engine require HTTPS or localhost. Office also requires COOP/COEP isolation headers (included by the server). Large jobs are limited by browser RAM;
per-file and expansion limits are documented in the matrix.

[Client-only design and tests](CLIENT_ONLY_STATUS.md) ·
[Locally distributed engines and licenses](THIRD_PARTY_ENGINES.md) ·
[Actions](https://github.com/BlueDragon4251/transmute-client/actions)

The upstream project is [transmute-app/transmute](https://github.com/transmute-app/transmute).
Its legacy source remains for history/tests, but server conversion engines and
services are absent from the dedicated runtime image. Do not deploy the upstream
image or legacy Compose/Dockerfile for this client-only application.
