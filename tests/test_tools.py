import asyncio
from importlib.metadata import version
import json

import httpx
from fastmcp import Client

from mrscraper_mcp.app import app, mcp
from mrscraper_mcp.tools import cli as cli_tools
from mrscraper_mcp.version import __version__


def run(coroutine):
    return asyncio.run(coroutine)


def test_registered_surface_uses_cli_command_names():
    async def get_names_and_status_schema():
        tools = await mcp.list_tools(run_middleware=False)
        status_tool = await mcp.get_tool("status")
        return [tool.name for tool in tools], status_tool.parameters

    names, status_schema = run(get_names_and_status_schema())

    assert names == [
        "fetch",
        "scrape",
        "serp",
        "status",
        "rerun",
        "results",
        "result",
    ]
    assert "from" in status_schema["properties"]
    assert "from_" not in status_schema["properties"]


def test_http_app_uses_stateless_mcp_and_health_routes():
    routes = {
        getattr(route, "path", None): set(getattr(route, "methods", set()) or set())
        for route in app.routes
    }
    assert routes["/mcp"] == {"POST", "DELETE"}
    assert routes["/health"] == {"GET", "HEAD"}
    assert routes["/ready"] == {"GET", "HEAD"}
    assert "/chatgpt" not in routes
    assert "/.well-known/openai-apps-challenge" not in routes


def test_health_ready_and_origin_protection():
    async def check_routes():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            health = await client.get("/health")
            ready = await client.get("/ready")
            forbidden = await client.post(
                "/mcp",
                headers={"Origin": "https://evil.example"},
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
            )
            removed = await client.get("/.well-known/openai-apps-challenge")
        return health, ready, forbidden, removed

    health, ready, forbidden, removed = run(check_routes())
    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "service": "mrscraper-mcp",
        "version": "0.1.0",
    }
    assert ready.status_code == 200
    assert ready.json()["status"] == "ready"
    assert forbidden.status_code == 403
    assert forbidden.text == "Forbidden Origin"
    assert removed.status_code == 404


def test_x_api_token_does_not_bypass_default_http_bearer_auth():
    async def initialize_with_only_x_api_token():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as client:
            return await client.post(
                "/mcp",
                headers={
                    "x-api-token": "not-a-real-key",
                    "Accept": "application/json, text/event-stream",
                },
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-11-25",
                        "capabilities": {},
                        "clientInfo": {"name": "auth-test", "version": "1"},
                    },
                },
            )

    response = run(initialize_with_only_x_api_token())
    assert response.status_code == 401


def test_server_advertises_mrscraper_version():
    async def initialize():
        async with Client(mcp) as client:
            return client.initialize_result.serverInfo.version

    assert __version__ == "0.1.0"
    assert version("MrScraper-MCP") == __version__
    assert run(initialize()) == __version__


def test_promptless_scrape_uses_deprecated_html_fetch_path(monkeypatch):
    captured = {}

    async def fake_fetch(token, **kwargs):
        captured["token"] = token
        captured.update(kwargs)
        return {"status_code": 200, "format": kwargs["format"]}

    monkeypatch.setattr(cli_tools, "_fetch_with_token", fake_fetch)
    result = run(cli_tools._scrape_with_token("test", url="https://target.example"))
    assert result == {"status_code": 200, "format": "html"}
    assert captured["unblock"] == "auto"
    assert captured["geo"] == "US"
    assert captured["timeout"] == 120


def test_structured_scrape_embeds_schema_and_listing_page_limit(monkeypatch):
    captured = {}

    async def fake_create(**kwargs):
        captured.update(kwargs)
        return {"status_code": 200}

    monkeypatch.setattr(cli_tools, "create_ai_scraper_api", fake_create)
    result = run(
        cli_tools._scrape_with_token(
            "test",
            url="https://target.example/listings",
            prompt="Extract each product",
            schema={
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"price": {"type": "number"}},
                },
            },
            agent="listing",
            max_pages=3,
        )
    )
    assert result["status_code"] == 200
    assert captured["agent"] == "listing"
    assert captured["max_pages"] == 3
    assert "Return JSON matching this JSON Schema" in captured["message"]
    assert '"price"' in captured["message"]


def test_status_combines_account_and_domain_analytics(monkeypatch):
    async def fake_account(**_kwargs):
        return {
            "status_code": 200,
            "data": {"data": {"tokenLimit": 100, "tokenUsage": 10, "user": {}}},
        }

    async def fake_analytics(**kwargs):
        assert kwargs["domain"] == "www.example.com"
        assert kwargs["start_date"] == "2026-08-09 12:00:00"
        assert kwargs["end_date"] == "2026-08-10 12:00:00"
        return {"status_code": 200, "data": {"data": {"successRate": 80}}}

    monkeypatch.setattr(cli_tools, "get_subscription_account_api", fake_account)
    monkeypatch.setattr(cli_tools, "get_analytic_statuses_api", fake_analytics)
    output = run(
        cli_tools._status_with_token(
            "test",
            domain="https://www.example.com/products",
            from_="24h",
            to="2026-08-10T12:00:00Z",
        )
    )
    assert output["data"]["account"]["token_remaining"] == 90
    assert output["data"]["analytics"]["successRate"] == 80


