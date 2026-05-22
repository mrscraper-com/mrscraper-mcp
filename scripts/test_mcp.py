"""Small integration test client for the MrScraper MCP servers."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any


try:
    from fastmcp import Client
    from fastmcp.client.auth import BearerAuth
except ModuleNotFoundError:
    print("fastmcp is not installed. Run `pip install -e .` first.", file=sys.stderr)
    raise SystemExit(1)


DEFAULT_BASE_URL = "http://localhost:8000"
DEFAULT_TARGET = f"{DEFAULT_BASE_URL}/mcp"
DEFAULT_WIDGET_URI = "ui://widget/mrscraper-job-status-v2.html"


def _print_json(label: str, value: Any) -> None:
    print(f"\n== {label} ==")
    print(json.dumps(value, indent=2, default=str))


def _tool_names(tools: list[Any]) -> list[str]:
    return [getattr(tool, "name", "<unknown>") for tool in tools]


def _resource_uris(resources: list[Any]) -> list[str]:
    uris: list[str] = []
    for resource in resources:
        uri = getattr(resource, "uri", None)
        if uri is not None:
            uris.append(str(uri))
    return uris


def _content_to_text(blocks: Any) -> list[str]:
    texts: list[str] = []
    for block in blocks or []:
        text = getattr(block, "text", None)
        if text is not None:
            texts.append(text)
    return texts


async def run_checks(
    *,
    target: str,
    read_widget: bool,
    call_tool: str | None,
    arguments: dict[str, Any] | None,
    token: str | None,
) -> int:
    print(f"Testing MCP target: {target}")
    auth = BearerAuth(token) if token else None
    client = Client(target, auth=auth)

    async with client:
        await client.ping()
        print("ping: ok")

        tools = await client.list_tools()
        tool_names = _tool_names(tools)
        _print_json("tools", tool_names)

        resources = await client.list_resources()
        resource_uris = _resource_uris(resources)
        _print_json("resources", resource_uris)

        if read_widget:
            if DEFAULT_WIDGET_URI in resource_uris:
                widget = await client.read_resource(DEFAULT_WIDGET_URI)
                texts = _content_to_text(widget)
                print("\n== widget resource ==")
                if texts:
                    print(f"loaded {DEFAULT_WIDGET_URI} ({len(texts[0])} chars)")
                else:
                    print(f"loaded {DEFAULT_WIDGET_URI}")
            else:
                print(
                    f"\n== widget resource ==\nmissing {DEFAULT_WIDGET_URI} on this server"
                )

        if call_tool:
            if call_tool not in tool_names:
                print(f"\nTool `{call_tool}` is not exposed by this server.")
                return 2

            result = await client.call_tool(call_tool, arguments or {})
            payload = {
                "data": getattr(result, "data", None),
                "structured_content": getattr(result, "structured_content", None),
                "content_text": _content_to_text(getattr(result, "content", None)),
                "is_error": getattr(result, "is_error", False),
            }
            _print_json(f"tool result: {call_tool}", payload)

    return 0


async def run_route_checks(
    *,
    base_url: str,
    routes: list[str],
    read_widget: bool,
    call_tool: str | None,
    arguments: dict[str, Any] | None,
    token: str | None,
) -> int:
    exit_code = 0

    for route in routes:
        clean_route = route if route.startswith("/") else f"/{route}"
        target = f"{base_url.rstrip('/')}{clean_route}"
        print(f"\n## Checking route {clean_route}")
        try:
            code = await run_checks(
                target=target,
                read_widget=read_widget,
                call_tool=call_tool,
                arguments=arguments,
                token=token,
            )
        except Exception as exc:
            print(f"route {clean_route}: failed to connect or initialize: {exc}")
            exit_code = 1
            continue

        if code != 0:
            exit_code = code

    return exit_code


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Smoke test an MCP server exposed by this repo."
    )
    parser.add_argument(
        "--target",
        default=None,
        help="MCP server URL. Example: http://localhost:8000/mcp",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="Base server URL used with --routes. Example: http://localhost:8000",
    )
    parser.add_argument(
        "--routes",
        nargs="+",
        help="Route paths to check on one server. Example: /mcp /chatgpt",
    )
    parser.add_argument(
        "--no-widget",
        action="store_true",
        help="Skip reading the widget resource.",
    )
    parser.add_argument(
        "--token",
        help="MrScraper API token sent as Authorization: Bearer (overrides MRSCRAPER_API_TOKEN).",
    )
    parser.add_argument(
        "--call-tool",
        help="Optional tool name to invoke after listing tools.",
    )
    parser.add_argument(
        "--args",
        default="{}",
        help="JSON arguments for --call-tool. Example: '{\"limit\": 5}'",
    )
    args = parser.parse_args()

    import os

    token = (args.token or os.environ.get("MRSCRAPER_API_TOKEN", "")).strip() or None

    try:
        parsed_args = json.loads(args.args)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON passed to --args: {exc}", file=sys.stderr)
        return 2

    if not isinstance(parsed_args, dict):
        print("--args must decode to a JSON object.", file=sys.stderr)
        return 2

    if args.routes:
        return asyncio.run(
            run_route_checks(
                base_url=args.base_url,
                routes=args.routes,
                read_widget=not args.no_widget,
                call_tool=args.call_tool,
                arguments=parsed_args,
                token=token,
            )
        )

    target = args.target or DEFAULT_TARGET
    return asyncio.run(
        run_checks(
            target=target,
            read_widget=not args.no_widget,
            call_tool=args.call_tool,
            arguments=parsed_args,
            token=token,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())


"""
Example usage:
python scripts/test_mcp.py \
  --target http://localhost:8000/mcp \
  --call-tool fetch_html \
  --token "$MRSCRAPER_API_TOKEN" \
  --args '{"url":"https://www.walmart.com/search?q=iphone+&page=2&affinityOverride=default","timeout":120,"geo_code":"US","block_resources":false}'

"""
