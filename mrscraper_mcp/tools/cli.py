"""Canonical MCP tools matching the public ``mrscraper`` CLI data commands."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Annotated, Any, Literal
from urllib.parse import urlparse

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from mrscraper_mcp.api import (
    Agent,
    SerpFormat,
    UnblockPolicy,
    bulk_rerun_ai_scraper_api,
    bulk_rerun_manual_scraper_api,
    create_ai_scraper_api,
    fetch_with_unblocker_api,
    get_all_results_api,
    get_analytic_statuses_api,
    get_result_by_id_api,
    get_subscription_account_api,
    google_serp_sync_api,
    parse_bulk_urls,
    rerun_ai_scraper_api,
    rerun_manual_scraper_api,
)
from mrscraper_mcp.auth import resolve_api_token
from mrscraper_mcp.content import FetchFormat, format_fetch_result
from mrscraper_mcp.http_helpers import sanitize_response_data
from mrscraper_mcp.status import (
    format_api_date,
    parse_status_date,
    summarize_subscription_account,
)

DEFAULT_GENERAL_PROMPT = "Get all data as complete as possible"
SortField = Literal[
    "createdAt",
    "updatedAt",
    "id",
    "type",
    "url",
    "status",
    "error",
    "tokenUsage",
    "runtime",
]
SortOrder = Literal["ASC", "DESC"]
RerunType = Literal["ai", "manual"]
PositiveInt = Annotated[int, Field(ge=1)]
NonNegativeInt = Annotated[int, Field(ge=0)]
NonEmptyString = Annotated[str, Field(min_length=1)]


def _response_properties() -> dict[str, Any]:
    return {
        "status_code": {
            "type": "integer",
            "description": "HTTP status returned by the MrScraper service.",
        },
        "data": {"description": "Sanitized response payload returned by MrScraper."},
        "headers": {
            "type": "object",
            "description": "Safe response headers; credentials and cookies are removed.",
            "additionalProperties": {"type": "string"},
        },
    }


def _api_response_schema(title: str, description: str) -> dict[str, Any]:
    return {
        "title": title,
        "description": description,
        "type": "object",
        "properties": _response_properties(),
        "required": ["status_code", "data", "headers"],
        "additionalProperties": False,
    }


FETCH_OUTPUT_SCHEMA: dict[str, Any] = {
    "title": "Fetch response",
    "description": "Formatted page content and unblocker execution metadata.",
    "type": "object",
    "properties": {
        **_response_properties(),
        "format": {"type": "string", "enum": ["markdown", "html", "json"]},
        "url": {"type": "string"},
        "unblocker": {
            "type": "object",
            "properties": {
                "requested": {
                    "type": "string",
                    "enum": ["auto", "always", "never"],
                },
                "browser_rendering": {"type": "boolean"},
                "escalated": {"type": "boolean"},
                "attempts": {"type": "integer", "minimum": 1},
            },
            "required": [
                "requested",
                "browser_rendering",
                "escalated",
                "attempts",
            ],
            "additionalProperties": False,
        },
    },
    "required": ["status_code", "data", "headers", "format", "url", "unblocker"],
    "additionalProperties": False,
}

SCRAPE_OUTPUT_SCHEMA: dict[str, Any] = {
    "title": "Scrape response",
    "description": (
        "Structured extraction response, or the deprecated fetch-compatible response "
        "when no extraction arguments are supplied."
    ),
    "type": "object",
    "properties": {
        **_response_properties(),
        "format": {
            "type": "string",
            "enum": ["markdown", "html", "json"],
            "description": "Present only for promptless fetch-compatible calls.",
        },
        "url": {
            "type": "string",
            "description": "Present only for promptless fetch-compatible calls.",
        },
        "unblocker": FETCH_OUTPUT_SCHEMA["properties"]["unblocker"],
    },
    "required": ["status_code", "data", "headers"],
    "additionalProperties": False,
}

SERP_OUTPUT_SCHEMA = _api_response_schema(
    "SERP response", "Parsed Google results or raw result-page HTML."
)
RERUN_OUTPUT_SCHEMA = _api_response_schema(
    "Rerun response", "MrScraper response for a saved scraper rerun."
)
RESULTS_OUTPUT_SCHEMA = _api_response_schema(
    "Results response", "Paginated stored MrScraper results."
)
RESULT_OUTPUT_SCHEMA = _api_response_schema(
    "Result response", "One stored MrScraper result."
)

_NULLABLE_STRING_SCHEMA = {
    "anyOf": [{"type": "string"}, {"type": "null"}],
}
_NUMBER_SCHEMA = {"type": "number"}
STATUS_OUTPUT_SCHEMA: dict[str, Any] = {
    "title": "Status response",
    "description": "Account usage and optional domain request-outcome analytics.",
    "type": "object",
    "properties": {
        "status_code": {"type": "integer"},
        "data": {
            "type": "object",
            "properties": {
                "account": {
                    "type": "object",
                    "properties": {
                        "subscription_status": _NULLABLE_STRING_SCHEMA,
                        "enterprise": {"type": "boolean"},
                        "token_usage": _NUMBER_SCHEMA,
                        "token_limit": _NUMBER_SCHEMA,
                        "token_remaining": _NUMBER_SCHEMA,
                        "usage_percent": _NUMBER_SCHEMA,
                        "rate_limit": _NUMBER_SCHEMA,
                        "rate_ttl": _NUMBER_SCHEMA,
                        "auto_renew": {"type": "boolean"},
                        "ends_at": _NULLABLE_STRING_SCHEMA,
                        "user": {
                            "type": "object",
                            "properties": {
                                "name": _NULLABLE_STRING_SCHEMA,
                                "email": _NULLABLE_STRING_SCHEMA,
                                "verified": {"type": "boolean"},
                            },
                            "required": ["name", "email", "verified"],
                            "additionalProperties": False,
                        },
                    },
                    "required": [
                        "subscription_status",
                        "enterprise",
                        "token_usage",
                        "token_limit",
                        "token_remaining",
                        "usage_percent",
                        "rate_limit",
                        "rate_ttl",
                        "auto_renew",
                        "ends_at",
                        "user",
                    ],
                    "additionalProperties": False,
                },
                "analytics": {
                    "type": "object",
                    "description": "Present when a domain is supplied.",
                    "additionalProperties": True,
                },
            },
            "required": ["account"],
            "additionalProperties": False,
        },
    },
    "required": ["status_code", "data"],
    "additionalProperties": False,
}


def _raise_for_api_error(result: dict[str, Any]) -> dict[str, Any]:
    """Translate CLI-style error envelopes into MCP tool errors."""
    if not result.get("error"):
        return result

    error = str(sanitize_response_data(result["error"]))
    status_code = result.get("status_code")
    status = f"HTTP {status_code}" if status_code is not None else "no HTTP response"

    detail = ""
    data = result.get("data")
    if isinstance(data, dict):
        candidate = data.get("message") or data.get("error")
        if candidate:
            sanitized = str(sanitize_response_data(candidate)).strip()
            if sanitized and sanitized != error:
                detail = f": {sanitized[:500]}"

    raise ToolError(f"MrScraper API request failed ({status}): {error}{detail}")


def _require_integer(value: int, name: str, minimum: int = 1) -> None:
    if isinstance(value, bool) or value < minimum:
        raise ToolError(f"{name} must be an integer >= {minimum}")


def _build_extraction_message(prompt: str | None, schema: dict[str, Any] | None) -> str:
    instruction = (
        prompt.strip() if prompt and prompt.strip() else DEFAULT_GENERAL_PROMPT
    )
    if schema is None:
        return instruction
    if not isinstance(schema, dict):
        raise ToolError("schema must be a JSON object")
    return (
        f"{instruction}\n\nReturn JSON matching this JSON Schema:\n"
        f"{json.dumps(schema, indent=2, ensure_ascii=False)}"
    )


def _unwrap_api_data(response: dict[str, Any]) -> Any:
    body = response.get("data")
    if isinstance(body, dict) and "data" in body:
        return body["data"]
    return body


def _normalize_domain(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise ToolError("domain must not be empty")
    parsed = urlparse(
        candidate
        if candidate.lower().startswith(("http://", "https://"))
        else f"https://{candidate}"
    )
    if not parsed.hostname:
        raise ToolError(f"Invalid domain: {value}")
    return parsed.hostname


async def _fetch_with_token(
    token: str,
    *,
    url: str,
    format: FetchFormat = "markdown",
    unblock: UnblockPolicy = "auto",
    geo: str | None = None,
    wait_for: str | None = None,
    homepage: bool = False,
    block_resources: bool = False,
    retries: int = 3,
    token_cap: int | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    _require_integer(timeout, "timeout")
    _require_integer(retries, "retries", 0)
    if token_cap is not None:
        _require_integer(token_cap, "token_cap")
    try:
        response = await fetch_with_unblocker_api(
            token=token,
            url=url,
            unblock=unblock,
            timeout=timeout,
            geo_code=geo,
            wait_for_selector=wait_for,
            home_page=homepage,
            block_resources=block_resources,
            max_retries=retries,
            token_cap=token_cap,
        )
        return format_fetch_result(response, format=format, url=url)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


async def fetch(
    url: NonEmptyString,
    format: FetchFormat = "markdown",
    unblock: UnblockPolicy = "auto",
    geo: str | None = None,
    wait_for: str | None = None,
    homepage: bool = False,
    block_resources: bool = False,
    retries: NonNegativeInt = 3,
    token_cap: PositiveInt | None = None,
    timeout: PositiveInt = 30,
) -> dict[str, Any]:
    """Fetch a known URL as Markdown, HTML, or a clean page-document object.

    ``unblock='auto'`` starts without browser rendering and escalates when a
    challenge or retryable block is detected. Use ``always`` for dynamic or
    blocked pages and ``wait_for`` for a CSS selector that must appear.

    Args:
        url: Absolute HTTP or HTTPS page URL to retrieve.
        format: Response content format. ``markdown`` returns readable page
            text, ``html`` returns page HTML, and ``json`` returns a clean
            page-document object.
        unblock: Browser-rendering policy. ``auto`` escalates only after a
            challenge or retryable block, ``always`` renders immediately, and
            ``never`` forbids rendering.
        geo: Optional ISO 3166-1 alpha-2 proxy country code, such as ``US`` or
            ``ID``.
        wait_for: Optional CSS selector that must appear before capture. This
            requires browser rendering and cannot be combined with
            ``unblock='never'``.
        homepage: Visit the target site's home page before loading ``url``.
        block_resources: Block non-essential browser resources during a
            rendered request.
        retries: Maximum API retry attempts after escalation. Use ``0`` to
            disable retries.
        token_cap: Optional maximum token usage allowed across retries.
        timeout: Maximum page-load duration in seconds.
    """
    return _raise_for_api_error(
        await _fetch_with_token(
            resolve_api_token(),
            url=url,
            format=format,
            unblock=unblock,
            geo=geo,
            wait_for=wait_for,
            homepage=homepage,
            block_resources=block_resources,
            retries=retries,
            token_cap=token_cap,
            timeout=timeout,
        )
    )


async def _scrape_with_token(
    token: str,
    *,
    url: str,
    prompt: str | None = None,
    schema: dict[str, Any] | None = None,
    agent: Agent | None = None,
    proxy_country: str | None = None,
    max_pages: int | None = None,
    max_depth: int = 2,
    limit: int = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
    format: FetchFormat | None = None,
    unblock: UnblockPolicy | None = None,
    geo_code: str | None = None,
    wait_for: str | None = None,
    homepage: bool | None = None,
    block_resources: bool | None = None,
    retries: int | None = None,
    token_cap: int | None = None,
    timeout: int | None = None,
) -> dict[str, Any]:
    use_ai = any(value is not None for value in (prompt, schema, agent, proxy_country))
    if not use_ai:
        return await _fetch_with_token(
            token,
            url=url,
            format=format or "html",
            unblock=unblock or "auto",
            geo=geo_code or "US",
            wait_for=wait_for,
            homepage=bool(homepage),
            block_resources=bool(block_resources),
            retries=3 if retries is None else retries,
            token_cap=token_cap,
            timeout=120 if timeout is None else timeout,
        )

    fetch_only_options = [
        name
        for name, value in (
            ("format", format),
            ("unblock", unblock),
            ("geo_code", geo_code),
            ("wait_for", wait_for),
            ("homepage", homepage),
            ("block_resources", block_resources),
            ("retries", retries),
            ("token_cap", token_cap),
            ("timeout", timeout),
        )
        if value is not None
    ]
    if fetch_only_options:
        rendered = ", ".join(fetch_only_options)
        raise ToolError(
            f"The AI scrape API does not support these fetch-only options: {rendered}. "
            "Use fetch for unblocker controls; AI scrape supports proxy_country."
        )

    resolved_agent: Agent = agent or "general"
    if resolved_agent == "map" and schema is not None:
        raise ToolError("schema is not supported by the map agent")
    _require_integer(max_depth, "max_depth")
    _require_integer(limit, "limit")
    resolved_pages = (
        max_pages
        if max_pages is not None
        else (1 if resolved_agent == "listing" else 50)
    )
    _require_integer(resolved_pages, "max_pages")
    message = _build_extraction_message(prompt, schema)
    return await create_ai_scraper_api(
        token=token,
        url=url,
        message=message,
        agent=resolved_agent,
        proxy_country=proxy_country,
        max_depth=max_depth,
        max_pages=resolved_pages,
        limit=limit,
        include_patterns=include_patterns,
        exclude_patterns=exclude_patterns,
    )


async def scrape(
    url: NonEmptyString,
    prompt: str | None = None,
    schema: dict[str, Any] | None = None,
    agent: Agent | None = None,
    proxy_country: str | None = None,
    max_pages: PositiveInt | None = None,
    max_depth: PositiveInt = 2,
    limit: PositiveInt = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
    format: FetchFormat | None = None,
    unblock: UnblockPolicy | None = None,
    geo_code: str | None = None,
    wait_for: str | None = None,
    homepage: bool | None = None,
    block_resources: bool | None = None,
    retries: NonNegativeInt | None = None,
    token_cap: PositiveInt | None = None,
    timeout: PositiveInt | None = None,
) -> dict[str, Any]:
    """Extract structured data from a URL using a prompt, JSON Schema, or both.

    Use ``general`` for one page, ``listing`` for repeated records and bounded
    pagination, and ``map`` to discover URLs within a known site. ``schema`` is
    passed directly as a JSON object because an MCP server cannot read a schema
    path from the caller's machine. When no AI extraction option is supplied,
    the tool returns fetch-style HTML; prefer ``fetch`` for page content.

    Args:
        url: Absolute HTTP or HTTPS URL to extract data from.
        prompt: Natural-language extraction instructions. Supplying this
            enables AI extraction.
        schema: JSON Schema object describing the requested structured output.
            Supplying this enables AI extraction. It is not supported by the
            ``map`` agent.
        agent: Extraction mode. ``general`` handles a normal page, ``listing``
            extracts repeated records across bounded pages, and ``map``
            discovers URLs within the target site. AI extraction defaults to
            ``general``.
        proxy_country: Optional proxy country supported by the AI scrape API.
        max_pages: Maximum pages for listing or map extraction. When omitted,
            the effective default is ``1`` for ``listing`` and ``50`` for the
            other AI modes.
        max_depth: Maximum link depth for the ``map`` agent.
        limit: Maximum number of URL results for the ``map`` agent.
        include_patterns: Regular expression limiting URLs included by the
            ``map`` agent. An empty string applies no include filter.
        exclude_patterns: Regular expression excluding URLs from the ``map``
            agent. An empty string applies no exclude filter.
        format: Page format used only when ``prompt``, ``schema``, ``agent``,
            and ``proxy_country`` are all omitted. The effective default is
            ``html``.
        unblock: Browser-rendering policy used only in promptless page-fetch
            mode. The effective default is ``auto``.
        geo_code: Proxy region used only in promptless page-fetch mode. The
            effective default is ``US``.
        wait_for: CSS selector to await, used only in promptless page-fetch
            mode.
        homepage: Whether to visit the site home page first, used only in
            promptless page-fetch mode.
        block_resources: Whether to block non-essential browser resources,
            used only in promptless page-fetch mode.
        retries: Retry limit used only in promptless page-fetch mode. The
            effective default is ``3``.
        token_cap: Optional retry token cap used only in promptless page-fetch
            mode.
        timeout: Page-load timeout in seconds used only in promptless
            page-fetch mode. The effective default is ``120``.
    """
    return _raise_for_api_error(
        await _scrape_with_token(
            resolve_api_token(),
            url=url,
            prompt=prompt,
            schema=schema,
            agent=agent,
            proxy_country=proxy_country,
            max_pages=max_pages,
            max_depth=max_depth,
            limit=limit,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
            format=format,
            unblock=unblock,
            geo_code=geo_code,
            wait_for=wait_for,
            homepage=homepage,
            block_resources=block_resources,
            retries=retries,
            token_cap=token_cap,
            timeout=timeout,
        )
    )


async def _serp_with_token(
    token: str,
    *,
    query_or_url: str,
    region: str | None = None,
    language: str | None = None,
    page: int | None = None,
    format: SerpFormat = "json",
    render_js: bool = False,
    raw: bool = False,
    timeout: int = 120,
) -> dict[str, Any]:
    _require_integer(timeout, "timeout")
    if page is not None:
        _require_integer(page, "page")
    try:
        return await google_serp_sync_api(
            token=token,
            query_or_url=query_or_url,
            region=region,
            language=language,
            page=page,
            format=format,
            render_js=render_js,
            raw=raw,
            timeout=timeout,
        )
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


async def serp(
    query_or_url: NonEmptyString,
    region: str | None = None,
    language: str | None = None,
    page: PositiveInt | None = None,
    format: SerpFormat = "json",
    render_js: bool = False,
    raw: bool = False,
    timeout: PositiveInt = 120,
) -> dict[str, Any]:
    """Return Google results for a query or full Google search URL.

    JSON is the default. Use HTML only for the raw result page and enable
    ``render_js`` only for dynamic SERP features such as AI Overview.

    Args:
        query_or_url: Google search phrase or full Google search URL. For a URL,
            the ``q`` parameter supplies the query and ``gl``, ``hl``, and
            ``start`` provide optional region, language, and page defaults.
        region: Optional Google result country code, such as ``us`` or ``id``.
            This overrides a ``gl`` value in ``query_or_url``.
        language: Optional Google result language code, such as ``en`` or
            ``id``. This overrides an ``hl`` value in ``query_or_url``.
        page: Optional one-based result page. This overrides the page derived
            from ``start`` in a Google search URL.
        format: ``json`` for parsed search results or ``html`` for the raw
            result page.
        render_js: Wait for JavaScript rendering, including dynamic SERP
            features such as AI Overview.
        raw: Request raw HTML output. When true, this takes precedence over
            ``format``.
        timeout: Maximum request duration in seconds.
    """
    return _raise_for_api_error(
        await _serp_with_token(
            resolve_api_token(),
            query_or_url=query_or_url,
            region=region,
            language=language,
            page=page,
            format=format,
            render_js=render_js,
            raw=raw,
            timeout=timeout,
        )
    )


async def _status_with_token(
    token: str,
    *,
    domain: str | None = None,
    from_: str = "24h",
    to: str = "now",
    action: str | None = None,
    api_token_name: str | None = None,
) -> dict[str, Any]:
    account_response = await get_subscription_account_api(token=token)
    if account_response.get("error"):
        return account_response
    account = _unwrap_api_data(account_response)
    output: dict[str, Any] = {
        "status_code": account_response.get("status_code"),
        "data": {
            "account": summarize_subscription_account(
                account if isinstance(account, dict) else {}
            )
        },
    }
    if not domain:
        return output

    normalized_domain = _normalize_domain(domain)
    now = datetime.now(timezone.utc)
    try:
        end = parse_status_date(to, now, "now")
        start = parse_status_date(from_, end, "24h")
    except ValueError as exc:
        raise ToolError(str(exc)) from exc
    if start >= end:
        raise ToolError("from must be earlier than to")
    start_date = format_api_date(start)
    end_date = format_api_date(end)
    analytics_response = await get_analytic_statuses_api(
        token=token,
        domain=normalized_domain,
        start_date=start_date,
        end_date=end_date,
        action=action or "",
        api_token_name=api_token_name or "",
    )
    if analytics_response.get("error"):
        output["error"] = "Account loaded, but analytics could not be loaded"
        output["data"]["analytics"] = analytics_response
    else:
        analytics = _unwrap_api_data(analytics_response)
        output["data"]["analytics"] = {
            "domain": normalized_domain,
            "from": f"{start_date} UTC",
            "to": f"{end_date} UTC",
            **(analytics if isinstance(analytics, dict) else {"data": analytics}),
        }
    return output


async def status(
    domain: str | None = None,
    from_: Annotated[
        str,
        Field(
            alias="from",
            description=(
                "Analytics range start as ISO 8601, `now`, or a relative "
                "duration such as `30m`, `24h`, or `7d`. Relative values are "
                "measured backward from `to`."
            ),
        ),
    ] = "24h",
    to: str = "now",
    action: str | None = None,
    api_token_name: str | None = None,
) -> dict[str, Any]:
    """Return subscription/quota status and optional scrape outcomes for a domain.

    ``from`` and ``to`` accept ISO 8601 values, ``now``, or relative durations
    such as ``30m``, ``24h``, and ``7d``. Domain analytics describe MrScraper
    request outcomes; they are not traffic or SEO analytics.

    Args:
        domain: Optional domain name or URL. When supplied, include MrScraper
            request-outcome analytics for its normalized hostname.
        from_: Analytics range start. Relative durations are measured backward
            from ``to``. Exposed to MCP clients as ``from``.
        to: Analytics range end as ISO 8601, ``now``, or a relative duration.
        action: Optional exact action filter for domain analytics.
        api_token_name: Optional API-token-name filter for domain analytics.
    """
    return _raise_for_api_error(
        await _status_with_token(
            resolve_api_token(),
            domain=domain,
            from_=from_,
            to=to,
            action=action,
            api_token_name=api_token_name,
        )
    )


async def _rerun_with_token(
    token: str,
    *,
    target: str | list[str],
    type: RerunType,
    bulk: bool = False,
    scraper_id: str | None = None,
    id: str | None = None,
    max_depth: int = 2,
    max_pages: int = 50,
    limit: int = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
) -> dict[str, Any]:
    if bulk:
        if not id:
            raise ToolError("id is required when bulk is true")
        urls = parse_bulk_urls(target)
        if not urls:
            raise ToolError("No URLs found in the bulk target")
        if type == "ai":
            return await bulk_rerun_ai_scraper_api(
                token=token, scraper_id=id, urls=urls
            )
        return await bulk_rerun_manual_scraper_api(
            token=token, scraper_id=id, urls=urls
        )

    if not scraper_id:
        raise ToolError("scraper_id is required unless bulk is true")
    if isinstance(target, list):
        if len(target) != 1:
            raise ToolError("A single rerun requires exactly one target URL")
        url = target[0].strip()
    else:
        url = target.strip()
    if not url:
        raise ToolError("target URL must not be empty")
    if type == "manual":
        return await rerun_manual_scraper_api(
            token=token, scraper_id=scraper_id, url=url
        )
    _require_integer(max_depth, "max_depth")
    _require_integer(max_pages, "max_pages")
    _require_integer(limit, "limit")
    return await rerun_ai_scraper_api(
        token=token,
        scraper_id=scraper_id,
        url=url,
        max_depth=max_depth,
        max_pages=max_pages,
        limit=limit,
        include_patterns=include_patterns,
        exclude_patterns=exclude_patterns,
    )


async def rerun(
    target: str | list[str],
    type: RerunType,
    bulk: bool = False,
    scraper_id: str | None = None,
    id: str | None = None,
    max_depth: PositiveInt = 2,
    max_pages: PositiveInt = 50,
    limit: PositiveInt = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
) -> dict[str, Any]:
    """Rerun a saved AI or manual scraper for one URL or a bulk URL list.

    Single reruns require ``scraper_id``. Bulk reruns require ``bulk=true`` and
    ``id``; ``target`` may be an array or comma/newline-separated string. Before
    a manual rerun, show the server's compliance warning and obtain acknowledgment.

    Args:
        target: One target URL for a single rerun. For a bulk rerun, pass an
            array of URLs or a string separated by commas, pipes, or newlines.
        type: Saved scraper type: ``ai`` or ``manual``.
        bulk: Submit all parsed target URLs through the bulk rerun endpoint.
        scraper_id: Saved scraper UUID required for a single rerun. Do not use
            this field for a bulk rerun.
        id: Saved scraper UUID required when ``bulk`` is true. Do not use this
            field for a single rerun.
        max_depth: Maximum crawl depth for a single AI rerun. Ignored by manual
            and bulk reruns.
        max_pages: Maximum pages for a single AI rerun. Ignored by manual and
            bulk reruns.
        limit: Maximum results for a single AI rerun. Ignored by manual and
            bulk reruns.
        include_patterns: URL include regular expression for a single AI
            rerun. An empty string applies no include filter.
        exclude_patterns: URL exclude regular expression for a single AI
            rerun. An empty string applies no exclude filter.
    """
    return _raise_for_api_error(
        await _rerun_with_token(
            resolve_api_token(),
            target=target,
            type=type,
            bulk=bulk,
            scraper_id=scraper_id,
            id=id,
            max_depth=max_depth,
            max_pages=max_pages,
            limit=limit,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
        )
    )


async def _results_with_token(
    token: str,
    *,
    sort_field: SortField = "updatedAt",
    sort_order: SortOrder = "DESC",
    page_size: int = 10,
    page: int = 1,
    search: str | None = None,
    date_range_column: str | None = None,
    start_at: str | None = None,
    end_at: str | None = None,
) -> dict[str, Any]:
    _require_integer(page_size, "page_size")
    _require_integer(page, "page")
    return await get_all_results_api(
        token=token,
        sort_field=sort_field,
        sort_order=sort_order,
        page_size=page_size,
        page=page,
        search=search,
        date_range_column=date_range_column,
        start_at=start_at,
        end_at=end_at,
    )


async def results(
    sort_field: SortField = "updatedAt",
    sort_order: SortOrder = "DESC",
    page_size: PositiveInt = 10,
    page: PositiveInt = 1,
    search: str | None = None,
    date_range_column: str | None = None,
    start_at: str | None = None,
    end_at: str | None = None,
) -> dict[str, Any]:
    """List stored scrape results with pagination, sorting, search, and dates.

    Args:
        sort_field: Result field used for sorting. Supported values are
            ``createdAt``, ``updatedAt``, ``id``, ``type``, ``url``, ``status``,
            ``error``, ``tokenUsage``, and ``runtime``.
        sort_order: Sort direction: ``ASC`` or ``DESC``.
        page_size: Number of rows requested per page.
        page: One-based page index.
        search: Optional free-text result search filter.
        date_range_column: Result column to which ``start_at`` and ``end_at``
            apply.
        start_at: Optional inclusive ISO 8601 range start.
        end_at: Optional inclusive ISO 8601 range end.
    """
    return _raise_for_api_error(
        await _results_with_token(
            resolve_api_token(),
            sort_field=sort_field,
            sort_order=sort_order,
            page_size=page_size,
            page=page,
            search=search,
            date_range_column=date_range_column,
            start_at=start_at,
            end_at=end_at,
        )
    )


async def _result_with_token(token: str, *, result_id: str) -> dict[str, Any]:
    if not result_id.strip():
        raise ToolError("result_id must not be empty")
    return await get_result_by_id_api(token=token, result_id=result_id.strip())


async def result(result_id: NonEmptyString) -> dict[str, Any]:
    """Return one stored scrape result by its result UUID.

    Args:
        result_id: UUID of the stored MrScraper result to retrieve.
    """
    return _raise_for_api_error(
        await _result_with_token(resolve_api_token(), result_id=result_id)
    )


def register_cli_tools(mcp: FastMCP) -> None:
    mcp.tool(
        output_schema=FETCH_OUTPUT_SCHEMA,
        annotations={
            "readOnlyHint": True,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )(fetch)
    mcp.tool(
        output_schema=SCRAPE_OUTPUT_SCHEMA,
        annotations={
            "readOnlyHint": False,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )(scrape)
    mcp.tool(
        output_schema=SERP_OUTPUT_SCHEMA,
        annotations={
            "readOnlyHint": True,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )(serp)
    mcp.tool(
        output_schema=STATUS_OUTPUT_SCHEMA,
        annotations={
            "readOnlyHint": True,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )(status)
    mcp.tool(
        output_schema=RERUN_OUTPUT_SCHEMA,
        annotations={
            "readOnlyHint": False,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )(rerun)
    mcp.tool(
        output_schema=RESULTS_OUTPUT_SCHEMA,
        annotations={
            "readOnlyHint": True,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )(results)
    mcp.tool(
        output_schema=RESULT_OUTPUT_SCHEMA,
        annotations={
            "readOnlyHint": True,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )(result)
