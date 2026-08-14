"""MCP HTTP authentication and MrScraper API token resolution."""

from __future__ import annotations

import os

import httpx
from fastmcp.exceptions import ToolError
from fastmcp.server.auth.providers.debug import DebugTokenVerifier
from fastmcp.server.dependencies import (
    get_access_token,
    get_http_headers,
    get_http_request,
)

from mrscraper_mcp.constants import SUBSCRIPTION_ACCOUNTS

_TOKEN_VALIDATE_TIMEOUT = 15.0

_MISSING_TOKEN_MESSAGE = (
    "MrScraper API token is required. For HTTP, configure the MCP client with "
    '"headers": {"Authorization": "Bearer <your-token>"}. For stdio, set '
    "MRSCRAPER_API_KEY or MRSCRAPER_API_TOKEN."
)


def normalize_bearer_token(token: str) -> str:
    """Strip whitespace and an optional ``Bearer `` prefix."""
    t = token.strip()
    if t.lower().startswith("bearer "):
        return t[7:].strip()
    return t


def _env_api_token() -> str | None:
    for name in ("MRSCRAPER_API_KEY", "MRSCRAPER_API_TOKEN"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def http_auth_enabled() -> bool:
    """Whether HTTP MCP mounts require a Bearer (or verified) token."""
    value = os.environ.get("MRSCRAPER_HTTP_AUTH", "1").strip().lower()
    return value not in ("0", "false", "no", "off")


async def validate_api_token(token: str) -> bool:
    """Return True when ``token`` is accepted by the MrScraper API."""
    api_token = normalize_bearer_token(token)
    if not api_token:
        return False

    headers = {
        "accept": "application/json",
        "x-api-token": api_token,
    }
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                SUBSCRIPTION_ACCOUNTS,
                headers=headers,
                timeout=_TOKEN_VALIDATE_TIMEOUT,
            )
        return response.status_code == 200
    except httpx.HTTPError:
        return False


def token_verifier() -> DebugTokenVerifier:
    """Verify MCP Bearer tokens against the MrScraper subscription API.

    The MCP client sends the same API key used for MrScraper APIs in the
    ``Authorization: Bearer`` header. Validation calls
    ``GET /subscription-accounts`` with ``x-api-token``.
    """
    return DebugTokenVerifier(
        validate=validate_api_token,
        client_id="mrscraper-mcp",
    )


def resolve_api_token() -> str:
    """Resolve the MrScraper API token for the current request.

    HTTP requests use only credentials supplied by that request. Process-level
    environment credentials are reserved for stdio transport so a hosted HTTP
    server can never lend its own API key to a caller.
    """
    access = get_access_token()
    if access is not None and access.token.strip():
        return normalize_bearer_token(access.token)

    try:
        get_http_request()
    except RuntimeError:
        pass
    else:
        headers = get_http_headers(include={"authorization"})
        for header_name in ("x-api-token", "authorization"):
            header_value = headers.get(header_name, "").strip()
            if header_value:
                return normalize_bearer_token(header_value)

        raise ToolError(_MISSING_TOKEN_MESSAGE)

    env_token = _env_api_token()
    if env_token:
        return env_token

    raise ToolError(_MISSING_TOKEN_MESSAGE)
