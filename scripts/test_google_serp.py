"""Smoke-test the canonical ``serp`` implementation directly or over MCP.

Examples:
  MRSCRAPER_API_KEY='atk_...' python scripts/test_google_serp.py
  python scripts/test_google_serp.py --mcp http://localhost:8000/mcp \
    --access-token 'atk_...' --query-or-url 'iphone 17'
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

DEFAULT_QUERY = "iphone 17"


def _print_json(label: str, value: Any) -> None:
    print(f"\n== {label} ==")
    print(json.dumps(value, indent=2, ensure_ascii=False, default=str))


def _resolve_token(args: argparse.Namespace) -> str | None:
    for value in (
        args.access_token,
        os.environ.get("MRSCRAPER_API_KEY", ""),
        os.environ.get("MRSCRAPER_API_TOKEN", ""),
    ):
        if value and value.strip():
            return value.strip()
    return None


async def _run_direct(
    *,
    access_token: str,
    query_or_url: str,
    region: str | None,
    language: str | None,
    page: int | None,
    format: str,
    render_js: bool,
    timeout: int,
) -> dict[str, Any]:
    from mrscraper_mcp.api import google_serp_sync_api

    return await google_serp_sync_api(
        token=access_token,
        query_or_url=query_or_url,
        region=region,
        language=language,
        page=page,
        format=format,
        render_js=render_js,
        timeout=timeout,
    )


def _content_jsonable(blocks: Any) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for block in blocks or []:
        row = {
            key: getattr(block, key)
            for key in ("type", "text", "data", "mimeType", "uri")
            if hasattr(block, key)
        }
        output.append(row or {"_repr": repr(block)})
    return output


async def _run_mcp(
    *,
    mcp_url: str,
    access_token: str,
    query_or_url: str,
    region: str | None,
    language: str | None,
    page: int | None,
    format: str,
    render_js: bool,
    timeout: int,
) -> dict[str, Any]:
    try:
        from fastmcp import Client
        from fastmcp.client.auth import BearerAuth
    except ModuleNotFoundError:
        print("fastmcp is not installed. Run `pip install -e .`.", file=sys.stderr)
        raise SystemExit(1) from None

    arguments = {
        "query_or_url": query_or_url,
        "format": format,
        "render_js": render_js,
        "timeout": timeout,
    }
    if region:
        arguments["region"] = region
    if language:
        arguments["language"] = language
    if page:
        arguments["page"] = page

    async with Client(mcp_url, auth=BearerAuth(access_token)) as client:
        tools = await client.list_tools()
        names = [getattr(tool, "name", "") for tool in tools]
        if "serp" not in names:
            print(f"Tool `serp` not found. Available: {names}", file=sys.stderr)
            raise SystemExit(2)
        result = await client.call_tool("serp", arguments)
        return {
            "is_error": getattr(result, "is_error", False),
            "structured_content": getattr(result, "structured_content", None),
            "data": getattr(result, "data", None),
            "content": _content_jsonable(getattr(result, "content", None)),
        }


async def _async_main(args: argparse.Namespace) -> int:
    token = _resolve_token(args)
    if not token:
        print(
            "Missing token: set MRSCRAPER_API_KEY / MRSCRAPER_API_TOKEN or "
            "pass --access-token.",
            file=sys.stderr,
        )
        return 2

    options = {
        "access_token": token,
        "query_or_url": args.query_or_url,
        "region": args.region,
        "language": args.language,
        "page": args.page,
        "format": args.format,
        "render_js": args.render_js,
        "timeout": args.timeout,
    }
    if args.mcp:
        result = await _run_mcp(mcp_url=args.mcp, **options)
        mode = f"MCP {args.mcp}"
    else:
        result = await _run_direct(**options)
        mode = "direct v2 SERP API"

    print(f"Mode: {mode}")
    print(f"Query or URL: {args.query_or_url}")
    _print_json("result", result)

    if args.mcp and result.get("is_error"):
        print("\nTest FAILED: MCP tool is_error=True.", file=sys.stderr)
        return 1
    check = result.get("structured_content") if args.mcp else result
    if not isinstance(check, dict):
        check = result
    if check.get("error"):
        print("\nTest FAILED: error field set.", file=sys.stderr)
        return 1
    status_code = check.get("status_code")
    if status_code is not None and int(status_code) >= 400:
        print(f"\nTest FAILED: HTTP status {status_code}.", file=sys.stderr)
        return 1

    print("\nTest OK.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke-test the canonical MrScraper `serp` tool."
    )
    parser.add_argument("--access-token", default="")
    parser.add_argument("--query-or-url", "--url", default=DEFAULT_QUERY)
    parser.add_argument("--region")
    parser.add_argument("--language")
    parser.add_argument("--page", type=int)
    parser.add_argument("--format", choices=("json", "html"), default="json")
    parser.add_argument("--render-js", action="store_true")
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument(
        "--mcp",
        metavar="URL",
        default="",
        help="Call the synchronous `/mcp` surface instead of the API helper.",
    )
    args = parser.parse_args()
    if args.mcp:
        base = args.mcp.rstrip("/")
        args.mcp = base if base.endswith("/mcp") else f"{base}/mcp"
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
