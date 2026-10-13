# Host Transmute Client Only on port 9040

## Build/start on Windows PowerShell

```powershell
git clone https://github.com/BlueDragon4251/transmute-client.git
cd transmute-client
git checkout agent/client-only-conversion
docker compose -f docker-compose.client-only.yml config --quiet
docker compose -f docker-compose.client-only.yml up --build -d
docker compose -f docker-compose.client-only.yml ps
curl.exe -fsS http://127.0.0.1:9040/api/health/ready
```

For an existing checkout use `git pull --ff-only`, then repeat `up --build -d`.
The image builds the actual fork locally. Do not use the upstream Transmute image
or upstream Compose file: those still describe server-side conversion.

The service runs as UID 10001, drops Linux capabilities and exposes host
`127.0.0.1:9040` -> container `3313`. The named `transmute_client_data` volume
holds only account/settings SQLite data. Back it up before updates. Use a fresh
volume instead of reusing upstream upload storage; do not erase old data blindly.

## Integrate with your existing `shizzi-caddy` container

After Transmute has started, connect the existing Caddy container to the network
created by its Compose deployment:

```powershell
docker network connect transmute_proxy shizzi-caddy
```

If it says Caddy is already connected, continue. Add this matcher **inside the
existing `:80` block, before its `handle` catch-all**. Keep your PhotoCraft/PDF/
CADCraft matchers in that block as they are:

```caddyfile
@transmute host transmute transmute. transmute.home.arpa
handle @transmute {
    request_body {
        max_size 8KB
    }
    reverse_proxy transmute-client:3313
}
```

This direct Docker-network route works on Windows Docker Desktop and Linux.
It avoids relying on a loopback-published port being reachable through
`host.docker.internal`. To preserve it when Caddy is recreated, declare
`transmute_proxy` as an external network in Caddy's own Compose configuration:

```yaml
services:
  caddy: # use the existing service name
    networks:
      - default
      - transmute_proxy
networks:
  transmute_proxy:
    external: true
    name: transmute_proxy
```

A native Caddy process can instead use `reverse_proxy 127.0.0.1:9040`.

## HTTPS for employee browsers

HTTP on a LAN hostname is not a secure browser context. FFmpeg workers need
HTTPS (localhost is exempt), and passwords should use TLS. Add a separate site
block **outside** the `:80` block:

```caddyfile
transmute.home.arpa {
    tls internal
    request_body {
        max_size 8KB
    }
    reverse_proxy transmute-client:3313
}
```

Caddy must publish ports 80 and 443. Point `transmute.home.arpa` at the Caddy
machine using your local DNS/hosts file. Trust the Caddy local CA on each employee
workstation; do not bypass certificate warnings. On Windows:

```powershell
docker cp shizzi-caddy:/data/caddy/pki/authorities/local/root.crt .\caddy-root.crt
certutil -user -addstore Root .\caddy-root.crt
docker exec shizzi-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec shizzi-caddy caddy reload --config /etc/caddy/Caddyfile
```

Open `https://transmute.home.arpa`. The bare `http://transmute` matcher remains
useful for simple local formats; use HTTPS for the full workspace. Restrict
Caddy ingress to the trusted LAN. These commands assume your existing Caddy
uses the standard `/data` CA path and `/etc/caddy/Caddyfile` mount.

## First admin and employees

Create the first admin in the setup screen. Additional accounts require an
existing admin; use the Users page. Employees cannot manage other users.
Settings are scoped per user; disabled accounts lose access with existing JWTs.

## Verification

```powershell
curl.exe -i -X POST http://127.0.0.1:9040/api/files/upload
curl.exe -i -X POST http://127.0.0.1:9040/api/jobs
# Both must return 403.
docker compose -f docker-compose.client-only.yml logs --tail 50
```

Use local fixtures first. Review `CLIENT_FORMAT_MATRIX.md` before relying on
formatting: Word/Impress/PowerPoint retain supported formatting/images/tables, with warnings for unsupported layout features, and
spreadsheet PDF is a text report. Browser results are downloadable links; no
automatic upload, server processing, filename log or conversion history occurs.

The CI Docker job builds/boots the image, places Caddy in front of it, runs the
production batch/account/download tests, inspects proxy logs and checks that no
file-storage directories exist. Passing CI verifies fixtures, not every possible
file or the DNS/certificates/firewall of your own network. PR #1 remains Draft;
no merge is required to host the working branch.
