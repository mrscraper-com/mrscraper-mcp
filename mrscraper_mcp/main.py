"""Process entrypoint for stdio vs HTTP transport."""

import os

import uvicorn

from mrscraper_mcp.app import app, mcp

SUPPORTED_TRANSPORTS = frozenset({"stdio", "http"})


def resolve_transport(value: str | None = None) -> str:
    """Resolve and validate the configured transport."""
    transport = (
        (value if value is not None else os.getenv("TRANSPORT", "stdio"))
        .strip()
        .lower()
    )
    if transport not in SUPPORTED_TRANSPORTS:
        supported = ", ".join(sorted(SUPPORTED_TRANSPORTS))
        raise ValueError(
            f"Unsupported TRANSPORT={transport!r}. Expected one of: {supported}."
        )
    return transport


def run() -> None:
    try:
        transport = resolve_transport()
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    if transport == "http":
        port = int(os.getenv("PORT", "8000"))
        host = os.getenv("HOST", "127.0.0.1")
        uvicorn.run(app, host=host, port=port)
    else:
        mcp.run(transport="stdio")
