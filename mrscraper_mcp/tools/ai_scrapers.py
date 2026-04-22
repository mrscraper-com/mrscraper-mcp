from typing import Literal

from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult
import httpx

from mrscraper_mcp.constants import (
    SCRAPERS_AI,
    SCRAPERS_AI_RERUN,
    SCRAPERS_AI_RERUN_BULK,
)
from mrscraper_mcp.job_runtime import (
    JOB_STORE,
    async_tool_meta,
    build_queued_tool_result,
    plain_tool_meta,
)


async def _create_ai_scraper_impl(
    token: str,
    url: str,
    message: str,
    agent: Literal["general", "listing", "map"] = "general",
    proxy_country: str = None,
    max_depth: int = 2,
    max_pages: int = 50,
    limit: int = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
) -> dict:
    headers = {
        "Content-Type": "application/json",
        "accept": "application/json",
        "x-api-token": token,
    }

    if agent in ("general", "listing"):
        payload = {
            "url": url,
            "message": message,
            "agent": agent,
            "proxyCountry": proxy_country,
        }
    else:  # agent == "map"
        payload = {
            "url": url,
            "agent": agent,
            "maxDepth": max_depth,
            "maxPages": max_pages,
            "limit": limit,
            "includePatterns": include_patterns,
            "excludePatterns": exclude_patterns,
        }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                SCRAPERS_AI, headers=headers, json=payload, timeout=600
            )

            if response.status_code == 401:
                return {
                    "error": "Unauthorized or invalid token. Please go to https://app.mrscraper.com to get your token.",
                    "status_code": response.status_code,
                }

            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            if "application/json" in content_type:
                data = response.json()
            else:
                data = response.text

            return {
                "status_code": response.status_code,
                "data": data,
                "headers": dict(response.headers),
            }

        except httpx.HTTPError as e:
            return {
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None)
                if hasattr(e, "response")
                else None,
            }
        except Exception as e:
            return {
                "error": f"Unexpected error: {str(e)}",
                "status_code": None,
            }


async def _rerun_ai_scraper_impl(
    token: str,
    scraper_id: str,
    url: str,
    max_depth: int = 2,
    max_pages: int = 50,
    limit: int = 1000,
    include_patterns: str = "",
    exclude_patterns: str = "",
) -> dict:
    headers = {
        "Content-Type": "application/json",
        "accept": "application/json",
        "x-api-token": token,
    }
    payload = {
        "scraperId": scraper_id,
        "url": url,
        "maxDepth": max_depth,
        "maxPages": max_pages,
        "limit": limit,
        "includePatterns": include_patterns,
        "excludePatterns": exclude_patterns,
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                SCRAPERS_AI_RERUN, headers=headers, json=payload, timeout=600
            )

            if response.status_code == 401:
                return {
                    "error": "Unauthorized or invalid token. Please go to https://app.mrscraper.com to get your token.",
                    "status_code": response.status_code,
                }

            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            if "application/json" in content_type:
                data = response.json()
            else:
                data = response.text

            return {
                "status_code": response.status_code,
                "data": data,
                "headers": dict(response.headers),
            }

        except httpx.HTTPError as e:
            return {
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None)
                if hasattr(e, "response")
                else None,
            }
        except Exception as e:
            return {
                "error": f"Unexpected error: {str(e)}",
                "status_code": None,
            }


async def _bulk_rerun_ai_scraper_impl(
    token: str,
    scraper_id: str,
    urls: list[str],
) -> dict:
    headers = {
        "Content-Type": "application/json",
        "accept": "application/json",
        "x-api-token": token,
    }
    payload = {
        "scraperId": scraper_id,
        "urls": urls,
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                SCRAPERS_AI_RERUN_BULK, headers=headers, json=payload, timeout=600
            )

            if response.status_code == 401:
                return {
                    "error": "Unauthorized or invalid token. Please go to https://app.mrscraper.com to get your token.",
                    "status_code": response.status_code,
                }

            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            if "application/json" in content_type:
                data = response.json()
            else:
                data = response.text

            return {
                "status_code": response.status_code,
                "data": data,
                "headers": dict(response.headers),
            }

        except httpx.HTTPError as e:
            return {
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None)
                if hasattr(e, "response")
                else None,
            }
        except Exception as e:
            return {
                "error": f"Unexpected error: {str(e)}",
                "status_code": None,
            }


