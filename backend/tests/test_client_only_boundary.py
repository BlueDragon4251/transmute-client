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
    status, calls = asyncio.run(invoke("/api/users/token", headers={
        b"content-type": b"application/json",
    }, chunks=(b"x" * 65536, b"x" * 65536, b"x")))
    assert status == 403 and not calls


def test_small_account_request_remains_possible():
    status, calls = asyncio.run(invoke("/api/users/token", headers={
        b"content-type": b"application/json",
    }, chunks=(json.dumps({"username": "test", "password": "test"}).encode(),)))
    assert status == 204 and calls == ["reached"]


def test_unknown_api_route_denied():
    status, calls = asyncio.run(invoke("/api/new-file-upload-service", headers={
        b"content-type": b"application/json",
    }, chunks=(b'{"file":"sensitive"}',)))
    assert status == 403 and not calls


def test_auth_multipart_denied():
    status, calls = asyncio.run(invoke("/api/users/token", headers={
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
        headers={b"content-type": b"application/json"}, chunks=(b'{"input_format":"png","output_format":"jpeg"}',)))
    assert status == 204 and calls == ["reached"]


def test_legacy_route_modules_not_registered():
    """Static check: no accidentally registered legacy router, even if middleware changes."""
    import ast
    from pathlib import Path
    api_init = Path(__file__).resolve().parents[1] / "api" / "__init__.py"
    tree = ast.parse(api_init.read_text(encoding="utf-8"))
    forbidden = {"files", "conversions", "converters", "jobs", "compressions",
                 "compressors", "compression_jobs", "stats"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "routes":
            assert not forbidden.intersection(alias.name for alias in node.names)
    source = api_init.read_text(encoding="utf-8")
    for name in forbidden:
        assert f"{name}.router" not in source


def test_account_payload_cannot_carry_files_or_unknown_fields():
    for body in (
        b'{"username":"test","password":"test","file":"private"}',
        b'{"username":"test","password":"test","filename":"secret.docx"}',
        b'{"username":"test","password":"test","password":"other"}',
        b'{"username":"test","password":"' + b'x' * 73 + b'"}',
    ):
        status, calls = asyncio.run(invoke('/api/users/authenticate', headers={b'content-type':b'application/json'}, chunks=(body,)))
        assert status == 403 and not calls


def test_settings_rejects_nested_content_and_non_hex_colors():
    for body in (b'{"file":"private"}', b'{"theme":{"data":"private"}}', b'{"colors":{"primary":"url(https://evil)"}}'):
        status, calls = asyncio.run(invoke('/api/settings', method='PATCH', headers={b'content-type':b'application/json'}, chunks=(body,)))
        assert status == 403 and not calls


def test_non_api_writes_are_denied():
    for path in ('/', '/assets/document.pdf', '/engines/upload'):
        status, calls = asyncio.run(invoke(path, chunks=(b'private',)))
        assert status == 403 and not calls


def test_read_and_delete_routes_reject_declared_bodies():
    for path,method in [('/api/settings','GET'),('/api/users/00000000-0000-0000-0000-000000000000','DELETE')]:
        status,calls=asyncio.run(invoke(path,method=method,headers={b'content-length':b'7'},chunks=(b'private',)))
        assert status==403 and not calls


def test_admin_user_list_is_available():
    status,calls=asyncio.run(invoke('/api/users',method='GET'))
    assert status==204 and calls
