"""FastMCP application instance and server instructions."""

from dotenv import load_dotenv
from fastmcp import FastMCP

from mrscraper_mcp.routes import register_routes
from mrscraper_mcp.tools import register_tools
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

register_routes(mcp)
register_widget_resources(mcp)
register_tools(mcp)
