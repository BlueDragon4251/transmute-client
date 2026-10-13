# Client-only format matrix (13 October 2026)

This matrix is deliberately conservative. "Implemented" means a browser code
path exists, **not** that all codecs, browsers, test suites, or files pass.
No server-side fallback is allowed.

| Input | Output | Engine | Implementation | Verification |
|---|---|---|---|---|
| PNG/JPEG/WebP/GIF/BMP/ICO/SVG and browser-decodable images | PNG/JPEG/WebP | createImageBitmap + Canvas | Implemented, single frame | Automated browser tests and codec matrix outstanding |
| Browser-decodable images | BMP | Browser Canvas + BMP writer | Implemented, 24-bit | Browser verification outstanding |
| Browser-decodable images | ICO | Canvas PNG + ICO container | Implemented, single 256px icon | Browser verification outstanding |
| CSV/TSV/JSON | CSV/TSV/JSON | TypeScript structured parser/writer | Implemented | Unit tests exist; CI confirmation outstanding |
| Text formats | TXT | Browser text reader | Implemented (plain-text extraction only) | Format/content semantics not guaranteed |
| JSON/CSV/TSV/text | GZ | CompressionStream | Implemented, browser dependent | Round-trip and browser tests outstanding |
| GZ | TXT | DecompressionStream | Implemented, treats decompressed bytes as text | Encoding and archive format tests outstanding |
| MP3/WAV/AAC/M4A/OGG/FLAC/Opus (browser dependent) | WAV | Web Audio decodeAudioData + PCM encoder | Implemented | Per-codec browser verification outstanding |
| One or more arbitrary files | ZIP | Local ZIP writer, store method | Implemented, no ZIP64 | Unit tests exist; external extractor check outstanding |
| One or more arbitrary files | TAR | Local USTAR writer | Implemented | Unit tests exist; external extractor check outstanding |
| PDF | PDF | — | Not advertised; no conversion | Not supported |
| PDF | Images, Office, text | — | Not supported | — |
| DOC/DOCX/XLS/XLSX/PPT/PPTX/ODT/ODS/ODP | Other formats | — | Not supported | — |
| Video (MP4/MOV/AVI/MKV/WebM etc.) | Video/audio | — | Not supported | — |
| ZIP/TAR/7z/RAR | Extraction/other archive | — | Not supported (ZIP/TAR creation only) | — |
| TTF/OTF/WOFF/WOFF2 | Font conversion | — | Not supported | — |
| STL/OBJ/STEP/DXF/DWG/GLTF/GLB | CAD/3D conversion | — | Not supported | — |

## Production blockers

- Route allowlisting does **not** establish that allowed JSON request schemas cannot
  carry file contents or document metadata; payload-level auditing is still needed.
- Need reproducible browser E2E tests proving zero requests with file bytes,
  including network capture at the reverse proxy and negative API cases.
- Legacy converter packages remain in the repository, but the dedicated
  Dockerfile.client-only installs only account/settings dependencies. No file,
  job or conversion router is registered; middleware also rejects their paths.
  The minimal image must still pass runtime smoke tests.
- The new minimal rootless Docker image requires a successful boot, health,
  negative API and reverse-proxy integration test before deployment.
- Existing database/volume contents are not migrated or securely erased.
- Browser codec and WASM engine coverage is nowhere near maximal yet.

## Local Caddy

Use `docker compose -f docker-compose.client-only.yml up --build -d`.
Configure the existing Caddy instance for a dedicated local hostname:

```caddy
transmute.home.arpa {
    reverse_proxy host.docker.internal:3313
}
```

This example assumes Caddy itself is in Docker and host.docker.internal resolves.
Expose Caddy only on the trusted LAN, not the converter container port. Run
under HTTPS for an appropriate browser secure context. Keep access control and
reverse-proxy request-size limits enabled. **Do not put confidential files into
this unfinished deployment until network and schema audits have passed.**
