"""FastMCP application instance and server instructions."""

from contextlib import AsyncExitStack, asynccontextmanager
import logging
import os

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.routing import Mount, Route

from mrscraper_mcp.auth import http_auth_enabled, mrscraper_token_verifier
from mrscraper_mcp.routes import openai_apps_challenge, register_routes
from mrscraper_mcp.tools import register_chatgpt_tools, register_tools
from mrscraper_mcp.widgets import register_widget_resources


load_dotenv()
_LOG_HTTP_PAYLOAD = os.environ.get("MRSCRAPER_LOG_HTTP_PAYLOAD", "").lower() in (
    "1",
    "true",
    "yes",
)
_PAYLOAD_LOG_MAX = int(os.environ.get("MRSCRAPER_LOG_HTTP_PAYLOAD_MAX", "8192"))
logger = logging.getLogger("uvicorn.error")


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
        kwargs["auth"] = mrscraper_token_verifier()
    return kwargs


_mcp_common = _fastmcp_kwargs()

mcp = FastMCP(
    name="MrScraper MCP Server",
    instructions=(
        "An MCP server that provides web scraping capabilities through the MrScraper API. "
        "This server allows you to scrape web pages with advanced features including "
        "geolocation-based scraping, configurable timeouts, and resource blocking options. "
        "Perfect for extracting content from websites that require JavaScript rendering, "
        "geographic restrictions, or complex page structures. "
        "Google SERP extraction is available via `google_serp_sync` (sync API bearer token, "
        "full Google search URL, optional `raw` and session cookie). "
        "When connected over HTTP, configure the MCP client with "
        '`headers.Authorization: "Bearer <MRSCRAPER_API_TOKEN>"` instead of passing '
        "token on every tool call."
    ),
    **_mcp_common,
)

chatgpt_mcp = FastMCP(
    name="MrScraper ChatGPT Tools",
    instructions=(
        "MrScraper API tools tuned for ChatGPT Apps: long-running work is exposed as "
        "background jobs (tools whose names end with `_job`, e.g. `fetch_html_job`, "
        "`create_ai_scraper_job`, `rerun_ai_scraper_job`, `rerun_manual_scraper_job`). "
        "After starting a job, use `get_scrape_job(job_id=...)` for status and, when finished, "
        "the full API result in one response. Jobs often take under ten seconds but can run up "
        "to about a minute—prefer calling after the user follows up rather than tight polling. "
        "Synchronous-style tools (`bulk_rerun_ai_scraper`, `bulk_rerun_manual`, `get_all_results`, "
        "`get_result_by_id`) return JSON directly. Google SERP sync is available as "
        "`google_serp_sync_job` (background) on this stack; the main MCP also exposes "
        "`google_serp_sync` for direct calls. "
        "Avoid tight polling loops; prefer user-driven follow-ups. "
        "When connected over HTTP, set `headers.Authorization` to "
        '`Bearer <MRSCRAPER_API_TOKEN>` on the MCP connector.'
    ),
    **_mcp_common,
)

register_routes(mcp)
register_routes(chatgpt_mcp)
register_tools(mcp)
register_chatgpt_tools(chatgpt_mcp)
register_widget_resources(mcp)
register_widget_resources(chatgpt_mcp)

mcp_http_app = mcp.http_app(path="/")
chatgpt_http_app = chatgpt_mcp.http_app(path="/")


@asynccontextmanager
async def app_lifespan(_app: Starlette):
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(mcp_http_app.lifespan(_app))
        await stack.enter_async_context(chatgpt_http_app.lifespan(_app))
        yield


app = Starlette(
    lifespan=app_lifespan,
    middleware=[Middleware(LogRequestPayloadMiddleware)],
    routes=[
        Route(
            "/.well-known/openai-apps-challenge",
            endpoint=openai_apps_challenge,
            methods=["GET"],
        ),
        Mount("/mcp", app=mcp_http_app),
        Mount("/chatgpt", app=chatgpt_http_app),
    ],
)
