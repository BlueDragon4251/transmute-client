"""Constrain the SPA, its locally hosted WASM workers, and document resources."""
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "
       "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; "
       "media-src 'self' blob:; object-src 'none'; frame-src 'none'; "
       "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


class ClientOnlyHeaders:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def secured(message):
            if message['type'] == 'http.response.start':
                headers = list(message.get('headers', []))
                headers.extend([(b'content-security-policy', CSP.encode()),
                                (b'x-content-type-options', b'nosniff'),
                                (b'referrer-policy', b'no-referrer'),
                                (b'permissions-policy', b'camera=(), microphone=(), geolocation=()')])
                if scope.get('path', '').startswith('/api/'):
                    headers.append((b'cache-control', b'no-store'))
                message = {**message, 'headers': headers}
            await send(message)
        await self.app(scope, receive, secured)
