"""Integration test for Google SERP sync: direct API (default) or via MCP `google_serp_sync`.

Reads token from MRSCRAPER_GOOGLE_SERP_TOKEN unless --access-token is set.
Does not log the full token.

Example (direct):
  export MRSCRAPER_GOOGLE_SERP_TOKEN='atk_...'
  python scripts/test_google_serp.py

Example (MCP, server must be running):
  python scripts/test_google_serp.py --mcp http://localhost:8787/mcp --access-token 'atk_...'
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any


DEFAULT_SEARCH_URL = "https://www.google.com/search?q=iphone+17"


def _print_json(label: str, value: Any) -> None:
    print(f"\n== {label} ==")
    print(
        json.dumps(
            value,
            indent=2,
            ensure_ascii=False,
            default=str,
        )
    )


def _resolve_token(args: argparse.Namespace) -> str | None:
    if args.access_token:
        return args.access_token.strip()
    env = os.environ.get("MRSCRAPER_GOOGLE_SERP_TOKEN", "").strip()
    return env or None


async def _run_direct(
    *,
    access_token: str,
    url: str,
    raw: bool,
    session_cookie: str,
    timeout: float,
) -> dict[str, Any]:
    from mrscraper_mcp.tools.google_serp import _google_serp_sync_impl

    return await _google_serp_sync_impl(
        access_token=access_token,
        url=url,
        raw=raw,
        session_cookie=session_cookie,
        timeout=timeout,
    )


def _content_jsonable(blocks: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in blocks or []:
        row: dict[str, Any] = {}
        for key in ("type", "text", "data", "mimeType", "uri"):
            if hasattr(block, key):
                row[key] = getattr(block, key)
        if not row and block is not None:
            row["_repr"] = repr(block)
        out.append(row)
    return out


async def _run_mcp(
    *,
    mcp_url: str,
    access_token: str,
    url: str,
    raw: bool,
    session_cookie: str,
    timeout: float,
) -> dict[str, Any]:
    try:
        from fastmcp import Client
    except ModuleNotFoundError:
        print(
            "fastmcp is not installed. Run `pip install -e .` first.", file=sys.stderr
        )
        raise SystemExit(1) from None

    arguments: dict[str, Any] = {
        "access_token": access_token,
        "url": url,
        "raw": raw,
        "timeout": timeout,
    }
    if session_cookie:
        arguments["session_cookie"] = session_cookie

    client = Client(mcp_url)
    async with client:
        tools = await client.list_tools()
        names = [getattr(t, "name", "") for t in tools]
        if "google_serp_sync" not in names:
            print(
                f"Tool `google_serp_sync` not found on this server. Available: {names}",
                file=sys.stderr,
            )
            raise SystemExit(2)

        result = await client.call_tool("google_serp_sync", arguments)
        return {
            "is_error": getattr(result, "is_error", False),
            "structured_content": getattr(result, "structured_content", None),
            "data": getattr(result, "data", None),
            "content": _content_jsonable(getattr(result, "content", None)),
        }


def _effective_api_result(
    args: argparse.Namespace, result: dict[str, Any]
) -> dict[str, Any]:
    """For pass/fail, use inner structured_content when MCP returns API-shaped dict."""
    if args.mcp:
        inner = result.get("structured_content")
        if isinstance(inner, dict):
            return inner
    return result


async def _async_main(args: argparse.Namespace) -> int:
    token = _resolve_token(args)
    if not token:
        print(
            "Missing token: set MRSCRAPER_GOOGLE_SERP_TOKEN or pass --access-token.",
            file=sys.stderr,
        )
        return 2

    if args.mcp:
        result = await _run_mcp(
            mcp_url=args.mcp,
            access_token=token,
            url=args.url,
            raw=args.raw,
            session_cookie=args.session_cookie or "",
            timeout=args.timeout,
        )
        mode = f"MCP {args.mcp}"
    else:
        result = await _run_direct(
            access_token=token,
            url=args.url,
            raw=args.raw,
            session_cookie=args.session_cookie or "",
            timeout=args.timeout,
        )
        mode = "direct API (_google_serp_sync_impl)"

    print(f"Mode: {mode}")
    print(f"URL: {args.url}")
    _print_json("result", result)

    if args.mcp and result.get("is_error"):
        print("\nTest FAILED: MCP tool is_error=True.", file=sys.stderr)
        return 1

    check = _effective_api_result(args, result)
    if check.get("error"):
        print("\nTest FAILED: error field set.", file=sys.stderr)
        return 1
    sc = check.get("status_code")
    if sc is not None and int(sc) >= 400:
        print(f"\nTest FAILED: HTTP status {sc}.", file=sys.stderr)
        return 1

    print("\nTest OK.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke test Google SERP sync (direct or via MCP google_serp_sync)."
    )
    parser.add_argument(
        "--access-token",
        default="",
        help="Sync API bearer token (atk_...). Overrides MRSCRAPER_GOOGLE_SERP_TOKEN.",
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_SEARCH_URL,
        help="Full Google search URL to request.",
    )
    parser.add_argument(
        "--raw",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Request raw API payload (default: true).",
    )
    parser.add_argument(
        "--session-cookie",
        default="",
        help="Optional Cookie header value (e.g. sl-session=...).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=600.0,
        help="HTTP timeout in seconds (default: 600).",
    )
    parser.add_argument(
        "--mcp",
        metavar="URL",
        default="",
        help="If set, call tool google_serp_sync on this MCP base "
        "(e.g. http://localhost:8787/mcp). Omit for direct API test.",
    )
    args = parser.parse_args()

    # Normalize MCP URL: user may pass http://host:8787 without /mcp
    if args.mcp:
        u = args.mcp.rstrip("/")
        if not u.endswith("/mcp"):
            u = f"{u}/mcp"
        args.mcp = u

    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
