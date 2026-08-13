"""FastMCP application instance and server instructions."""

import logging
import os

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from mrscraper_mcp.auth import http_auth_enabled, token_verifier
from mrscraper_mcp.compliance import MANUAL_SCRAPER_SERVER_INSTRUCTIONS
from mrscraper_mcp.tools import register_tools
from mrscraper_mcp.version import __version__


_LOG_HTTP_PAYLOAD = os.environ.get("MRSCRAPER_LOG_HTTP_PAYLOAD", "").lower() in (
    "1",
    "true",
    "yes",
)
_PAYLOAD_LOG_MAX = int(os.environ.get("MRSCRAPER_LOG_HTTP_PAYLOAD_MAX", "8192"))
logger = logging.getLogger("uvicorn.error")

_CANONICAL_TOOL_NAMES = {
    "fetch",
    "scrape",
    "serp",
    "status",
    "rerun",
    "results",
    "result",
}


def _allowed_origins() -> list[str]:
    """Return explicitly trusted browser origins from the environment."""
    raw = os.environ.get("MRSCRAPER_ALLOWED_ORIGINS", "")
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


class LogRequestPayloadMiddleware(BaseHTTPMiddleware):
    """Log request bodies for debugging. Uvicorn access logs do not include payloads.

    Set MRSCRAPER_LOG_HTTP_PAYLOAD=1 to enable. Optionally set MRSCRAPER_LOG_HTTP_PAYLOAD_MAX
    (default 8192) to cap logged characters. After reading the body for logging, the ASGI
    receive stream is replayed so mounted apps (e.g. /mcp) still see the full body.

    Warning: payloads may contain secrets (tokens, API keys); only enable in trusted environments.
    """

    async def dispatch(self, request: Request, call_next):
        if not _LOG_HTTP_PAYLOAD or request.method not in (
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        ):
            return await call_next(request)

        body = await request.body()
        if body:
            text = body.decode("utf-8", errors="replace")
            if len(text) > _PAYLOAD_LOG_MAX:
                text = (
                    text[:_PAYLOAD_LOG_MAX]
                    + f"... (truncated for log, total {len(body)} bytes)"
                )
            logger.info("%s %s payload: %s", request.method, request.url.path, text)

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        request = Request(request.scope, receive)
        return await call_next(request)


def _fastmcp_kwargs() -> dict:
    kwargs: dict = {}
    if http_auth_enabled():
        kwargs["auth"] = token_verifier()
    return kwargs


_mcp_common = _fastmcp_kwargs()

mcp = FastMCP(
    name="MrScraper MCP Server",
    version=__version__,
    instructions=(
        "MrScraper tools use the same data-command names and behavior as @mrscraper/cli: "
        "`fetch`, `scrape`, `serp`, `status`, `rerun`, `results`, and `result`. "
        "Use `fetch` for readable page content, `scrape` for requested structured fields, "
        "and `serp` when starting from a Google query instead of a known URL. "
        "Use `rerun` for saved AI or manual scraper configurations and `results` / `result` "
        "to inspect stored work. `status` reports account usage and optional domain outcomes. "
        "When connected over HTTP, configure the MCP client with "
        '`headers.Authorization: "Bearer <MRSCRAPER_API_KEY>"`. Tools do not accept '
        "API tokens as arguments. " + MANUAL_SCRAPER_SERVER_INSTRUCTIONS
    ),
    **_mcp_common,
)

register_tools(mcp)


@mcp.custom_route(path="/health", methods=["GET"])
async def health(_request: Request) -> JSONResponse:
    """Kubernetes liveness endpoint; it does not call upstream services."""
    return JSONResponse(
        {"status": "ok", "service": "mrscraper-mcp", "version": __version__}
    )


@mcp.custom_route(path="/ready", methods=["GET"])
async def ready(_request: Request) -> JSONResponse:
    """Confirm that the canonical MCP tool surface was registered successfully."""
    try:
        registered = {tool.name for tool in await mcp.list_tools(run_middleware=False)}
    except Exception:
        logger.exception("MCP readiness check failed while listing tools")
        return JSONResponse(
            {
                "status": "not_ready",
                "service": "mrscraper-mcp",
                "version": __version__,
            },
            status_code=503,
        )

    missing = sorted(_CANONICAL_TOOL_NAMES - registered)
    if missing:
        return JSONResponse(
            {
                "status": "not_ready",
                "service": "mrscraper-mcp",
                "version": __version__,
                "missing_tools": missing,
            },
            status_code=503,
        )

    return JSONResponse(
        {"status": "ready", "service": "mrscraper-mcp", "version": __version__}
    )


app = mcp.http_app(
    path="/mcp",
    middleware=[Middleware(LogRequestPayloadMiddleware)],
    stateless_http=True,
    host_origin_protection="auto",
    allowed_origins=_allowed_origins(),
)
