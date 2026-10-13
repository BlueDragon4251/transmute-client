"""Allowlisted authentication/settings API boundary for client-only Transmute.

File endpoints and unknown API routes are rejected before FastAPI reads request
bodies. Legitimate authentication and configuration requests remain available.
"""
import json

MAX_API_BODY_BYTES = 128 * 1024
ALLOWED_ROOTS = frozenset({
    "users", "api-keys", "oidc", "guest", "settings", "default-formats",
    "default-qualities", "default-compression-levels", "health", "docs",
})


class ClientOnlyBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if not (path == "/api" or path.startswith("/api/")):
            await self.app(scope, receive, send)
            return

        root = path.removeprefix("/api/").split("/", 1)[0].replace("_", "-")
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        content_type = headers.get(b"content-type", b"").lower()
        raw_length = headers.get(b"content-length", b"0")
        try:
            length = int(raw_length)
        except ValueError:
            length = MAX_API_BODY_BYTES + 1

        blocked = (
            root not in ALLOWED_ROOTS
            or b"multipart/" in content_type
            or b"application/octet-stream" in content_type
            or length > MAX_API_BODY_BYTES
        )
        method = scope.get("method", "GET").upper()
        if not blocked and method in {"POST", "PUT", "PATCH"}:
            events = []
            total = 0
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                events.append(event)
                total += len(event.get("body", b""))
                if total > MAX_API_BODY_BYTES:
                    blocked = True
                    break
                if not event.get("more_body", False):
                    break
            if not blocked:
                async def replay():
                    if events:
                        return events.pop(0)
                    return await receive()
                await self.app(scope, replay, send)
                return

        if blocked:
            data = json.dumps({"detail": "Client-only API policy: file processing is disabled"}).encode()
            await send({"type": "http.response.start", "status": 403,
                        "headers": [(b"content-type", b"application/json"),
                                    (b"content-length", str(len(data)).encode()),
                                    (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": data})
            return
        await self.app(scope, receive, send)
