"""Constrain the SPA, its locally hosted WASM workers, and document resources."""
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "
       "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; "
       "media-src 'self' blob:; object-src 'none'; frame-src 'self'; "
       "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


OFFICE_CSP = ("default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; "
              "worker-src 'self' blob:; connect-src 'self'; img-src data: blob:; "
              "style-src 'unsafe-inline'; font-src data:; frame-src 'none'; "
              "object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'")
CAD_WORKER_CSP = ("default-src 'none'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "
                  "connect-src 'self'; object-src 'none'")

class ClientOnlyHeaders:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def secured(message):
            if message['type'] == 'http.response.start':
                headers = list(message.get('headers', []))
                path = scope.get('path', '')
                policy = OFFICE_CSP if path.endswith(('/engines/office/frame.html', '/engines/office/office-worker.js')) else CAD_WORKER_CSP if path.endswith('/engines/cad-worker.js') else CSP
                headers.extend([(b'content-security-policy', policy.encode()),
                                (b'cross-origin-opener-policy', b'same-origin'),
                                (b'cross-origin-embedder-policy', b'require-corp'),
                                (b'cross-origin-resource-policy', b'same-origin'),
                                (b'x-content-type-options', b'nosniff'),
                                (b'referrer-policy', b'no-referrer'),
                                (b'permissions-policy', b'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()')])
                if scope.get('path', '').startswith('/api/'):
                    headers.append((b'cache-control', b'no-store'))
                message = {**message, 'headers': headers}
            await send(message)
        await self.app(scope, receive, secured)
