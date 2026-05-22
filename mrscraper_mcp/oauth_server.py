"""Lightweight OAuth 2.0 Authorization Server for ChatGPT Apps compatibility."""

from __future__ import annotations

import base64
import hashlib
import html
import os
import secrets
import time
from dataclasses import dataclass

import jwt
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse

OAUTH_BASE_PATH = "/oauth"
AUTHORIZE_PATH = f"{OAUTH_BASE_PATH}/authorize"
TOKEN_PATH = f"{OAUTH_BASE_PATH}/token"
CALLBACK_PATH = f"{OAUTH_BASE_PATH}/callback"

_oauth_jwt_secret = os.environ.get("OAUTH_JWT_SECRET", "").strip()
if not _oauth_jwt_secret:
    _oauth_jwt_secret = secrets.token_urlsafe(32)

OAUTH_JWT_SECRET = _oauth_jwt_secret
OAUTH_JWT_ALGORITHM = "HS256"
OAUTH_ACCESS_TOKEN_TTL = int(os.environ.get("OAUTH_ACCESS_TOKEN_TTL", "86400"))
OAUTH_AUTH_CODE_TTL = int(os.environ.get("OAUTH_AUTH_CODE_TTL", "300"))

OAUTH_CLIENT_ID = os.environ.get("OAUTH_CLIENT_ID", "mrscraper-mcp-client").strip()
OAUTH_CLIENT_SECRET = os.environ.get("OAUTH_CLIENT_SECRET", "").strip()

_server_url = os.environ.get("OAUTH_SERVER_URL", "").strip()
if not _server_url:
    _host = os.environ.get("HOST", "localhost")
    _port = int(os.environ.get("PORT", "8000"))
    _server_url = f"http://{_host}:{_port}"

OAUTH_SERVER_URL = _server_url.rstrip("/")


@dataclass
class _PendingAuthCode:
    code: str
    api_token: str
    redirect_uri: str
    code_challenge: str
    client_id: str
    scope: str
    expires_at: float
    used: bool = False


_auth_codes: dict[str, _PendingAuthCode] = {}


def _prune_expired_codes() -> None:
    now = time.time()
    expired = [k for k, v in _auth_codes.items() if v.expires_at < now]
    for k in expired:
        del _auth_codes[k]


def _generate_code() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def _verify_pkce(code_verifier: str, code_challenge: str) -> bool:
    if not code_verifier or not code_challenge:
        return False
    computed = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode("ascii")
    return computed == code_challenge


def _create_access_token(api_token: str) -> str:
    now = int(time.time())
    payload = {
        "sub": "mrscraper-user",
        "iat": now,
        "exp": now + OAUTH_ACCESS_TOKEN_TTL,
        "scope": "mcp:tools",
        "mrscraper_api_token": api_token,
    }
    return jwt.encode(payload, OAUTH_JWT_SECRET, algorithm=OAUTH_JWT_ALGORITHM)


def verify_oauth_token(token: str) -> str | None:
    try:
        payload = jwt.decode(token, OAUTH_JWT_SECRET, algorithms=[OAUTH_JWT_ALGORITHM])
        return payload.get("mrscraper_api_token")
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def _build_protected_resource(resource_url: str, auth_server_url: str) -> dict:
    return {
        "resource": resource_url,
        "authorization_servers": [auth_server_url],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["mcp:tools"],
    }


async def oauth_protected_resource(request: Request) -> JSONResponse:
    base_url = str(request.base_url).rstrip("/")
    return JSONResponse(_build_protected_resource(base_url, base_url))


async def oauth_authorization_server(request: Request) -> JSONResponse:
    base_url = str(request.base_url).rstrip("/")
    return JSONResponse(
        {
            "issuer": base_url,
            "authorization_endpoint": f"{base_url}{AUTHORIZE_PATH}",
            "token_endpoint": f"{base_url}{TOKEN_PATH}",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": [
                "client_secret_post",
                "client_secret_basic",
            ],
            "scopes_supported": ["mcp:tools"],
        }
    )


