import asyncio
import json

import httpx

from mrscraper_mcp.api import (
    create_ai_scraper_api,
    fetch_with_unblocker_api,
    rerun_ai_scraper_api,
    google_serp_sync_api,
    normalize_serp_input,
)
from mrscraper_mcp.http_helpers import request, sanitize_response_data


def run(coroutine):
    return asyncio.run(coroutine)


def test_response_sanitization_removes_headers_and_nested_credentials():
    def handler(incoming: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "set-cookie": "secret-cookie",
                "x-api-token": "secret-token",
                "x-request-id": "request-1",
            },
            json={
                "latestApiToken": "atk_fakefakefakefake",
                "curl": (
                    "curl 'https://api.example/?token=atk_fakefakefakefake' "
                    "-H 'x-api-token: atk_fakefakefakefake'"
                ),
                "tokenUsage": 12,
            },
        )

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await request("GET", "https://example.com", client=client)

    result = run(exercise())
    assert result["headers"] == {
        "content-length": result["headers"]["content-length"],
        "content-type": "application/json",
        "x-request-id": "request-1",
    }
    assert result["data"]["latestApiToken"] == "[REDACTED]"
    assert "atk_fakefakefakefake" not in json.dumps(result)
    assert result["data"]["tokenUsage"] == 12


def test_sanitize_response_data_redacts_signed_query_parameters():
    sanitized = sanitize_response_data(
        "https://example.com/file?x-amz-signature=secret&token=atk_abcdefghijkl"
    )
    assert "secret" not in sanitized
    assert "atk_abcdefghijkl" not in sanitized


def test_auto_unblock_escalates_challenge_page_without_query_token():
    requests: list[httpx.Request] = []

    def handler(incoming: httpx.Request) -> httpx.Response:
        requests.append(incoming)
        body = (
            "<html><body>Checking your browser - captcha</body></html>"
            if len(requests) == 1
            else "<html><body>Available</body></html>"
        )
        return httpx.Response(200, headers={"content-type": "text/html"}, text=body)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await fetch_with_unblocker_api(
                token="test-token",
                url="https://target.example",
                unblock="auto",
                client=client,
            )

    result = run(exercise())
    assert len(requests) == 2
    assert requests[0].url.params["browserRendering"] == "false"
    assert requests[0].url.params["maxRetries"] == "0"
    assert requests[1].url.params["browserRendering"] == "true"
    assert requests[1].url.params["maxRetries"] == "3"
    assert "token" not in requests[0].url.params
    assert requests[0].headers["authorization"] == "Bearer test-token"
    assert requests[0].headers["x-api-token"] == "test-token"
    assert result["unblocker"] == {
        "requested": "auto",
        "browser_rendering": True,
        "escalated": True,
        "attempts": 2,
    }


def test_never_unblock_rejects_selector_before_request():
    async def exercise():
        return await fetch_with_unblocker_api(
            token="test-token",
            url="https://target.example",
            unblock="never",
            wait_for_selector=".ready",
        )

    try:
        run(exercise())
    except ValueError as exc:
        assert "requires browser rendering" in str(exc)
    else:
        raise AssertionError("Expected selector validation to fail")


def test_listing_scrape_sends_max_pages():
    captured: dict = {}

    def handler(incoming: httpx.Request) -> httpx.Response:
        captured.update(json.loads(incoming.content))
        return httpx.Response(200, json={"data": {"id": "listing-1"}})

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await create_ai_scraper_api(
                token="test-token",
                url="https://target.example/listings",
                message="Extract every listing",
                agent="listing",
                max_pages=4,
                client=client,
            )

    result = run(exercise())
    assert result["status_code"] == 200
    assert captured["agent"] == "listing"
    assert captured["maxPages"] == 4


def test_ai_rerun_preserves_node_fetch_request_profile():
    captured: dict[str, str] = {}

    def handler(incoming: httpx.Request) -> httpx.Response:
        captured.update(incoming.headers)
        return httpx.Response(201, json={"data": {"id": "rerun-1"}})

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await rerun_ai_scraper_api(
                token="test-token",
                scraper_id="scraper-1",
                url="https://target.example",
                client=client,
            )

    result = run(exercise())
    assert result["status_code"] == 201
    assert captured["user-agent"] == "node"
    assert captured["accept-language"] == "*"
    assert captured["sec-fetch-mode"] == "cors"
    assert captured["authorization"] == "Bearer test-token"
    assert captured["x-api-token"] == "test-token"


def test_serp_accepts_query_and_google_url_with_v2_payload():
    assert normalize_serp_input(
        "https://www.google.com/search?q=running+shoes&gl=us&hl=en&start=20"
    ) == {
        "query": "running shoes",
        "region": "us",
        "language": "en",
        "page": 3,
    }

    captured: dict = {}
    captured_path = ""

    def handler(incoming: httpx.Request) -> httpx.Response:
        nonlocal captured_path
        captured_path = incoming.url.path
        captured.update(json.loads(incoming.content))
        return httpx.Response(200, json={"success": True})

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await google_serp_sync_api(
                token="test-token",
                query_or_url="iphone 17",
                region="id",
                language="id",
                page=2,
                format="json",
                render_js=True,
                client=client,
            )

    run(exercise())
    assert captured_path == "/api/google/serp/v2/sync"
    assert captured == {
        "query": "iphone 17",
        "region": "id",
        "language": "id",
        "page": 2,
        "format": "json",
        "renderJs": True,
    }
