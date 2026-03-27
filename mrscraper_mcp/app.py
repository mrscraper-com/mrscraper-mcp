"""FastMCP application instance and server instructions."""

from contextlib import AsyncExitStack, asynccontextmanager

from dotenv import load_dotenv
from fastmcp import FastMCP
from starlette.applications import Starlette
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
        "A specialized MCP server that provides tools for ChatGPT to interact with the MrScraper API. "
        "This server includes tools designed for fetching HTML content in the background, allowing ChatGPT to "
        "initiate web scraping tasks and retrieve results without blocking the main conversation flow. "
        "Ideal for use cases where ChatGPT needs to access real-time web data or perform complex scraping operations."
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