def test_registered_status_accepts_cli_from_property(monkeypatch):
    captured = {}

    async def fake_account(**_kwargs):
        return {
            "status_code": 200,
            "data": {"data": {"tokenLimit": 100, "tokenUsage": 20, "user": {}}},
        }

    async def fake_analytics(**kwargs):
        captured.update(kwargs)
        return {"status_code": 200, "data": {"data": {"countAll": 5}}}

    monkeypatch.setattr(cli_tools, "resolve_api_token", lambda: "test")
    monkeypatch.setattr(cli_tools, "get_subscription_account_api", fake_account)
    monkeypatch.setattr(cli_tools, "get_analytic_statuses_api", fake_analytics)

    async def call_tool():
        return await mcp.call_tool(
            "status",
            {
                "domain": "example.com",
                "from": "7d",
                "to": "2026-08-10T12:00:00Z",
            },
            run_middleware=False,
        )

    tool_result = run(call_tool())
    assert captured["start_date"] == "2026-08-03 12:00:00"
    assert captured["end_date"] == "2026-08-10 12:00:00"
    assert tool_result.structured_content["data"]["account"]["token_remaining"] == 80


def test_bulk_manual_rerun_parses_cli_style_target(monkeypatch):
    captured = {}

    async def fake_bulk(**kwargs):
        captured.update(kwargs)
        return {"status_code": 200}

    monkeypatch.setattr(cli_tools, "bulk_rerun_manual_scraper_api", fake_bulk)
    result = run(
        cli_tools._rerun_with_token(
            "test",
            target="https://a.example,https://b.example\nhttps://c.example",
            type="manual",
            bulk=True,
            id="scraper-1",
        )
    )
    assert result["status_code"] == 200
    assert captured["scraper_id"] == "scraper-1"
    assert captured["urls"] == [
        "https://a.example",
        "https://b.example",
        "https://c.example",
    ]


def test_tool_schema_is_json_serializable():
    async def schemas():
        tools = await mcp.list_tools(run_middleware=False)
        return {
            tool.name: {
                "input": tool.parameters,
                "output": tool.output_schema,
            }
            for tool in tools
        }

    schemas = json.loads(json.dumps(run(schemas())))
    assert schemas["serp"]["input"]["type"] == "object"
    assert schemas["fetch"]["output"]["title"] == "Fetch response"
    assert schemas["status"]["output"]["title"] == "Status response"
    for schema in schemas.values():
        assert schema["output"] != {
            "type": "object",
            "additionalProperties": True,
        }


def test_every_tool_parameter_has_a_model_facing_description():
    async def schema_descriptions():
        tools = await mcp.list_tools(run_middleware=False)
        return {
            tool.name: {
                name: property_schema.get("description", "").strip()
                for name, property_schema in tool.parameters.get(
                    "properties", {}
                ).items()
            }
            for tool in tools
        }

    descriptions = run(schema_descriptions())
    missing = {
        tool_name: [name for name, description in properties.items() if not description]
        for tool_name, properties in descriptions.items()
        if any(not description for description in properties.values())
    }

    assert missing == {}


def test_tool_input_schemas_publish_enforceable_numeric_limits():
    async def input_schemas():
        tools = await mcp.list_tools(run_middleware=False)
        return {tool.name: tool.parameters for tool in tools}

    schemas = run(input_schemas())
    assert schemas["fetch"]["properties"]["retries"]["minimum"] == 0
    assert schemas["fetch"]["properties"]["timeout"]["minimum"] == 1
    assert schemas["rerun"]["properties"]["max_pages"]["minimum"] == 1
    assert schemas["results"]["properties"]["page"]["minimum"] == 1
    assert schemas["result"]["properties"]["result_id"]["minLength"] == 1


def test_read_only_tools_publish_safety_annotations():
    async def annotations_by_tool():
        tools = await mcp.list_tools(run_middleware=False)
        return {tool.name: tool.annotations for tool in tools}

    annotations = run(annotations_by_tool())
    for tool_name in ("fetch", "serp", "status", "results", "result"):
        assert annotations[tool_name].readOnlyHint is True
        assert annotations[tool_name].destructiveHint is False


def test_upstream_failure_is_an_mcp_tool_error(monkeypatch):
    async def fake_fetch(**_kwargs):
        return {
            "error": "HTTP 503",
            "status_code": 503,
            "data": {"message": "Service temporarily unavailable"},
            "headers": {},
            "unblocker": {
                "requested": "auto",
                "browser_rendering": False,
                "escalated": False,
                "attempts": 1,
            },
        }

    monkeypatch.setattr(cli_tools, "resolve_api_token", lambda: "test")
    monkeypatch.setattr(cli_tools, "fetch_with_unblocker_api", fake_fetch)

    async def call_fetch():
        async with Client(mcp) as client:
            return await client.call_tool(
                "fetch",
                {"url": "https://example.com"},
                raise_on_error=False,
            )

    result = run(call_fetch())
    assert result.is_error is True
    assert "MrScraper API request failed (HTTP 503)" in result.content[0].text
    assert "Service temporarily unavailable" in result.content[0].text


def test_successful_fetch_matches_its_output_schema(monkeypatch):
    async def fake_fetch(**_kwargs):
        return {
            "status_code": 200,
            "data": "<html><body>Available</body></html>",
            "headers": {"content-type": "text/html"},
            "unblocker": {
                "requested": "auto",
                "browser_rendering": False,
                "escalated": False,
                "attempts": 1,
            },
        }

    monkeypatch.setattr(cli_tools, "resolve_api_token", lambda: "test")
    monkeypatch.setattr(cli_tools, "fetch_with_unblocker_api", fake_fetch)

    async def call_fetch():
        return await mcp.call_tool(
            "fetch",
            {"url": "https://example.com"},
            run_middleware=False,
        )

    result = run(call_fetch())
    assert result.structured_content["status_code"] == 200
    assert result.structured_content["format"] == "markdown"
    assert result.structured_content["unblocker"]["attempts"] == 1
