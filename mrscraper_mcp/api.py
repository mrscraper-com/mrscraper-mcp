"""Python port of the public data helpers in ``@mrscraper/cli``."""

from __future__ import annotations

import json
import re
from typing import Any, Literal
from urllib.parse import parse_qs, urlparse

import httpx

from mrscraper_mcp.auth import normalize_bearer_token
from mrscraper_mcp.constants import (
    ANALYTIC_STATUSES,
    FETCH_HTML_BASE_URL,
    GOOGLE_SERP_SYNC,
    RESULTS,
    SCRAPERS_AI,
    SCRAPERS_AI_RERUN,
    SCRAPERS_AI_RERUN_BULK,
    SCRAPERS_MANUAL_RERUN,
    SCRAPERS_MANUAL_RERUN_BULK,
    SUBSCRIPTION_ACCOUNTS,
)
from mrscraper_mcp.http_helpers import api_get, api_post

Agent = Literal["general", "listing", "map"]
UnblockPolicy = Literal["auto", "always", "never"]
SerpFormat = Literal["json", "html"]

# Node's native ``fetch`` adds these headers to every CLI request. The rerun
# gateway currently relies on that request profile, so the Python port must
# preserve it as well as the explicit authentication headers.
_CLI_FETCH_HEADERS = {
    "User-Agent": "node",
    "Accept-Language": "*",
    "Sec-Fetch-Mode": "cors",
}


def get_auth_headers(token: str) -> dict[str, str]:
    api_token = normalize_bearer_token(token)
    if not api_token:
        raise ValueError("API token is required")
    return {
        **_CLI_FETCH_HEADERS,
        "Authorization": f"Bearer {api_token}",
        "x-api-token": api_token,
    }


def _compact(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


async def fetch_content_api(
    *,
    token: str,
    url: str,
    timeout: int = 30,
    geo_code: str | None = None,
    browser_rendering: bool = False,
    wait_for_selector: str | None = None,
    home_page: bool = False,
    block_resources: bool = False,
    max_retries: int = 3,
    token_cap: int | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    params = _compact(
        {
            "url": url,
            "timeout": timeout,
            "geoCode": geo_code,
            "browserRendering": browser_rendering,
            "waitForSelector": wait_for_selector,
            "homePage": home_page,
            "blockResources": block_resources,
            "maxRetries": max_retries,
            "tokenCap": token_cap,
        }
    )
    return await api_get(
        FETCH_HTML_BASE_URL,
        headers=get_auth_headers(token),
        params=params,
        timeout=float(timeout + 30),
        client=client,
    )


_BLOCK_PAGE_PATTERNS = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\bcaptcha\b",
        r"access denied",
        r"verify (?:that )?you are (?:a )?human",
        r"checking (?:if|your) (?:the )?(?:site|browser|connection)",
        r"unusual traffic",
        r"cf-chl-",
        r"cloudflare ray id",
        r"datadome",
        r"incapsula",
        r"perimeterx",
    )
)


def is_likely_blocked_result(result: dict[str, Any]) -> bool:
    status_code = result.get("status_code")
    if status_code is None:
        return True
    if status_code in {408, 500, 502, 503, 504}:
        return True
    if isinstance(result.get("data"), str) and status_code in {403, 429}:
        return True

    data = result.get("data")
    sample = data if isinstance(data, str) else json.dumps(data or {}, default=str)
    sample = sample[:250_000]
    if re.search(r"failed to open url|navigation failed|target.*blocked", sample, re.I):
        return True
    return any(pattern.search(sample) for pattern in _BLOCK_PAGE_PATTERNS)


