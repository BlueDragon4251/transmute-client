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
