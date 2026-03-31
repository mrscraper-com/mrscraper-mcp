"""FastMCP application instance and server instructions."""

from contextlib import AsyncExitStack, asynccontextmanager

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Mount

from mrscraper_mcp.routes import register_routes
from mrscraper_mcp.tools import register_chatgpt_tools, register_tools
from mrscraper_mcp.widgets import register_widget_resources

load_dotenv()

mcp = FastMCP(
    name="MrScraper MCP Server",
    instructions=(
        "An MCP server that provides web scraping capabilities through the MrScraper API. "
        "This server allows you to scrape web pages with advanced features including "
        "geolocation-based scraping, configurable timeouts, and resource blocking options. "
        "Perfect for extracting content from websites that require JavaScript rendering, "
        "geographic restrictions, or complex page structures."
    ),
)

chatgpt_mcp = FastMCP(
    name="MrScraper ChatGPT Tools",
    instructions=(
        "MrScraper API tools tuned for ChatGPT Apps: long-running work is exposed as "
        "background jobs (tools whose names end with `_job`, e.g. `fetch_html_job`, "
        "`create_ai_scraper_job`, `rerun_ai_scraper_job`, `rerun_manual_scraper_job`). "
        "After starting a job, use `get_scrape_job_status` when the user follows up and "
        "`get_scrape_job_result` when you need the finished API payload. "
        "Synchronous-style tools (`bulk_rerun_ai_scraper`, `bulk_rerun_manual`, `get_all_results`, "
        "`get_result_by_id`) return JSON directly. "
        "Avoid tight polling loops; prefer user-driven follow-ups."
    ),
)

register_routes(mcp)
register_routes(chatgpt_mcp)
register_tools(mcp)
register_chatgpt_tools(chatgpt_mcp)
register_widget_resources(mcp)
register_widget_resources(chatgpt_mcp)

mcp_http_app = mcp.http_app(path="/")
chatgpt_http_app = chatgpt_mcp.http_app(path="/")


class NormalizeMcpRootPathMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path in {"/mcp", "/chatgpt"}:
            request.scope["path"] = f"{request.url.path}/"
            request.scope["raw_path"] = request.scope["path"].encode("ascii")
        return await call_next(request)


@asynccontextmanager
async def app_lifespan(_app: Starlette):
    async with AsyncExitStack() as stack:
        await stack.enter_async_context(mcp_http_app.lifespan(_app))
        await stack.enter_async_context(chatgpt_http_app.lifespan(_app))
        yield


app = Starlette(
    lifespan=app_lifespan,
    routes=[
        Mount("/mcp", app=mcp_http_app),
        Mount("/chatgpt", app=chatgpt_http_app),
    ],
)

# Prevent Starlette from auto-redirecting `/mcp` -> `/mcp/`.
app.router.redirect_slashes = False
app.add_middleware(NormalizeMcpRootPathMiddleware)
