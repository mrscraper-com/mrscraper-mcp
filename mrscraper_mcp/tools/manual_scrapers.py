from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult
import httpx

from mrscraper_mcp.constants import SCRAPERS_MANUAL_RERUN, SCRAPERS_MANUAL_RERUN_BULK
from mrscraper_mcp.job_runtime import (
    JOB_STORE,
    async_tool_meta,
    build_queued_tool_result,
    plain_tool_meta,
)


async def _rerun_manual_scraper_impl(
    token: str,
    scraper_id: str,
    url: str,
) -> dict:
    endpoint_url = SCRAPERS_MANUAL_RERUN

    headers = {
        "Content-Type": "application/json",
        "accept": "application/json",
        "x-api-token": token,
    }

    payload = {
        "scraperId": scraper_id,
        "url": url,
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                endpoint_url, headers=headers, json=payload, timeout=600
            )
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


async def _bulk_rerun_manual_scraper_impl(
    token: str,
    scraper_id: str,
    urls: list[str],
) -> dict:
    endpoint_url = SCRAPERS_MANUAL_RERUN_BULK

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
                endpoint_url, headers=headers, json=payload, timeout=600
            )
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


def register_manual_scraper_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        annotations={
            "readOnlyHint": False,
            "openWorldHint": False,
            "destructiveHint": False,
        }
    )
    async def rerun_manual_scraper(
        token: str,
        scraper_id: str,
        url: str,
    ) -> dict:
        """
        Reruns a manually configured scraper (created with custom selectors/rules) on a new URL.
        Manual scrapers are created through the MrScraper web interface with specific CSS selectors,
        XPath expressions, or extraction rules. This tool applies those manual configurations to
        a different URL. Use this for scrapers that were created manually, not via
        `create_ai_scraper`.

        Args:
            token: Your MrScraper API token (required for authentication)
            scraper_id: The ID of the manual scraper to rerun (obtained from the MrScraper dashboard).
                        This must be a scraper created manually through the web interface, not an AI scraper.
                        The scraper ID can be found in your scraper list at https://app.mrscraper.com
            url: The target URL to scrape with the manual scraper configuration.
                The page structure should be similar to the original scraper's target page
                for the manual selectors/rules to work correctly.

        Returns:
            A dictionary containing:
            - status_code: HTTP status code of the response
            - data: The scraping job information including job ID, status, and result metadata.
                    The results can be retrieved using get_all_results or get_result_by_id.
            - headers: Response headers from the API
            - error: Error message if the request failed (if applicable)

        Example:
            Rerun a manually configured scraper on a new product page:
            rerun_manual_scraper(
                token="MRSCRAPER_API_TOKEN",
                scraper_id="manual_scraper_67890",
                url="https://www.example.com/products/new-item"
            )

        Notes:
            - This tool is specifically to rerun manually configured scrapers. It is not applicable for AI scrapers. Call this tool when the user specifies a manual scraper.
        """
        return await _rerun_manual_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            url=url,
        )

    @mcp.tool
    async def bulk_rerun_manual_scraper(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> dict:
        """
        Reruns a manually configured scraper on multiple URLs simultaneously in a single batch operation.
        This is more efficient than calling rerun_manual_scraper multiple times, as it processes all URLs
        in parallel and returns consolidated results. Ideal for scraping multiple pages, products, or
        articles with the same extraction logic.

        Args:
            token: Your MrScraper API token (required for authentication)
            scraper_id: The ID of the manual scraper to rerun (obtained from the MrScraper dashboard).
                        This must be a scraper created manually through the web interface, not an AI scraper.
                        The scraper ID can be found in your scraper list at https://app.mrscraper.com
            urls: A list of target URLs to scrape (required, must contain at least one URL).
                Each URL will be processed independently using the scraper's extraction logic.
                Examples: ["https://example.com/page1", "https://example.com/page2", "https://example.com/page3"]
                All URLs should be compatible with the scraper's original extraction instructions.

        Returns:
            A dictionary containing:
            - status_code: HTTP status code of the response
            - data: Bulk scraping job information including job ID, status, and metadata for all URLs.
                    Results for individual URLs can be retrieved using get_all_results or get_result_by_id.
                    The response may include per-URL status information.
            - headers: Response headers from the API
            - error: Error message if the request failed (if applicable)

        Example:
            Bulk scrape multiple product pages with the same manual scraper:
            bulk_rerun_manual_scraper(
                token="MRSCRAPER_API_TOKEN",
                scraper_id="scraper_12345",
                urls=[
                    "https://www.example.com/products/item1",
                    "https://www.example.com/products/item2",
                    "https://www.example.com/products/item3"
                ]
            )
        """
        return await _bulk_rerun_manual_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            urls=urls,
        )