def register_ai_scraper_tools(mcp: FastMCP) -> None:
    @mcp.tool
    async def create_ai_scraper(
        token: str,
        url: str,
        message: str,
        agent: Literal["general", "listing", "map"] = "general",
        proxy_country: str = None,
        max_depth: int = 2,
        max_pages: int = 50,
        limit: int = 1000,
        include_patterns: str = "",
        exclude_patterns: str = "",
    ) -> dict:
        """
        Creates an AI-powered scraper that intelligently extracts structured data from a
        website from natural language instructions. The scraper uses AI agents to infer
        page structure and extract the requested fields. Prefer this over manual
        selector scrapers when the user does not already have a dashboard-defined manual scraper.

        Args:
            token: Your MrScraper API token (required for authentication)
            url: The target URL to scrape (e.g., 'https://www.example.com/products')
            message: What to extract, in plain language (e.g., product names and prices,
                article titles and dates, job listings with company and location).
            agent: AI agent profile (default: 'general').
                - 'general': Default for most pages; strong on product-style pages and
                  general content when the page type is unclear.
                - 'listing': Use when the URL is clearly a listing index (products, jobs, etc.).
                - 'map': Crawl a site starting from `url`; uses max_depth, max_pages, limit,
                  and include/exclude URL patterns instead of a natural-language `message`
                  for the crawl configuration.
            proxy_country: Optional ISO country code for proxy egress (e.g. 'US', 'GB').
            max_depth: ('map' only) Link depth from the start URL (default: 2). Keep <= 3
                for cost control; depth 0 is start URL only.
            max_pages: ('map' only) Cap on pages visited (default: 50).
            limit: ('map' only) Max records extracted across pages (default: 1000).
            include_patterns: ('map' only) Regex patterns for URLs to follow; separate
                multiple patterns with '||' (e.g. '*/products/*||*/blog/*'). Empty means no include filter.
            exclude_patterns: ('map' only) Regex patterns to skip; same '||' separator
                (e.g. '*/cart/*||*/checkout/*||*.pdf').

        Returns:
            A dictionary with:
            - status_code: HTTP status from the API
            - data: Scraper creation payload (includes scraper id needed for reruns)
            - headers: Response headers
            - error: Present if the call failed

        Notes:
            - Default go-to for “scrape this site” when the user has not asked for a
              specific manual/dashboard scraper.
        """
        return await _create_ai_scraper_impl(
            token=token,
            url=url,
            message=message,
            agent=agent,
            proxy_country=proxy_country,
            max_depth=max_depth,
            max_pages=max_pages,
            limit=limit,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
        )

    @mcp.tool
    async def rerun_ai_scraper(
        token: str,
        scraper_id: str,
        url: str,
        max_depth: int = 2,
        max_pages: int = 50,
        limit: int = 1000,
        include_patterns: str = "",
        exclude_patterns: str = "",
    ) -> dict:
        """
        Reruns an existing AI scraper (created with `create_ai_scraper`) on a new URL.
        Crawl-related arguments apply when the scraper was created with agent 'map'.

        Args:
            token: Your MrScraper API token
            scraper_id: Scraper id from `create_ai_scraper` (agent type is fixed to how
                the scraper was created).
            url: URL to run against (can differ from the original).
            max_depth, max_pages, limit, include_patterns, exclude_patterns: Only meaningful
                for 'map' scrapers; same semantics as in `create_ai_scraper`.

        Returns:
            Dictionary with status_code, data (job / result metadata), headers, and optional error.
            Use `get_all_results` / `get_result_by_id` to read extracted rows when applicable.

        Notes:
            - For many URLs with the same scraper, prefer `bulk_rerun_ai_scraper`.
        """
        return await _rerun_ai_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            url=url,
            max_depth=max_depth,
            max_pages=max_pages,
            limit=limit,
            include_patterns=include_patterns,
            exclude_patterns=exclude_patterns,
        )

    @mcp.tool(
        annotations={
            "readOnlyHint": False,
            "openWorldHint": False,
            "destructiveHint": False,
        }
    )
    async def bulk_rerun_ai_scraper(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> dict:
        """
        Reruns an existing AI scraper on many URLs in one request (more efficient than
        repeated `rerun_ai_scraper` calls). The same scraper configuration is applied to
        each URL.

        Args:
            token: Your MrScraper API token
            scraper_id: Scraper id from `create_ai_scraper`
            urls: Non-empty list of URLs, each compatible with that scraper's instructions

        Returns:
            Dictionary with status_code, data (bulk job metadata), headers, optional error.
            Per-URL outcomes may appear inside `data`; use results APIs for detail.

        Notes:
            - Same as `rerun_ai_scraper`, but batched.
        """
        return await _bulk_rerun_ai_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            urls=urls,
        )


