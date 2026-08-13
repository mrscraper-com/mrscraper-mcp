"""Register the canonical CLI-compatible MrScraper tool surface."""

from fastmcp import FastMCP

from mrscraper_mcp.tools.cli import register_cli_tools


def register_tools(mcp: FastMCP) -> None:
    """Register the seven synchronous MrScraper CLI data commands."""
    register_cli_tools(mcp)