async def fetch_with_unblocker_api(
    *,
    token: str,
    url: str,
    unblock: UnblockPolicy = "auto",
    timeout: int = 30,
    geo_code: str | None = None,
    wait_for_selector: str | None = None,
    home_page: bool = False,
    block_resources: bool = False,
    max_retries: int = 3,
    token_cap: int | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    if unblock not in {"auto", "always", "never"}:
        raise ValueError("unblock must be auto, always, or never")
    if unblock == "never" and wait_for_selector:
        raise ValueError(
            "wait_for requires browser rendering; use unblock='auto' or 'always'"
        )

    rendering_required = unblock == "always" or bool(wait_for_selector)
    first = await fetch_content_api(
        token=token,
        url=url,
        timeout=timeout,
        geo_code=geo_code,
        browser_rendering=rendering_required,
        wait_for_selector=wait_for_selector,
        home_page=home_page,
        block_resources=block_resources,
        max_retries=0 if unblock == "auto" and not rendering_required else max_retries,
        token_cap=token_cap,
        client=client,
    )
    should_escalate = (
        unblock == "auto" and not rendering_required and is_likely_blocked_result(first)
    )
    if not should_escalate:
        return {
            **first,
            "unblocker": {
                "requested": unblock,
                "browser_rendering": rendering_required,
                "escalated": False,
                "attempts": 1,
            },
        }

    second = await fetch_content_api(
        token=token,
        url=url,
        timeout=timeout,
        geo_code=geo_code,
        browser_rendering=True,
        wait_for_selector=wait_for_selector,
        home_page=home_page,
        block_resources=block_resources,
        max_retries=max_retries,
        token_cap=token_cap,
        client=client,
    )
    return {
        **second,
        "unblocker": {
            "requested": unblock,
            "browser_rendering": True,
            "escalated": True,
            "attempts": 2,
        },
    }


async def create_ai_scraper_api(
    *,
    token: str,
    url: str,
    message: str,
    agent: Agent = "general",
    proxy_country: str | None = None,
    max_depth: int = 2,
    max_pages: int = 50,
    limit: int = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    if agent in {"general", "listing"}:
        payload: dict[str, Any] = {
            "url": url,
            "message": message,
            "agent": agent,
            "proxyCountry": proxy_country,
        }
        if agent == "listing":
            payload["maxPages"] = max_pages
    else:
        payload = {
            "url": url,
            "agent": agent,
            "maxDepth": max_depth,
            "maxPages": max_pages,
            "limit": limit,
            "includePatterns": include_patterns,
            "excludePatterns": exclude_patterns,
        }
    return await api_post(
        SCRAPERS_AI,
        headers={"accept": "application/json", **get_auth_headers(token)},
        json_body=payload,
        client=client,
    )


async def rerun_ai_scraper_api(
    *,
    token: str,
    scraper_id: str,
    url: str,
    max_depth: int = 2,
    max_pages: int = 50,
    limit: int = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    return await api_post(
        SCRAPERS_AI_RERUN,
        headers={"accept": "application/json", **get_auth_headers(token)},
        json_body={
            "scraperId": scraper_id,
            "url": url,
            "maxDepth": max_depth,
            "maxPages": max_pages,
            "limit": limit,
            "includePatterns": include_patterns,
            "excludePatterns": exclude_patterns,
        },
        client=client,
    )


async def bulk_rerun_ai_scraper_api(
    *,
    token: str,
    scraper_id: str,
    urls: list[str],
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    return await api_post(
        SCRAPERS_AI_RERUN_BULK,
        headers={"accept": "application/json", **get_auth_headers(token)},
        json_body={"scraperId": scraper_id, "urls": urls},
        client=client,
    )


async def rerun_manual_scraper_api(
    *,
    token: str,
    scraper_id: str,
    url: str,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    return await api_post(
        SCRAPERS_MANUAL_RERUN,
        headers={"accept": "application/json", **get_auth_headers(token)},
        json_body={"scraperId": scraper_id, "url": url},
        client=client,
    )


async def bulk_rerun_manual_scraper_api(
    *,
    token: str,
    scraper_id: str,
    urls: list[str],
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    return await api_post(
        SCRAPERS_MANUAL_RERUN_BULK,
        headers={"accept": "application/json", **get_auth_headers(token)},
        json_body={"scraperId": scraper_id, "urls": urls},
        client=client,
    )


async def get_all_results_api(
    *,
    token: str,
    sort_field: str = "updatedAt",
    sort_order: str = "DESC",
    page_size: int = 10,
    page: int = 1,
    search: str | None = None,
    date_range_column: str | None = None,
    start_at: str | None = None,
    end_at: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    params = _compact(
        {
            "sortField": sort_field,
            "sortOrder": sort_order,
            "pageSize": page_size,
            "page": page,
            "search": search,
            "dateRangeColumn": date_range_column,
            "startAt": start_at,
            "endAt": end_at,
        }
    )
    return await api_get(
        RESULTS,
        headers={"accept": "application/json", **get_auth_headers(token)},
        params=params,
        client=client,
    )


async def get_result_by_id_api(
    *, token: str, result_id: str, client: httpx.AsyncClient | None = None
) -> dict[str, Any]:
    return await api_get(
        f"{RESULTS}/{result_id}",
        headers={"accept": "application/json", **get_auth_headers(token)},
        client=client,
    )


async def get_subscription_account_api(
    *, token: str, client: httpx.AsyncClient | None = None
) -> dict[str, Any]:
    return await api_get(
        SUBSCRIPTION_ACCOUNTS,
        headers={"accept": "application/json", **get_auth_headers(token)},
        client=client,
    )


async def get_analytic_statuses_api(
    *,
    token: str,
    domain: str,
    start_date: str,
    end_date: str,
    action: str = "",
    api_token_name: str = "",
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    return await api_get(
        ANALYTIC_STATUSES,
        headers={"accept": "application/json", **get_auth_headers(token)},
        params={
            "domain": domain,
            "startDate": start_date,
            "endDate": end_date,
            "action": action,
            "apiTokenName": api_token_name,
        },
        client=client,
    )


def normalize_serp_input(input_value: str) -> dict[str, Any]:
    value = str(input_value or "").strip()
    if not value:
        raise ValueError("A Google search query or URL is required")

    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"}:
        query_values = parse_qs(parsed.query)
        query = (query_values.get("q") or [""])[0].strip()
        if not query:
            raise ValueError("Google search URL must contain a q parameter")
        try:
            start = int((query_values.get("start") or ["0"])[0])
        except ValueError:
            start = 0
        return {
            "query": query,
            "region": (query_values.get("gl") or [None])[0],
            "language": (query_values.get("hl") or [None])[0],
            "page": start // 10 + 1 if start > 0 else None,
        }
    return {"query": value, "region": None, "language": None, "page": None}


async def google_serp_sync_api(
    *,
    token: str,
    query_or_url: str,
    region: str | None = None,
    language: str | None = None,
    page: int | None = None,
    format: SerpFormat = "json",
    render_js: bool = False,
    raw: bool = False,
    timeout: int = 120,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    normalized = normalize_serp_input(query_or_url)
    resolved_format = "html" if raw else format
    if resolved_format not in {"json", "html"}:
        raise ValueError("SERP format must be json or html")
    payload = _compact(
        {
            "query": normalized["query"],
            "region": region or normalized["region"],
            "language": language or normalized["language"],
            "page": page or normalized["page"],
            "format": resolved_format,
            "renderJs": bool(render_js),
        }
    )
    return await api_post(
        GOOGLE_SERP_SYNC,
        headers={"accept": "application/json", **get_auth_headers(token)},
        json_body=payload,
        timeout=float(timeout),
        client=client,
    )


def parse_bulk_urls(raw: str | list[str]) -> list[str]:
    if isinstance(raw, list):
        return [str(url).strip() for url in raw if str(url).strip()]
    return [part.strip() for part in re.split(r"[,|\n]", raw) if part.strip()]
