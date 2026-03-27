from fastmcp import FastMCP

from mrscraper_mcp.tools.ai_scrapers import (
    register_ai_scraper_tools,
    register_ai_scraper_ui_tools,
)
from mrscraper_mcp.tools.fetch_html import (
    register_fetch_html_tool,
    register_fetch_html_ui_tool,
)
from mrscraper_mcp.tools.jobs import register_job_tools
from mrscraper_mcp.tools.manual_scrapers import (
    register_manual_scraper_tools,
    register_manual_scraper_ui_tools,
)
from mrscraper_mcp.tools.results import register_result_tools


def register_tools(mcp: FastMCP) -> None:
    register_fetch_html_tool(mcp)
    register_ai_scraper_tools(mcp)
    register_manual_scraper_tools(mcp)
    register_result_tools(mcp)


def register_chatgpt_tools(mcp: FastMCP) -> None:
    register_fetch_html_ui_tool(mcp)
    register_ai_scraper_ui_tools(mcp)
    register_manual_scraper_ui_tools(mcp)
    register_job_tools(mcp)
