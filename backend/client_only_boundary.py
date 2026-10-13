"""Fail-closed network boundary: no employee document bytes reach an API route.

This middleware protects the legacy application while the server conversion
stack is removed. It is not a substitute for an audit of the allowed JSON
schemas: authentication, profiles and settings necessarily transmit user data.
"""
import json
import re

MAX_API_BODY_BYTES = 128 * 1024
# Match the entire route, not just its root. Unknown future endpoints remain off.
_ALLOWED = {
    "GET": (
        r"/api/health/(?:info|live|ready)",
        r"/api/users/(?:bootstrap-status|me|[0-9a-fA-F-]{36})",
        r"/api/api-keys(?:/[0-9a-fA-F-]{36})?",
        r"/api/oidc/(?:config|login|callback)",
        r"/api/settings(?:/themes)?",
        r"/api/settings/themes/[a-zA-Z0-9_-]{1,80}",
        r"/api/default-(?:formats|qualities|compression-levels)(?:/[a-zA-Z0-9_-]{1,80})?",
    ),
    "POST": (
        r"/api/users(?:/token|/authenticate)?",
        r"/api/oidc/exchange",
        r"/api/guest/session",
        r"/api/api-keys",
        r"/api/settings/themes",
    ),
    "PATCH": (
        r"/api/users/(?:me|[0-9a-fA-F-]{36})",
        r"/api/settings",
    ),
    "PUT": (
        r"/api/settings/themes/[a-zA-Z0-9_-]{1,80}",
        r"/api/default-(?:formats|qualities|compression-levels)",
        r"/api/default-(?:formats|qualities|compression-levels)/[a-zA-Z0-9_-]{1,80}",
    ),
    "DELETE": (
        r"/api/users/[0-9a-fA-F-]{36}",
        r"/api/api-keys/[0-9a-fA-F-]{36}",
        r"/api/settings/themes/[a-zA-Z0-9_-]{1,80}",
        r"/api/default-(?:formats|qualities|compression-levels)/[a-zA-Z0-9_-]{1,80}",
    ),
}
_ALLOWED = {method: tuple(re.compile(r"^" + pattern + r"/?$") for pattern in paths)
            for method, paths in _ALLOWED.items()}


async def deny(send, status=403):
    data = json.dumps({"detail": "Client-only API policy: route or content rejected"}).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(data)).encode()),
                            (b"cache-control", b"no-store")]})
    await send({"type": "http.response.body", "body": data})


class ClientOnlyBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        kind = scope.get("type")
        path = scope.get("path", "")
        # WebSocket must never bypass the HTTP policy, including non-API paths.
        if kind == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if kind != "http":
            await self.app(scope, receive, send)
            return
        if not (path == "/api" or path.startswith("/api/")):
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        if not any(pattern.fullmatch(path) for pattern in _ALLOWED.get(method, ())):
            await deny(send)
            return
        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        content_type = headers.get(b"content-type", b"").split(b";", 1)[0].strip().lower()
        if content_type in (b"multipart/form-data", b"application/octet-stream") or content_type.startswith(b"multipart/"):
            await deny(send)
            return
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            await deny(send)
            return
        if length < 0 or length > MAX_API_BODY_BYTES:
            await deny(send)
            return
        if method in ("POST", "PATCH", "PUT"):
            # Only URL-encoded login, JSON and requests without a declared type.
            if content_type not in (b"", b"application/json", b"application/x-www-form-urlencoded"):
                await deny(send)
                return
            events = []
            total = 0
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                events.append(event)
                total += len(event.get("body", b""))
                if total > MAX_API_BODY_BYTES:
                    await deny(send)
                    return
                if not event.get("more_body", False):
                    break

            async def replay():
                if events:
                    return events.pop(0)
                return await receive()

            await self.app(scope, replay, send)
            return
        await self.app(scope, receive, send)
