"""Process entrypoint for stdio vs HTTP transport."""

import os

from mrscraper_mcp.app import mcp


def run() -> None:
    transport = os.getenv("TRANSPORT", "stdio").lower()
    if transport == "http":
        port = int(os.getenv("PORT", "8000"))
        host = os.getenv("HOST", "0.0.0.0")
        mcp.run(transport="http", port=port, host=host)
    else:
        mcp.run()
