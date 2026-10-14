"""Isolation and CSP contracts for trusted local conversion engines."""
import asyncio
from client_only_headers import ClientOnlyHeaders


def headers(path):
    messages = []
    async def app(scope, receive, send):
        await send({'type': 'http.response.start', 'status': 200, 'headers': []})
    async def send(message):
        messages.append(message)
    asyncio.run(ClientOnlyHeaders(app)({'type': 'http', 'path': path}, None, send))
    return dict(messages[0]['headers'])


def test_workspace_keeps_javascript_eval_disabled_and_enables_isolation():
    result = headers('/')
    assert b"'unsafe-eval'" not in result[b'content-security-policy']
    assert result[b'cross-origin-opener-policy'] == b'same-origin'
    assert result[b'cross-origin-embedder-policy'] == b'require-corp'
    assert result[b'cross-origin-resource-policy'] == b'same-origin'


def test_only_office_engine_documents_receive_the_required_eval_policy():
    for path in ('/engines/office/frame.html', '/engines/office/office-worker.js', '/transmute/engines/office/frame.html'):
        policy = headers(path)[b'content-security-policy']
        assert b"'unsafe-eval'" in policy
        assert b"frame-ancestors 'self'" in policy
        assert b"frame-src 'none'" in policy
        assert b"form-action 'none'" in policy
    for path in ('/api/settings', '/engines/office/soffice.js', '/engines/office/unknown.html'):
        assert b"'unsafe-eval'" not in headers(path)[b'content-security-policy']


def test_dwg_embind_eval_is_limited_to_the_cad_worker():
    assert b"'unsafe-eval'" in headers('/engines/cad-worker.js')[b'content-security-policy']
    assert b"'unsafe-eval'" not in headers('/engines/cad/dwg/dist/libredwg-web.js')[b'content-security-policy']


def test_account_responses_remain_uncacheable():
    assert headers('/api/settings')[b'cache-control'] == b'no-store'
