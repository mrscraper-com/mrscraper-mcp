"""Process entrypoint for stdio vs HTTP transport."""

import os

import uvicorn

from mrscraper_mcp.app import app, mcp


def run() -> None:
    transport = os.getenv("TRANSPORT", "stdio").lower()
    if transport == "http":
        port = int(os.getenv("PORT", "8000"))
        host = os.getenv("HOST", "0.0.0.0")
        uvicorn.run(app, host=host, port=port)
    else:
        mcp.run()