_AUTHORIZE_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize MrScraper MCP</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #555; line-height: 1.5; }
    label { display: block; margin-top: 1.2rem; font-weight: 600; font-size: 0.9rem; }
    input[type="text"], input[type="password"] { width: 100%%; padding: 10px; margin-top: 6px; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; box-sizing: border-box; }
    button { margin-top: 1.5rem; width: 100%%; padding: 12px; background: #007bff; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
    button:hover { background: #0056b3; }
    .error { color: #dc3545; margin-top: 1rem; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Connect MrScraper MCP to ChatGPT</h1>
  <p>Enter your MrScraper API token to authorize this connection.</p>
  <form method="post" action="%(authorize_path)s">
    <input type="hidden" name="client_id" value="%(client_id)s">
    <input type="hidden" name="redirect_uri" value="%(redirect_uri)s">
    <input type="hidden" name="state" value="%(state)s">
    <input type="hidden" name="code_challenge" value="%(code_challenge)s">
    <input type="hidden" name="code_challenge_method" value="%(code_challenge_method)s">
    <input type="hidden" name="scope" value="%(scope)s">
    <input type="hidden" name="response_type" value="code">

    <label for="api_token">MrScraper API Token</label>
    <input type="password" id="api_token" name="api_token" placeholder="Paste your API token here" required autocomplete="off">

    %(error_html)s

    <button type="submit">Authorize</button>
  </form>
</body>
</html>
"""


async def oauth_authorize(request: Request) -> HTMLResponse | RedirectResponse:
    if request.method == "GET":
        client_id = request.query_params.get("client_id", "")
        redirect_uri = request.query_params.get("redirect_uri", "")
        state = request.query_params.get("state", "")
        code_challenge = request.query_params.get("code_challenge", "")
        code_challenge_method = request.query_params.get("code_challenge_method", "")
        scope = request.query_params.get("scope", "mcp:tools")

        if not code_challenge or code_challenge_method != "S256":
            return _oauth_error_redirect(
                redirect_uri, "invalid_request", "PKCE S256 code_challenge is required.", state
            )

        return HTMLResponse(
            _AUTHORIZE_HTML
            % {
                "authorize_path": AUTHORIZE_PATH,
                "client_id": html.escape(client_id),
                "redirect_uri": html.escape(redirect_uri),
                "state": html.escape(state),
                "code_challenge": html.escape(code_challenge),
                "code_challenge_method": html.escape(code_challenge_method),
                "scope": html.escape(scope),
                "error_html": "",
            }
        )

    form = await request.form()
    client_id = form.get("client_id", "")
    redirect_uri = form.get("redirect_uri", "")
    state = form.get("state", "")
    code_challenge = form.get("code_challenge", "")
    code_challenge_method = form.get("code_challenge_method", "")
    scope = form.get("scope", "mcp:tools")
    api_token = form.get("api_token", "").strip()

    if not redirect_uri:
        return JSONResponse(
            {"error": "invalid_request", "error_description": "redirect_uri is required."},
            status_code=400,
        )

    if not code_challenge or code_challenge_method != "S256":
        return _oauth_error_redirect(
            redirect_uri, "invalid_request", "PKCE S256 code_challenge is required.", state
        )

    if not api_token:
        return HTMLResponse(
            _AUTHORIZE_HTML
            % {
                "authorize_path": AUTHORIZE_PATH,
                "client_id": html.escape(str(client_id)),
                "redirect_uri": html.escape(str(redirect_uri)),
                "state": html.escape(str(state)),
                "code_challenge": html.escape(str(code_challenge)),
                "code_challenge_method": html.escape(str(code_challenge_method)),
                "scope": html.escape(str(scope)),
                "error_html": '<p class="error">API token is required.</p>',
            },
            status_code=400,
        )

    code = _generate_code()
    _auth_codes[code] = _PendingAuthCode(
        code=code,
        api_token=api_token,
        redirect_uri=str(redirect_uri),
        code_challenge=str(code_challenge),
        client_id=str(client_id),
        scope=str(scope),
        expires_at=time.time() + OAUTH_AUTH_CODE_TTL,
    )

    redirect_url = f"{redirect_uri}?code={code}"
    if state:
        redirect_url += f"&state={state}"
    return RedirectResponse(redirect_url, status_code=302)


async def oauth_token(request: Request) -> JSONResponse:
    form = await request.form()
    grant_type = form.get("grant_type", "")

    if grant_type != "authorization_code":
        return JSONResponse(
            {"error": "unsupported_grant_type", "error_description": "Only authorization_code is supported."},
            status_code=400,
        )

    code = form.get("code", "")
    redirect_uri = form.get("redirect_uri", "")
    code_verifier = form.get("code_verifier", "")
    client_id = form.get("client_id", "")
    client_secret = form.get("client_secret", "")

    if OAUTH_CLIENT_SECRET and client_secret != OAUTH_CLIENT_SECRET:
        return JSONResponse(
            {"error": "invalid_client", "error_description": "Invalid client credentials."},
            status_code=401,
        )
    if client_id and client_id != OAUTH_CLIENT_ID:
        return JSONResponse(
            {"error": "invalid_client", "error_description": "Invalid client_id."},
            status_code=401,
        )

    _prune_expired_codes()
    pending = _auth_codes.get(code)
    if not pending or pending.used or pending.expires_at < time.time():
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "Invalid or expired authorization code."},
            status_code=400,
        )

    if redirect_uri and pending.redirect_uri != redirect_uri:
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "redirect_uri mismatch."},
            status_code=400,
        )

    if not _verify_pkce(str(code_verifier), pending.code_challenge):
        return JSONResponse(
            {"error": "invalid_grant", "error_description": "PKCE verification failed."},
            status_code=400,
        )

    pending.used = True

    access_token = _create_access_token(pending.api_token)
    refresh_token = _generate_code()

    return JSONResponse(
        {
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": OAUTH_ACCESS_TOKEN_TTL,
            "refresh_token": refresh_token,
            "scope": pending.scope,
        }
    )


def _oauth_error_redirect(redirect_uri: str, error: str, description: str, state: str = "") -> RedirectResponse | JSONResponse:
    if not redirect_uri:
        return JSONResponse(
            {"error": error, "error_description": description},
            status_code=400,
        )
    url = f"{redirect_uri}?error={error}&error_description={description}"
    if state:
        url += f"&state={state}"
    return RedirectResponse(url, status_code=302)
