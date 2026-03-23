from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult

from mrscraper_mcp.constants import SCRAPERS_MANUAL_RERUN, SCRAPERS_MANUAL_RERUN_BULK
from mrscraper_mcp.http_helpers import api_post
from mrscraper_mcp.job_runtime import (
    JOB_STORE,
    async_tool_meta,
    build_queued_tool_result,
)


def register_manual_scraper_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta("Starting manual rerun...", "Manual rerun started."),
        annotations={"openWorldHint": True},
    )
    async def rerun_manual_scraper(
        token: str,
        scraper_id: str,
        url: str,
    ) -> ToolResult:
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
            Starts a background job and immediately returns:
            - jobId: Local MCP job ID to monitor progress
            - status/progress: Current background state
            - nextAction: Recommended poll call for get_scrape_job_status

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
        headers = {
            "Content-Type": "application/json",
            "accept": "application/json",
            "x-api-token": token,
        }
        payload = {
            "scraperId": scraper_id,
            "url": url,
        }
        job = await JOB_STORE.enqueue(
            tool_name="rerun_manual_scraper",
            input_preview={"scraperId": scraper_id, "url": url},
            work=api_post(SCRAPERS_MANUAL_RERUN, headers=headers, json_body=payload),
        )
        return build_queued_tool_result(job)

    @mcp.tool(
        meta=async_tool_meta(
            "Starting bulk manual rerun...", "Bulk manual rerun started."
        ),
        annotations={"openWorldHint": True},
    )
    async def bulk_rerun_manual_scraper(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> ToolResult:
        """
        Reruns a manually configured scraper on multiple URLs simultaneously in a single batch operation.
        This is more efficient than calling rerun_manual_scraper multiple times, as it processes all URLs
        in parallel and returns consolidated results. Ideal for scraping multiple pages, products, or
        articles with the same extraction logic.

        Args:
            token: Your MrScraper API token (required for authentication)
            scraper_id: The ID of the scraper to rerun (obtained from the MrScraper dashboard).
                        This must be a scraper created manually through the web interface, not an AI scraper.
                        The scraper ID can be found in your scraper list at https://app.mrscraper.com
            urls: A list of target URLs to scrape (required, must contain at least one URL).
                  Each URL will be processed independently using the scraper's extraction logic.
                  Examples: ["https://example.com/page1", "https://example.com/page2", "https://example.com/page3"]
                  All URLs should be compatible with the scraper's original extraction instructions.

        Returns:
            Starts a background job and immediately returns:
            - jobId: Local MCP job ID to monitor progress
            - status/progress: Current background state
            - nextAction: Recommended poll call for get_scrape_job_status

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
        headers = {
            "Content-Type": "application/json",
            "accept": "application/json",
            "x-api-token": token,
        }
        payload = {
            "scraperId": scraper_id,
            "urls": urls,
        }
        job = await JOB_STORE.enqueue(
            tool_name="bulk_rerun_manual_scraper",
            input_preview={
                "scraperId": scraper_id,
                "urlCount": len(urls),
                "urlsSample": urls[:3],
            },
            work=api_post(
                SCRAPERS_MANUAL_RERUN_BULK, headers=headers, json_body=payload
            ),
        )
        return build_queued_tool_result(job)
