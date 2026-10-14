"""Client-only API: only authentication, accounts and settings exist.

Do not import or register legacy files, conversions, compression, jobs or stats.
The separate ASGI boundary remains a defense-in-depth restriction.
"""
from fastapi import APIRouter
from .routes import (
    health, settings, default_formats, default_qualities, users,
    api_keys, oidc, guest, default_compression_levels,
)

router = APIRouter()
for module in (
    health, settings, default_formats, default_qualities, users,
    api_keys, oidc, guest, default_compression_levels,
):
    router.include_router(module.router)
