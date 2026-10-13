# Transmute Client-Only (work in progress)

This fork's design goal is to leave employee files on the employee workstation. The Docker host serves UI, auth, and settings, not file conversions.

## Current implementation
- Original auth/admin API and pages retained.
- `backend/client_only_boundary.py` denies server file routes, server conversions, compression, and jobs before multipart bodies are parsed.
- `frontend/src/pages/LocalConverter.tsx` does **not** call backend APIs for file content.
- Local converters implement browser-based raster export (PNG, JPEG, WebP, BMP, ICO) and CSV/TSV/JSON transforms with input validated and no network calls. Other recognized text and PDF files can only be copied, not converted.
- Browser decoding of image formats varies. GIF animation is not preserved; ICO export is a single 256×256 PNG-backed icon.
- Multiple independent employee sessions remain available via upstream account management.

## Privacy limitations (NOT production-ready)
- This work has not yet passed CI/integration or penetration tests.
- The API boundary uses a denylist and size/content-type limits rather than comprehensive request-schema validation; do not assume no file contents can be transmitted through an arbitrary authenticated JSON field. A fully audited allowlist is needed.
- Authentication and settings are sent to the host by design.
- Existing legacy database rows and previously uploaded files are not removed.
- PDF/Office/media/CAD conversion engines, browser WASM tooling, offline caching, CSP hardening, reverse proxy evaluation, memory limits, and accessibility testing are not complete.
- Loading a site from a different host is still a network transfer of website code, not an employee-file upload.

## Test
From `frontend`: `npm ci && npm run build && npm test`.
From `backend` with test requirements installed: `pytest tests/test_client_only_boundary.py`.

No server conversion fallback is acceptable. Do not deploy with sensitive employee documents until the security audit and traffic-level tests pass.
