"""MCP HTTP authentication and MrScraper API token resolution."""

from __future__ import annotations

import os

from fastmcp.exceptions import ToolError
from fastmcp.server.auth.providers.debug import DebugTokenVerifier
from fastmcp.server.dependencies import get_access_token, get_http_headers

_MISSING_TOKEN_MESSAGE = (
    "MrScraper API token is required. Configure the MCP client with "
    '"headers": {"Authorization": "Bearer <your-token>"} (or "x-api-token"), '
    "set MRSCRAPER_API_TOKEN for stdio, or pass token / access_token on the tool call."
)


def normalize_bearer_token(token: str) -> str:
    """Strip whitespace and an optional ``Bearer `` prefix."""
    t = token.strip()
    if t.lower().startswith("bearer "):
        return t[7:].strip()
    return t


def _env_api_token() -> str | None:
    value = os.environ.get("MRSCRAPER_API_TOKEN", "").strip()
    return value or None


def http_auth_enabled() -> bool:
    """Whether HTTP MCP mounts require a Bearer (or verified) token."""
    value = os.environ.get("MRSCRAPER_HTTP_AUTH", "1").strip().lower()
    return value not in ("0", "false", "no", "off")


def mrscraper_token_verifier() -> DebugTokenVerifier:
    """Accept any non-empty token as the MrScraper API credential.

    The MCP client sends the same API key used for MrScraper APIs in the
    ``Authorization: Bearer`` header. Upstream APIs validate the key; this
    verifier only ensures a credential was provided for the MCP session.
    """
    return DebugTokenVerifier(
        validate=lambda token: bool(token and token.strip()),
        client_id="mrscraper-mcp",
    )


def resolve_api_token(token: str | None = None) -> str:
    """Resolve the MrScraper API token for the current request.

    Precedence: explicit tool argument, MCP Bearer auth, ``x-api-token`` header,
    then ``MRSCRAPER_API_TOKEN``.
    """
    if token and token.strip():
        return normalize_bearer_token(token)

    access = get_access_token()
    if access is not None and access.token.strip():
        return normalize_bearer_token(access.token)

    headers = get_http_headers()
    for header_name in ("x-api-token", "authorization"):
        header_value = headers.get(header_name, "").strip()
        if header_value:
            return normalize_bearer_token(header_value)

    env_token = _env_api_token()
    if env_token:
        return env_token

    raise ToolError(_MISSING_TOKEN_MESSAGE)
