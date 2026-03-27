from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult
import httpx

from mrscraper_mcp.constants import SCRAPERS_MANUAL_RERUN, SCRAPERS_MANUAL_RERUN_BULK
from mrscraper_mcp.job_runtime import (
    JOB_STORE,
    async_tool_meta,
    build_queued_tool_result,
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
    @mcp.tool
    async def rerun_manual_scraper(
        token: str,
        scraper_id: str,
        url: str,
    ) -> dict:
        """
        Reruns a manually configured scraper (created with custom selectors/rules) on a new URL.
        Manual scrapers are created through the MrScraper web interface with specific CSS selectors,
        XPath expressions, or extraction rules. This tool applies those manual configurations to
        a different URL. Use this for scrapers that were created manually, not via create_scraper.

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


def register_manual_scraper_ui_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta("Starting manual rerun...", "Manual rerun started."),
        annotations={"openWorldHint": True},
    )
    async def rerun_manual_scraper_with_ui(
        token: str,
        scraper_id: str,
        url: str,
    ) -> ToolResult:
        """
        UI Tool version of rerun_manual_scraper. Reruns a manually configured scraper on a new URL. The tool is designed for use in a user interface context, providing feedback on the initiation of the scraping job. It enqueues the scraping task and returns a result indicating that the job has been started, along with a preview of the input parameters.
        """
        job = await JOB_STORE.enqueue(
            tool_name="rerun_manual_scraper_with_ui",
            input_preview={"scraperId": scraper_id, "url": url},
            work=_rerun_manual_scraper_impl(
                token=token,
                scraper_id=scraper_id,
                url=url,
            ),
        )
        return build_queued_tool_result(job)

    @mcp.tool(
        meta=async_tool_meta(
            "Starting bulk manual rerun...", "Bulk manual rerun started."
        ),
        annotations={"openWorldHint": True},
    )
    async def bulk_rerun_manual(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> dict:
        """
        Reruns a manually configured scraper on multiple URLs simultaneously in a single batch operation.
        This is more efficient than calling rerun_manual_scraper multiple times, as it processes all URLs
        in parallel and returns consolidated results. Ideal for scraping multiple pages, products, or
        articles with the same extraction logic.
        """
        return await _bulk_rerun_manual_scraper_impl(
            token=token,
            scraper_id=scraper_id,
            urls=urls,
        )
