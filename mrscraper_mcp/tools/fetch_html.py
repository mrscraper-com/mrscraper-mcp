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
            A dictionary containing:
            - status_code: HTTP status code of the response
            - data: The scraped HTML content or JSON response
            - headers: Response headers from the API
            - error: Error message if the request failed (if applicable)

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


def register_fetch_html_job_tool(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta(
            "Fetching HTML in background...", "HTML fetch job started."
        ),
        annotations={"openWorldHint": True},
    )
    async def fetch_html_job(
        token: str,
        url: str,
        timeout: int = 120,
        geo_code: str = "US",
        block_resources: bool = False,
    ) -> ToolResult:
        """
        MrScraper Fetch HTML (background job). Same behavior as `fetch_html`: stealth,
        unblocking, rendering, configurable timeout, geolocation-based access, and optional
        resource blocking. The scraped payload is still HTML (or JSON if the API returns it).

        Use `fetch_html_job` in ChatGPT Apps (or any client that times out on long tool
        calls). The tool returns immediately with a `jobId`; the actual fetch runs in the
        background. Use `get_scrape_job_status` / `get_scrape_job_result` to read completion
        and the same response shape as synchronous `fetch_html`.

        Args:
            token: Your MrScraper API token (required for authentication)
            url: The target URL to scrape (e.g., 'https://www.example.com/page')
            timeout: Maximum time in seconds to wait for the page to load (default: 120)
            geo_code: ISO country code for geolocation-based scraping (default: 'US' for United States)
                      Examples: 'US', 'GB', 'ID', 'SG', etc.
            block_resources: Whether to block loading of images, CSS, fonts, and other resources
                             to speed up scraping (default: False)

        Returns:
            Immediately, a ToolResult whose structured_content includes:
            - jobId: Local MCP job id (pass to `get_scrape_job_status` / `get_scrape_job_result`)
            - toolName: Identifies this tool for widgets/UI
            - status, progress, message, isDone: Queue/run state (isDone false until terminal)

            When the job finishes, `get_scrape_job_result(job_id=...)` returns structured content
            equivalent to calling `fetch_html` directly:
            - status_code: HTTP status code of the scrape response
            - data: Scraped HTML string or JSON payload
            - headers: Response headers from the API
            - error: Error message if the request failed (if applicable)

        Example:
            Start a geo-targeted fetch as a job (then poll with job tools when the user follows up):
            fetch_html_job(
                token="MRSCRAPER_API_TOKEN",
                url="https://stockx.com/air-jordan-1-retro-low-og-chicago-2025",
                geo_code="US",
                timeout=120,
                block_resources=False
            )

            Faster job with resource blocking:
            fetch_html_job(
                token="MRSCRAPER_API_TOKEN",
                url="https://www.example.com/page",
                timeout=60,
                geo_code="GB",
                block_resources=True
            )

        Notes:
            - Final `data` can be extremely large. Do not paste full HTML into the model context;
              save externally, or extract/summarize only what you need.
            - Prefer checking status when the user returns to the conversation, not in a tight poll loop.
            - Jobs are stored in server memory and are lost if the MCP process restarts.
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
            tool_name="fetch_html_job",
            input_preview={
                "url": url,
                "timeout": timeout,
                "geoCode": geo_code,
                "blockResources": block_resources,
            },
            work=api_get(full_url, timeout=float(timeout + 30)),
        )
        return build_queued_tool_result(job)
