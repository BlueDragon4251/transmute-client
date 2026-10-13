"""Boundary contract tests. No application database required."""
import asyncio
import json

from client_only_boundary import ClientOnlyBoundary


async def invoke(path, method="POST", headers=None, chunks=(b"",)):
    calls = []
    async def downstream(scope, receive, send):
        calls.append("reached")
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    events = [{"type": "http.request", "body": c, "more_body": i < len(chunks) - 1}
              for i, c in enumerate(chunks)]
    async def receive():
        return events.pop(0) if events else {"type": "http.disconnect"}

    responses = []
    async def send(message):
        responses.append(message)

    scope = {"type": "http", "path": path, "method": method,
             "headers": list((headers or {}).items())}
    await ClientOnlyBoundary(downstream)(scope, receive, send)
    return responses[0]["status"], calls


def test_file_upload_denied_before_app():
    status, calls = asyncio.run(invoke("/api/files/upload", headers={
        b"content-type": b"multipart/form-data; boundary=test",
    }))
    assert status == 403 and not calls


def test_server_job_denied():
    status, calls = asyncio.run(invoke("/api/jobs", headers={
        b"content-type": b"application/json",
    }))
    assert status == 403 and not calls


def test_chunked_body_limit():
    status, calls = asyncio.run(invoke("/api/users/login", headers={
        b"content-type": b"application/json",
    }, chunks=(b"x" * 65536, b"x" * 65536, b"x")))
    assert status == 403 and not calls


def test_small_account_request_remains_possible():
    status, calls = asyncio.run(invoke("/api/users/login", headers={
        b"content-type": b"application/json",
    }, chunks=(json.dumps({"username": "test", "password": "test"}).encode(),)))
    assert status == 204 and calls == ["reached"]


def test_unknown_api_route_denied():
    status, calls = asyncio.run(invoke("/api/new-file-upload-service", headers={
        b"content-type": b"application/json",
    }, chunks=(b'{"file":"sensitive"}',)))
    assert status == 403 and not calls


def test_auth_multipart_denied():
    status, calls = asyncio.run(invoke("/api/users/login", headers={
        b"content-type": b"multipart/form-data; boundary=x",
    }))
    assert status == 403 and not calls


def test_disallow_unknown_nested_account_and_settings_paths():
    for path in ("/api/users/me/upload", "/api/settings/upload",
                 "/api/settings/themes/a/import", "/api/guest/upload",
                 "/api/files", "/api/conversions", "/api/default-formats/import"):
        status, calls = asyncio.run(invoke(path, headers={
            b"content-type": b"application/json",
        }, chunks=(b'{"data":"file contents"}',)))
        assert status == 403 and not calls, path


def test_disallow_method_tunneling_and_media_types():
    for headers in (
        {b"content-type": b"application/octet-stream"},
        {b"content-type": b"multipart/mixed; boundary=x"},
        {b"content-type": b"image/png"},
        {b"content-length": b"-1"},
    ):
        status, calls = asyncio.run(invoke("/api/users/me", method="PATCH",
                                          headers=headers, chunks=(b"secret",)))
        assert status == 403 and not calls


def test_auth_stream_without_declared_length_is_limited():
    status, calls = asyncio.run(invoke("/api/users/token", headers={
        b"content-type": b"application/x-www-form-urlencoded",
    }, chunks=(b"x" * 80000, b"x" * 80000)))
    assert status == 403 and not calls


def test_websocket_cannot_bypass_policy():
    async def downstream(scope, receive, send):
        raise AssertionError("WebSocket reached application")
    sent = []
    async def send(message):
        sent.append(message)
    async def receive():
        raise AssertionError("Should not read WebSocket messages")
    asyncio.run(ClientOnlyBoundary(downstream)(
        {"type": "websocket", "path": "/api/users/me"}, receive, send))
    assert sent == [{"type": "websocket.close", "code": 1008}]


def test_allowed_preference_route():
    status, calls = asyncio.run(invoke("/api/default-formats", method="PUT",
        headers={b"content-type": b"application/json"}, chunks=(b'{"x":"png"}',)))
    assert status == 204 and calls == ["reached"]