def register_ai_scraper_job_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta("Starting AI scraper job...", "AI scraper job started."),
        annotations={
            "openWorldHint": True,
            "readOnlyHint": False,
            "destructiveHint": False,
        },
    )
    async def create_ai_scraper_job(
        token: str,
        url: str,
        message: str,
        agent: Literal["general", "listing", "map"] = "general",
        proxy_country: str = None,
        max_depth: int = 2,
        max_pages: int = 50,
        limit: int = 1000,
        include_patterns: str = "",
        exclude_patterns: str = "",
    ) -> ToolResult:
        """
        Creates an AI-powered scraper (background job). Same API as `create_ai_scraper`:
        natural-language extraction, agent choice, and optional map-crawl settings. The
        scraper uses AI to infer structure and extract the requested fields. Prefer this
        over manual dashboard scrapers when the user has not pinned a specific manual scraper.

        Use `create_ai_scraper_job` in ChatGPT Apps so the host does not block while the
        MrScraper API works. You receive a `jobId` immediately; call `get_scrape_job` to obtain
        the same dictionary `create_ai_scraper` would
        return (status_code, data, headers, error).

        Args:
            token: Your MrScraper API token (required for authentication)
            url: The target URL to scrape (e.g., 'https://www.example.com/products')
            message: What to extract, in plain language (e.g., product names and prices,
                article titles and dates, job listings with company and location).
            agent: AI agent profile (default: 'general').
                - 'general': Default for most pages; strong on product-style pages and
                  general content when the page type is unclear.
                - 'listing': Use when the URL is clearly a listing index (products, jobs, etc.).
                - 'map': Crawl a site starting from `url`; uses max_depth, max_pages, limit,
                  and include/exclude URL patterns instead of a natural-language `message`
                  for the crawl configuration.
            proxy_country: Optional ISO country code for proxy egress (e.g. 'US', 'GB').
            max_depth: ('map' only) Link depth from the start URL (default: 2). Keep <= 3
                for cost control; depth 0 is start URL only.
            max_pages: ('map' only) Cap on pages visited (default: 50).
            limit: ('map' only) Max records extracted across pages (default: 1000).
            include_patterns: ('map' only) Regex patterns for URLs to follow; separate
                multiple patterns with '||' (e.g. '*/products/*||*/blog/*'). Empty means no include filter.
            exclude_patterns: ('map' only) Regex patterns to skip; same '||' separator
                (e.g. '*/cart/*||*/checkout/*||*.pdf').

        Returns:
            Immediately, a ToolResult whose structured_content includes jobId, toolName,
            status, progress, message, isDone (false until queued/running work finishes).
            Meta may reference the job status widget and suggest polling `get_scrape_job`.

            After success, `get_scrape_job` yields the same fields as `create_ai_scraper`:
            - status_code: HTTP status from the API
            - data: Scraper creation payload (includes scraper id for `rerun_ai_scraper` / `_job`)
            - headers: Response headers
            - error: Present if the call failed

        Example:
            General extraction as a job:
            create_ai_scraper_job(
                token="MRSCRAPER_API_TOKEN",
                url="https://www.example.com/products",
                message="Extract all product names, prices, and ratings from the listings",
                agent="general",
                proxy_country="US"
            )

            Map crawl as a job:
            create_ai_scraper_job(
                token="MRSCRAPER_API_TOKEN",
                url="https://www.example.com",
                message="",
                agent="map",
                max_depth=2,
                max_pages=50,
                limit=1000,
                include_patterns="*/products/*||*/blog/*",
                exclude_patterns="*/cart/*||*/checkout/*||*.pdf"
            )

        Notes:
            - Default go-to for “scrape this site” when the user has not asked for a dashboard manual scraper.
            - Poll job APIs when the user follows up; avoid tight loops while the job runs.
            - Jobs are in-memory only until the MCP server restarts.
        """
        job = await JOB_STORE.enqueue(
            tool_name="create_ai_scraper_job",
            input_preview={
                "url": url,
                "agent": agent,
                "proxyCountry": proxy_country,
                "maxDepth": max_depth,
                "maxPages": max_pages,
                "limit": limit,
                "includePatterns": include_patterns,
                "excludePatterns": exclude_patterns,
            },
            work=_create_ai_scraper_impl(
                token=token,
                url=url,
                message=message,
                agent=agent,
                proxy_country=proxy_country,
                max_depth=max_depth,
                max_pages=max_pages,
                limit=limit,
                include_patterns=include_patterns,
                exclude_patterns=exclude_patterns,
            ),
        )
        return build_queued_tool_result(job)

    @mcp.tool(
        meta=async_tool_meta("Starting AI rerun job...", "AI rerun job started."),
        annotations={
            "readOnlyHint": False,
            "destructiveHint": False,
            "openWorldHint": True,
        },
    )
    async def rerun_ai_scraper_job(
        token: str,
        scraper_id: str,
        url: str,
        max_depth: int = 2,
        max_pages: int = 50,
        limit: int = 1000,
        include_patterns: str = "",
        exclude_patterns: str = "",
    ) -> ToolResult:
        """
        Reruns an existing AI scraper on a new URL (background job). Same API as
        `rerun_ai_scraper`: the scraper must have been created with `create_ai_scraper` or
        `create_ai_scraper_job`. Crawl-related arguments matter only when that scraper was
        created with agent 'map'.

        Use `rerun_ai_scraper_job` in ChatGPT Apps to avoid tool timeouts. You get a `jobId`
        immediately; when the job completes, `get_scrape_job` returns the same dict
        as synchronous `rerun_ai_scraper` (status_code, data, headers, error).

        Args:
            token: Your MrScraper API token (required for authentication)
            scraper_id: The scraper id returned when the scraper was created (from
                `create_ai_scraper` / `create_ai_scraper_job` response `data`). The agent type
                is fixed to how the scraper was originally created.
            url: The URL to run against (can differ from the original creation URL).
            max_depth: Only for scrapers created with agent 'map'. Maximum crawl depth from
                the start URL (default: 2). Depth 0 = start URL only; higher levels follow
                links outward. Prefer <= 3 for cost control.
            max_pages: ('map' only) Maximum pages to visit (default: 50).
            limit: ('map' only) Maximum records extracted across pages (default: 1000).
            include_patterns: ('map' only) Regex patterns for URLs to follow; use '||'
                between patterns (e.g. '*/products/*||https://example.com/category/*').
                Empty includes all links subject to exclude_patterns.
            exclude_patterns: ('map' only) Regex patterns to skip; same '||' separator
                (e.g. '*/cart/*||*/checkout/*||*/admin/*||*.pdf').

        Returns:
            Immediately, a ToolResult with structured_content: jobId, toolName, status,
            progress, message, isDone (false until finished).

            On completion, `get_scrape_job` exposes the same payload as `rerun_ai_scraper`:
            - status_code, data (run/job metadata from the API), headers, optional error.
            Use `get_all_results` / `get_result_by_id` for extracted rows when applicable.

        Example:
            Rerun a map-style scraper on another branch of the site:
            rerun_ai_scraper_job(
                token="MRSCRAPER_API_TOKEN",
                scraper_id="scraper_12345",
                url="https://www.example.com/category/electronics",
                max_depth=3,
                max_pages=100,
                limit=500,
                include_patterns="*/products/*",
                exclude_patterns="*/cart/*||*/checkout/*"
            )

        Notes:
            - For many URLs with the same scraper in one request, prefer `bulk_rerun_ai_scraper`
              (returns directly on the ChatGPT MCP stack).
            - Not for manual/dashboard scrapers; use `rerun_manual_scraper` / `rerun_manual_scraper_job`.
            - Poll job tools when the user follows up; avoid aggressive tight polling.
        """
        job = await JOB_STORE.enqueue(
            tool_name="rerun_ai_scraper_job",
            input_preview={
                "scraperId": scraper_id,
                "url": url,
                "maxDepth": max_depth,
                "maxPages": max_pages,
                "limit": limit,
                "includePatterns": include_patterns,
                "excludePatterns": exclude_patterns,
            },
            work=_rerun_ai_scraper_impl(
                token=token,
                scraper_id=scraper_id,
                url=url,
                max_depth=max_depth,
                max_pages=max_pages,
                limit=limit,
                include_patterns=include_patterns,
                exclude_patterns=exclude_patterns,
            ),
        )
        return build_queued_tool_result(job)

    @mcp.tool(
        meta=plain_tool_meta("Running AI bulk rerun...", "AI bulk rerun finished."),
        annotations={"openWorldHint": True},
    )
    async def bulk_rerun_ai_scraper(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> dict:
        """
        Same as the standard `bulk_rerun_ai_scraper` tool: one API call reruns an AI
        scraper on many URLs. Registered on the ChatGPT MCP stack for parity with the
        main server; returns the HTTP response dict directly (not a background job).

        Args:
            token: MrScraper API token
            scraper_id: Id from `create_ai_scraper`
            urls: Non-empty list of target URLs

        Returns:
            status_code, data (bulk job metadata), headers, optional error.
        """
        return await _bulk_rerun_ai_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            urls=urls,
        )
