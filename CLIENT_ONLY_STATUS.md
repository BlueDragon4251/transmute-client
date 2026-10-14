# Client-only implementation

Real browser engines now include locally hosted LibreOffice-WASM Writer/Calc/Impress, OCR, STEP/IGES/BREP and DWG/DXF processing alongside the structured Office basis mode, spreadsheet data and paginated PDF cell grids,
PDF editing/rendering/text, FFmpeg audio/video, raster images, triangle meshes,
static fonts, structured data and ZIP/TAR/GZIP. See `CLIENT_FORMAT_MATRIX.md`
for exact fidelity, unsupported features and resource limits.

The server registers only accounts/authentication/settings/health APIs. It has
no file, job or conversion endpoints/workers. The API boundary denies unknown
routes, multipart/binary bodies, non-API writes, unknown payload fields and
oversized account/settings fields. CSP restricts network resources to this host;
no update checker, telemetry or runtime CDN is used. No filenames or conversion
history are sent by the converter. Local download URLs are revoked on clear and
unmount. Credentials and profile/settings data are intentionally server-side.

This is an application data-flow property, not a claim that a malicious user
cannot encode information in a username/password. Use only trusted deployments
and browsers. SSO, when configured, intentionally communicates account identity
with the administrator's provider; never document contents.

The rootless Docker image installs only account/settings dependencies, removes
unused converter/service implementations from the image, and persists SQLite
account/settings data. Port 9040 is mapped to internal 3313. Existing Caddy
can join `transmute_proxy` and proxy directly to `transmute-client:3313`.

Validation commands:
- `cd frontend && npm ci && npm run build && npm test`
- `npx playwright install --with-deps chromium firefox && npm run test:e2e`
- `PYTHONPATH=backend python -m pytest --noconftest -q backend/tests/test_client_only_boundary.py backend/tests/test_client_only_headers.py`
- `docker compose -f docker-compose.client-only.yml up --build -d`

The Draft PR stays open and unmerged as requested. CI artifacts include browser
traces for failures and a workspace screenshot. Consult the latest commit's CI
rather than assuming an older green run covers new edits.

Native Office runs in a sandboxed same-origin engine frame. Its fetch/XHR guards permit only known engine assets, without queries or request bodies; macros and external updates are disabled via typed UNO loading properties and security configuration. Clipboard permissions are denied inside that frame. Main-app CSP still forbids JavaScript unsafe-eval. The Office frame/worker and CAD worker receive narrow engine-specific CSP exceptions required by their runtime bindings. COOP/COEP/CORP enable shared memory; no external CDN runs in employee browsers.

LibreOffice assets are fetched at build time from a fixed release and checked against a locked archive SHA-256 and four individual file hashes. The release mirror's bytes match the ZetaOffice distribution. The generated assets/cache are excluded from git; Docker embeds the verified assets.
