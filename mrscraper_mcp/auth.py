"""MCP HTTP authentication and MrScraper API token resolution."""

from __future__ import annotations

import os

from fastmcp.exceptions import ToolError
from fastmcp.server.auth.providers.debug import DebugTokenVerifier
from fastmcp.server.dependencies import get_access_token, get_http_headers

from mrscraper_mcp.oauth_server import verify_oauth_token

_MISSING_TOKEN_MESSAGE = (
    "MrScraper API token is required. Configure the MCP client with "
    '"headers": {"Authorization": "Bearer <your-token>"} (or "x-api-token"), '
    "or set MRSCRAPER_API_TOKEN for stdio transport."
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
    """Accept any non-empty token or a valid OAuth JWT as the MrScraper API credential."""
    def _validate(token: str) -> bool:
        if not token or not token.strip():
            return False
        if len(token) < 100:
            return True
        return verify_oauth_token(token) is not None

    return DebugTokenVerifier(
        validate=_validate,
        client_id="mrscraper-mcp",
    )


def _extract_api_token(raw_token: str) -> str:
    normalized = normalize_bearer_token(raw_token)
    api_token = verify_oauth_token(normalized)
    return api_token if api_token is not None else normalized


def resolve_api_token() -> str:
    """Resolve the MrScraper API token for the current request.

    Precedence: MCP Bearer auth, ``x-api-token`` / ``Authorization`` headers,
    then ``MRSCRAPER_API_TOKEN``. OAuth JWTs are transparently decoded to
    extract the embedded API token.
    """
    access = get_access_token()
    if access is not None and access.token.strip():
        return _extract_api_token(access.token)

    headers = get_http_headers()
    for header_name in ("x-api-token", "authorization"):
        header_value = headers.get(header_name, "").strip()
        if header_value:
            return _extract_api_token(header_value)

    env_token = _env_api_token()
    if env_token:
        return env_token

    raise ToolError(_MISSING_TOKEN_MESSAGE)
