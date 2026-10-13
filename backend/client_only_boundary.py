"""Fail-closed file boundary for the client-only Transmute fork.

This ASGI layer rejects file-oriented API traffic *before* FastAPI parses
multipart bodies or any upload route can write them to disk.
It is deliberately independent of the original server converter stack.
"""
import json

BLOCKED_ROOTS = frozenset({
    "files", "conversions", "compressions", "jobs", "compression-jobs",
    "compression_jobs", "downloaders",
})
# The frontend must not use server-backed conversion, even if a route is added.
MAX_API_BODY_BYTES = 128 * 1024


class ClientOnlyBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        if not (path == "/api" or path.startswith("/api/")):
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_type = headers.get(b"content-type", b"").lower()
        length_raw = headers.get(b"content-length", b"0")
        try:
            length = int(length_raw)
        except ValueError:
            length = MAX_API_BODY_BYTES + 1

        route_root = path.removeprefix("/api/").split("/", 1)[0].replace("_", "-")
        blocked = (
            route_root in {r.replace("_", "-") for r in BLOCKED_ROOTS}
            or b"multipart/" in content_type
            or b"application/octet-stream" in content_type
            or length > MAX_API_BODY_BYTES
        )

        # Reject binary uploads sent with a false/absent Content-Type too,
        # without ever buffering more than the maximum allowed request body.
        if not blocked and method in {"POST", "PUT", "PATCH"}:
            events = []
            total = 0
            while True:
                event = await receive()
                events.append(event)
                if event["type"] == "http.disconnect":
                    return
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
            data = json.dumps({
                "detail": "Server-side files and conversions are disabled in client-only mode"
            }).encode("utf-8")
            await send({"type": "http.response.start", "status": 403,
                        "headers": [(b"content-type", b"application/json"),
                                    (b"content-length", str(len(data)).encode()),
                                    (b"cache-control", b"no-store")]})
            await send({"type": "http.response.body", "body": data})
            return

        await self.app(scope, receive, send)
