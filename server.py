"""
MrScraper MCP Server using FastMCP.

Entry point for `python server.py` and `fastmcp run server.py:mcp`.
Implementation lives in the `mrscraper_mcp` package.
"""

from mrscraper_mcp.app import mcp
from mrscraper_mcp.main import run

__all__ = ["mcp", "run"]

if __name__ == "__main__":
    run()
