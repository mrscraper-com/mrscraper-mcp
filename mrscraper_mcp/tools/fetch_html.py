from urllib.parse import urlencode

from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult
import httpx

from mrscraper_mcp.constants import FETCH_HTML_API_BASE
from mrscraper_mcp.http_helpers import api_get
from mrscraper_mcp.job_runtime import (
    JOB_STORE,
    async_tool_meta,
    build_queued_tool_result,
)


async def _fetch_html_impl(
    token: str,
    url: str,
    timeout: int = 120,
    geo_code: str = "US",
    block_resources: bool = False,
) -> dict:
    params = {
        "token": token,
        "timeout": timeout,
        "geoCode": geo_code,
        "url": url,
        "blockResources": str(block_resources).lower(),
    }

    full_url = f"{FETCH_HTML_API_BASE}?{urlencode(params)}"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(full_url, timeout=float(timeout + 30))
            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            if "application/json" in content_type:
                data = response.json()
            else:
                data = response.text

            if response.status_code == 401:
                return {
                    "error": "Unauthorized or invalid token. Please go to https://app.mrscraper.com to get your token.",
                    "status_code": response.status_code,
                }

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


def register_fetch_html_tool(mcp: FastMCP) -> None:
    @mcp.tool
    async def fetch_html(
        token: str,
        url: str,
        timeout: int = 120,
        geo_code: str = "US",
        block_resources: bool = False,
    ) -> dict:
        """
        MrScraper Fetch HTML Tool. It features stealth, unblocking, and rendering capabilities. The main response is the HTML of the page.
        It features timeout, geolocation-based access, and resource management.

        Args:
            token: Your MrScraper API token (required for authentication)
            url: The target URL to scrape (e.g., 'https://www.example.com/page')
            timeout: Maximum time in seconds to wait for the page to load (default: 120)
            geo_code: ISO country code for geolocation-based scraping (default: 'US' for United States)
                      Examples: 'US', 'GB', 'ID', 'SG', etc.
            block_resources: Whether to block loading of images, CSS, fonts, and other resources
                             to speed up scraping (default: False)

        Returns:
            Starts a background job and immediately returns:
            - jobId: Local MCP job ID to monitor progress
            - status/progress: Current background state
            - nextAction: Recommended poll call for get_scrape_job_status

        Example:
            Fetch HTML content from a geolocation-restricted website:
            fetch_html(
                token="MRSCRAPER_API_TOKEN",
                url="https://stockx.com/air-jordan-1-retro-low-og-chicago-2025",
                geo_code="US",
                timeout=120,
                block_resources=False
            )

            Fast scraping with resource blocking enabled:
            fetch_html(
                token="MRSCRAPER_API_TOKEN",
                url="https://www.example.com/page",
                timeout=60,
                geo_code="GB",
                block_resources=True
            )

        Notes:
            - This MCP directly returns the raw HTML content. The HTML can be extremely large (both in character count and token size).
            - For LLMs calling this endpoint, it is NOT recommended to pass the entire result into your prompt/context, as it may overwhelm context length and degrade performance.
            - Instead, consider saving the HTML to a file without reading it into the LLM, or use external storage methods. Only process or summarize essential parts.
            - Consider preprocessing/extracting specific elements before feeding text to the LLM.
        """
        return await _fetch_html_impl(
            token=token,
            url=url,
            timeout=timeout,
            geo_code=geo_code,
            block_resources=block_resources,
        )


def register_fetch_html_ui_tool(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta(
            "Fetching HTML in background...", "HTML fetch job started."
        ),
        annotations={"openWorldHint": True},
    )
    async def fetch_html_with_ui(
        token: str,
        url: str,
        timeout: int = 120,
        geo_code: str = "US",
        block_resources: bool = False,
    ) -> ToolResult:
        """
        Fetch HTML in a ChatGPT-App-compatible way.

        Use this tool instead of `fetch_html` in ChatGPT Apps.
        This tool is preferred for ChatGPT because it starts a background job,
        supports polling, and avoids timeouts for long-running fetches.

        Do NOT use `fetch_html` in ChatGPT Apps when the request may take more than a few seconds.

        Returns:
        - jobId
        - status/progress
        - polling metadata
        """
        params = {
            "token": token,
            "timeout": timeout,
            "geoCode": geo_code,
            "url": url,
            "blockResources": str(block_resources).lower(),
        }
        full_url = f"{FETCH_HTML_API_BASE}?{urlencode(params)}"
        job = await JOB_STORE.enqueue(
            tool_name="fetch_html",
            input_preview={
                "url": url,
                "timeout": timeout,
                "geoCode": geo_code,
                "blockResources": block_resources,
            },
            work=api_get(full_url, timeout=float(timeout + 30)),
        )
        return build_queued_tool_result(job)