def register_manual_scraper_job_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta("Starting manual rerun...", "Manual rerun started."),
        annotations={
            "readOnlyHint": False,
            "openWorldHint": True,
            "destructiveHint": False,
        },
    )
    async def rerun_manual_scraper_job(
        token: str,
        scraper_id: str,
        url: str,
    ) -> ToolResult:
        """
        Reruns a manually configured scraper on a new URL (background job). Same behavior
        as `rerun_manual_scraper`: manual scrapers are defined in the MrScraper web app with
        CSS selectors, XPath, or other extraction rules. This tool applies that saved
        configuration to a different URL. Use when the user has a dashboard manual scraper,
        not an AI scraper created via `create_ai_scraper` / `create_ai_scraper_job`.

        Use `rerun_manual_scraper_job` in ChatGPT Apps so the host does not block on the API.
        You receive a `jobId` immediately; call `get_scrape_job` when the job finishes to read
        the same response dict as synchronous `rerun_manual_scraper` (under `result`).

        Args:
            token: Your MrScraper API token (required for authentication)
            scraper_id: The ID of the manual scraper to rerun (from the MrScraper dashboard).
                        Must be a scraper created manually through the web interface, not an AI scraper.
                        The scraper ID can be found in your scraper list at https://app.mrscraper.com
            url: The target URL to scrape with the manual scraper configuration.
                 The page structure should be similar to the original scraper's target page
                 for the manual selectors/rules to work correctly.

        Returns:
            Immediately, a ToolResult whose structured_content includes jobId, toolName,
            status, progress, message, isDone (false until the rerun finishes).

            When complete, `get_scrape_job(job_id=...)` includes the same payload as `rerun_manual_scraper`:
            - status_code: HTTP status code of the response
            - data: Scraping job information (job id, status, result metadata)
            - headers: Response headers from the API
            - error: Error message if the request failed (if applicable)
            Follow up with `get_all_results` / `get_result_by_id` for detailed extracted data.

        Example:
            rerun_manual_scraper_job(
                token="MRSCRAPER_API_TOKEN",
                scraper_id="manual_scraper_67890",
                url="https://www.example.com/products/new-item"
            )

        Notes:
            - This tool is only for manually configured scrapers. For AI scrapers, use
              `rerun_ai_scraper` or `rerun_ai_scraper_job`.
            - Prefer checking job status when the user continues the conversation, not on a tight timer.
            - Jobs are in-memory only; they disappear if the MCP server restarts.
        """
        job = await JOB_STORE.enqueue(
            tool_name="rerun_manual_scraper_job",
            input_preview={"scraperId": scraper_id, "url": url},
            work=_rerun_manual_scraper_impl(
                token=token,
                scraper_id=scraper_id,
                url=url,
            ),
        )
        return build_queued_tool_result(job)

    @mcp.tool(
        meta=plain_tool_meta(
            "Running bulk manual rerun...", "Bulk manual rerun finished."
        ),
        annotations={"openWorldHint": True},
    )
    async def bulk_rerun_manual(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> dict:
        """
        Same as `bulk_rerun_manual_scraper` on the main MCP server: batch reruns a
        manual (dashboard) scraper on many URLs in one API call. Returns the response
        dict directly (not a background job).

        Args:
            token: MrScraper API token
            scraper_id: Manual scraper id from the dashboard
            urls: Non-empty list of URLs compatible with that scraper

        Returns:
            status_code, data (bulk job metadata), headers, optional error.
        """
        return await _bulk_rerun_manual_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            urls=urls,
        )
