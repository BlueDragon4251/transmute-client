# Transmute Client-only – LAN deployment

This deployment offers the currently implemented browser-local converters and
per-user settings/account management. It does **not** support legacy server
converters, PDF/Office/video/CAD/font conversions. See
[`CLIENT_FORMAT_MATRIX.md`](CLIENT_FORMAT_MATRIX.md) for the exact matrix.

## Requirements

- Docker Desktop with Linux containers, or Docker Engine + Compose v2
- Caddy with a trusted local DNS entry (e.g. `transmute.home.arpa`)
- Internal-only access; HTTPS with a CA trusted by each workstation
- A backup destination for the Docker `transmute_client_data` volume

## Build and launch (Windows PowerShell)

```powershell
git clone https://github.com/BlueDragon4251/transmute-client.git
cd transmute-client
git checkout agent/client-only-conversion
docker compose -f docker-compose.client-only.yml config --quiet
docker compose -f docker-compose.client-only.yml up --build -d
docker compose -f docker-compose.client-only.yml ps
Invoke-WebRequest http://127.0.0.1:9040/api/health/ready
```

For upgrades: `git pull --ff-only` and then `docker compose -f
docker-compose.client-only.yml up --build -d`. Back up the named data volume
**before** updating. Never point this Compose project at a legacy volume
containing uploaded employee files: create a fresh volume and migrate only
accounts/settings through an audited migration.

## Caddy already running in Docker on this host

Add this host matcher in the existing `:80` site block (before the catch-all):

```caddyfile
@transmute host transmute transmute.home.arpa
handle @transmute {
    request_body {
        max_size 128KB
    }
    reverse_proxy host.docker.internal:9040
}
```

Caddy's host matcher does not create DNS records: configure
`transmute.home.arpa` to point to the Caddy machine using your local DNS
service, or add an appropriate entry to each workstation's hosts file.
Because the Transmute port is bound to 127.0.0.1, the application itself
is not reachable from other LAN machines outside the reverse proxy.

For production use, enable TLS at Caddy with a certificate trusted on every
workstation, and restrict ingress to the internal network. Check that
`host.docker.internal` resolves from your Caddy container. If Caddy runs
natively on the host instead, use `reverse_proxy 127.0.0.1:9040`.

**Do not enable the above global 128KB limit for static SPA assets**: they
can be much larger than that; this example restricts only request bodies.
The middleware independently caps API request bodies.

## Initial setup

Visit the HTTPS hostname and create the initial admin, then create each
employee account using the Users management page. Guest access remains off by
default. Passwords, names and UI settings are stored server-side. File bytes
are meant to stay on the user's workstation.

## Verify before employee rollout

```powershell
# Must answer with 403; no file bytes uploaded.
curl.exe -i -X POST http://127.0.0.1:9040/api/files/upload
curl.exe -i -X POST http://127.0.0.1:9040/api/jobs
# Must answer with successful JSON when server is ready.
curl.exe -i http://127.0.0.1:9040/api/health/ready
docker compose -f docker-compose.client-only.yml logs --tail 100
```

Also verify Browser DevTools Network and the Caddy access log while doing
an actual file conversion: no POST/PUT/PATCH to any file-processing endpoint
or external domain should occur. The app will still contact its own server
for login, settings and user management. This is a **manual check**, not
formal proof that every allowed JSON field cannot be abused to leak content.

## Limitations and security gates

- No formal network-level non-exfiltration certification has been completed.
- No full payload/schema audit of permitted account/settings routes.
- No complete end-to-end test suite for every listed browser codec.
- Browsers may differ in image/audio encoders and memory limits.
- A trusted HTTPS connection is recommended for browser features and to
  protect credentials; no public exposure or confidential production files
  before a complete data-flow audit.
- Successful CI Docker builds do not prove correct Caddy/DNS/TLS configuration.

The ongoing Draft PR remains unmerged by design.
