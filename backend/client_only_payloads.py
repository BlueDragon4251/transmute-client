"""Route-specific account/settings payload grammar; never accepts file fields.

Credential/profile strings necessarily reach the server. This is not an
information-theoretic claim that a user cannot type document text as a password.
The converter never passes filenames, content or job metadata to these schemas.
"""
import json
import re
from urllib.parse import parse_qs

_USER_CREATE = {"username", "password", "email", "full_name", "role", "disabled"}
_USER_UPDATE = _USER_CREATE | {"current_password"}
_SETTINGS = {"theme", "auto_download", "keep_originals", "cleanup_enabled", "cleanup_ttl_minutes", "datetime_display_format"}
_COLOR = {"primary", "primary_light", "primary_dark", "accent", "success", "success_light", "success_dark", "surface_dark", "surface_light", "text", "text_muted"}


def payload_valid(path: str, method: str, content_type: bytes, body: bytes) -> bool:
    path = path.rstrip("/")
    if len(body) > 8192:
        return False
    if not body:
        return path in {"/api/guest/session"}
    try:
        if content_type == b"application/x-www-form-urlencoded":
            if path != "/api/users/token":
                return False
            form = parse_qs(body.decode("utf-8"), keep_blank_values=True, strict_parsing=True)
            if any(len(values) != 1 for values in form.values()):
                return False
            data = {key: values[0] for key, values in form.items()}
        else:
            if content_type != b"application/json":
                return False
            def unique_pairs(pairs):
                value = {}
                for key, item in pairs:
                    if key in value:
                        raise ValueError("duplicate key")
                    value[key] = item
                return value
            data = json.loads(body, object_pairs_hook=unique_pairs)
        if not isinstance(data, dict):
            return False
        if path in {"/api/users/token", "/api/users/authenticate"}:
            allowed = {"username", "password", "grant_type", "scope", "client_id", "client_secret"} if path.endswith("token") else {"username", "password"}
        elif path == "/api/users":
            allowed = _USER_CREATE
        elif path.startswith("/api/users/"):
            allowed = _USER_UPDATE if path.endswith("/me") else _USER_CREATE
        elif path == "/api/settings":
            allowed = _SETTINGS
        elif path.startswith("/api/settings/themes"):
            allowed = {"name", "colors"}
        elif path == "/api/default-formats":
            allowed = {"input_format", "output_format"}
        elif path == "/api/default-qualities":
            allowed = {"output_format", "quality"}
        elif path == "/api/default-compression-levels":
            allowed = {"media_format", "compression_level"}
        elif path == "/api/api-keys":
            allowed = {"name"}
        elif path == "/api/oidc/exchange":
            allowed = {"code"}
        elif path == "/api/guest/session":
            allowed = set()
        else:
            return False
        if set(data) - allowed:
            return False
        for key, value in data.items():
            if value is None:
                continue
            if key == "colors":
                if not isinstance(value, dict) or set(value) != _COLOR or any(not isinstance(v, str) or not re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", v) for v in value.values()):
                    return False
            elif key in {"disabled", "auto_download", "keep_originals", "cleanup_enabled"}:
                if type(value) is not bool:
                    return False
            elif key == "cleanup_ttl_minutes":
                if type(value) is not int or not 1 <= value <= 525600:
                    return False
            else:
                if not isinstance(value, str) or len(value.encode("utf-8")) > {"password":72,"current_password":72,"username":64,"email":254,"full_name":128,"code":512,"name":100}.get(key,80):
                    return False
                if key in {"input_format", "output_format", "media_format", "theme"} and not re.fullmatch(r"[a-zA-Z0-9_+-]{1,80}", value):
                    return False
                if key == "role" and value not in {"admin", "member", "guest"}:
                    return False
        return True
    except (ValueError, UnicodeError, TypeError):
        return False
