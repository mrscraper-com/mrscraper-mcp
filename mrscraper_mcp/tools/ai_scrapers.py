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

    @mcp.tool
    async def bulk_rerun_ai_scraper(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> dict:
        return await _bulk_rerun_ai_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            urls=urls,
        )


def register_ai_scraper_ui_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta("Starting AI scraper job...", "AI scraper job started."),
        annotations={"openWorldHint": True},
    )
    async def create_ai_scraper_with_ui(
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
        job = await JOB_STORE.enqueue(
            tool_name="create_ai_scraper_with_ui",
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
        annotations={"openWorldHint": True},
    )
    async def rerun_ai_scraper_with_ui(
        token: str,
        scraper_id: str,
        url: str,
        max_depth: int = 2,
        max_pages: int = 50,
        limit: int = 1000,
        include_patterns: str = "",
        exclude_patterns: str = "",
    ) -> ToolResult:
        job = await JOB_STORE.enqueue(
            tool_name="rerun_ai_scraper_with_ui",
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
        meta=async_tool_meta("Starting bulk AI rerun...", "Bulk AI rerun started."),
        annotations={"openWorldHint": True},
    )
    async def bulk_rerun_ai_scraper_with_ui(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> ToolResult:
        job = await JOB_STORE.enqueue(
            tool_name="bulk_rerun_ai_scraper_with_ui",
            input_preview={
                "scraperId": scraper_id,
                "urlCount": len(urls),
                "urlsSample": urls[:3],
            },
            work=_bulk_rerun_ai_scraper_impl(
                token=token,
                scraper_id=scraper_id,
                urls=urls,
            ),
        )
        return build_queued_tool_result(job)