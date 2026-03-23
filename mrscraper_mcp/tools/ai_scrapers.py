from typing import Literal

from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult

from mrscraper_mcp.constants import (
    SCRAPERS_AI,
    SCRAPERS_AI_RERUN,
    SCRAPERS_AI_RERUN_BULK,
)
from mrscraper_mcp.http_helpers import api_post
from mrscraper_mcp.job_runtime import (
    JOB_STORE,
    async_tool_meta,
    build_queued_tool_result,
)


def register_ai_scraper_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta("Starting AI scraper job...", "AI scraper job started."),
        annotations={"openWorldHint": True},
    )
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
    ) -> ToolResult:
        """
        Creates an AI-powered scraper that intelligently extracts structured data from a website based on natural language instructions.
        The scraper uses AI agents to understand the page structure and extract the requested information automatically.
        This is ideal for extracting data from complex websites without writing custom selectors.

        Args:
            token: Your MrScraper API token (required for authentication)
            url: The target URL to scrape (e.g., 'https://www.example.com/products')
            message: Natural language instructions describing what data to extract from the page.
                     Examples: "Extract all product names and prices", "Get article titles and publication dates",
                     "Scrape all job listings with company names and locations"
            agent: The AI agent type to use for scraping (default: 'general').
                   Available agents may include specialized types for different use cases.
                   Use 'general' for most standard web scraping tasks. The go to agent if the user doesn't specify or the connected LLM is not confident about the type of page. But mostly used for scraping product page, but handles any type of page very well as well.
                   Use 'listing' for scraping listing pages like product listings, job listings, etc. Choose this if the connected LLM can confidently identify whether the given URL is a listing page.
                   Use 'map' for crawling and getting all subdomain or subpages of a website. Choose this if the user specifies that the given URL is a website and not a specific page. For 'map' agent type, there is a special args that can be used to configure the scraping process.
            proxy_country: ISO country code for proxy-based scraping (optional).
                           If provided, the scraper will use a proxy from the specified country.
                           Examples: 'US', 'GB', 'ID', 'SG', etc.
                           Leave as None to use default proxy settings.

        Special Args (for 'map' agent type):
            token: Your MrScraper API token (required for authentication)
            url: The target URL to scrape (e.g., 'https://www.example.com/products')
            agent: The AI agent type to use for scraping (for this case it is 'map).
            max_depth: Maximum depth level for crawling links from the starting URL (default: 2).
                       Depth 0 = only the starting URL, depth 1 = starting URL + direct links,
                       depth 2 = starting URL + direct links + links from those pages, etc.
                       Use lower values (1-2) for focused scraping, higher values (3-5) for broader crawling.
                       Be wary that it will be exponentially more expensive to scrape deeper levels. Thus, for now let's keep it at <= 3.
            max_pages: Maximum number of pages to scrape during the crawling process (default: 50).
                       This limits the total pages processed regardless of depth.
                       Use lower values (10-50) for quick scraping, higher values (100-500) for comprehensive crawling.
            limit: Maximum number of data records to extract across all pages (default: 1000).
                    Once this limit is reached, scraping stops even if more pages are available.
                    Use this to control the size of your dataset.
            include_patterns: URL patterns to include when following links (optional, default: empty string).
                              Only URLs matching these patterns will be crawled.
                              Provide a regex pattern for exclusion.
                              Use double pipe (||) to separate multiple patterns.
                              Examples: "*/products/*||*/blog/*||https://example.com/category/*"
                              Leave empty to include all links (subject to exclude_patterns).
            exclude_patterns: URL patterns to exclude when following links (optional, default: empty string).
                              URLs matching these patterns will be skipped during crawling.
                              Provide a regex pattern for exclusion.
                              Use double pipe (||) to separate multiple patterns.
                              Examples: "*/cart/*||*/checkout/*||*/admin/*||*.pdf"
                              Useful for filtering out irrelevant pages, admin areas, or file downloads.

        Returns:
            Starts a background job and immediately returns:
            - jobId: Local MCP job ID to monitor progress
            - status/progress: Current background state
            - nextAction: Recommended poll call for get_scrape_job_status

        Example:
            Create a scraper to extract product information from an e-commerce page:
            create_scraper(
                token="MRSCRAPER_API_TOKEN",
                url="https://www.example.com/products",
                message="Extract all product names, prices, and ratings from the product listings",
                agent="general",
                proxy_country="US"
            )

        Notes:
            - This is the default go to tool from MrScraper for scraping websites.
              There is another way which is the 'Manual Scraper' tool. But if the user doesn't specify, this tool is preferred as it can dynamically scrape almost any website.
        """
        headers = {
            "Content-Type": "application/json",
            "accept": "application/json",
            "x-api-token": token,
        }
        if agent == "general" or agent == "listing":
            payload = {
                "url": url,
                "message": message,
                "agent": agent,
                "proxyCountry": proxy_country,
            }
        elif agent == "map":
            payload = {
                "url": url,
                "agent": agent,
                "maxDepth": max_depth,
                "maxPages": max_pages,
                "limit": limit,
                "includePatterns": include_patterns,
                "excludePatterns": exclude_patterns,
            }
        job = await JOB_STORE.enqueue(
            tool_name="create_ai_scraper",
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
            work=api_post(SCRAPERS_AI, headers=headers, json_body=payload),
        )
        return build_queued_tool_result(job)

    @mcp.tool(
        meta=async_tool_meta("Starting AI rerun job...", "AI rerun job started."),
        annotations={"openWorldHint": True},
    )
    async def rerun_ai_scraper(
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
        Reruns an existing AI-powered scraper on a new URL with configurable crawling parameters.
        This allows you to apply the same scraping logic (created via create_scraper) to different pages
        or websites, with control over how deep and wide the scraper should crawl.
        Use this when you want to reuse a scraper configuration on multiple URLs or crawl a website structure.

        Args:
            token: Your MrScraper API token (required for authentication)
            scraper_id: The ID of the scraper to rerun (obtained from create_scraper response).
                        This identifies which scraper configuration and extraction logic to apply.
                        Note that the agent type will correspond to the agent type when the scraper was created.
            url: The target URL to scrape. Can be the same as the original scraper URL or a different page.
                 The scraper will start from this URL and follow links based on max_depth and patterns.
            max_depth: This is only applicable for 'map' agent type.
                       Maximum depth level for crawling links from the starting URL (default: 2).
                       Depth 0 = only the starting URL, depth 1 = starting URL + direct links,
                       depth 2 = starting URL + direct links + links from those pages, etc.
                       Use lower values (1-2) for focused scraping, higher values (3-5) for broader crawling.
            max_pages: This is only applicable for 'map' agent type.
                       Maximum number of pages to scrape during the crawling process (default: 50).
                       This limits the total pages processed regardless of depth.
                       Use lower values (10-50) for quick scraping, higher values (100-500) for comprehensive crawling.
            limit: This is only applicable for 'map' agent type.
                   Maximum number of data records to extract across all pages (default: 1000).
                   Once this limit is reached, scraping stops even if more pages are available.
                   Use this to control the size of your dataset.
            include_patterns: This is only applicable for 'map' agent type.
                              URL patterns to include when following links (optional, default: empty string).
                              Only URLs matching these patterns will be crawled.
                              Provide a regex pattern for exclusion.
                              Use double pipe (||) to separate multiple patterns.
                              Examples: "*/products/*||*/blog/*||https://example.com/category/*"
                              Leave empty to include all links (subject to exclude_patterns).
            exclude_patterns: This is only applicable for 'map' agent type.
                              URL patterns to exclude when following links (optional, default: empty string).
                              URLs matching these patterns will be skipped during crawling.
                              Provide a regex pattern for exclusion.
                              Use double pipe (||) to separate multiple patterns.
                              Examples: "*/cart/*||*/checkout/*||*/admin/*||*.pdf"
                              Useful for filtering out irrelevant pages, admin areas, or file downloads.

        Returns:
            Starts a background job and immediately returns:
            - jobId: Local MCP job ID to monitor progress
            - status/progress: Current background state
            - nextAction: Recommended poll call for get_scrape_job_status

        Example:
            Rerun a product scraper on a category page, crawling up to 3 levels deep:
            rerun_scraper(
                token="MRSCRAPER_API_TOKEN",
                scraper_id="scraper_12345",
                url="https://www.example.com/category/electronics",
                max_depth=3,
                max_pages=100,
                limit=500,
                include_patterns="*/products/*",
                exclude_patterns="*/cart/*,*/checkout/*"
            )

        Notes:
            - You can get the scraper ID from the create_scraper tool. This tool is specifically to rerun AI scrapers.
        """
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
        job = await JOB_STORE.enqueue(
            tool_name="rerun_ai_scraper",
            input_preview={
                "scraperId": scraper_id,
                "url": url,
                "maxDepth": max_depth,
                "maxPages": max_pages,
                "limit": limit,
                "includePatterns": include_patterns,
                "excludePatterns": exclude_patterns,
            },
            work=api_post(SCRAPERS_AI_RERUN, headers=headers, json_body=payload),
        )
        return build_queued_tool_result(job)

    @mcp.tool(
        meta=async_tool_meta("Starting bulk AI rerun...", "Bulk AI rerun started."),
        annotations={"openWorldHint": True},
    )
    async def bulk_rerun_ai_scraper(
        token: str,
        scraper_id: str,
        urls: list[str],
    ) -> ToolResult:
        """
        Reruns an existing AI-powered scraper on multiple URLs simultaneously in a single batch operation.
        This is more efficient than calling rerun_scraper multiple times, as it processes all URLs
        in parallel and returns consolidated results. Ideal for scraping multiple pages, products, or
        articles with the same extraction logic.

        Args:
            token: Your MrScraper API token (required for authentication)
            scraper_id: The ID of the scraper to rerun (obtained from create_scraper response).
                        This identifies which scraper configuration and extraction logic to apply.
                        The same scraper logic will be applied to all URLs in the batch.
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
            Bulk scrape multiple product pages with the same scraper:
            bulk_rerun_scraper(
                token="MRSCRAPER_API_TOKEN",
                scraper_id="scraper_12345",
                urls=[
                    "https://www.example.com/products/item1",
                    "https://www.example.com/products/item2",
                    "https://www.example.com/products/item3"
                ]
            )

        Notes:
            - Similar to rerun_scraper, but for bulk scraping multiple URLs at once.
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
            tool_name="bulk_rerun_ai_scraper",
            input_preview={
                "scraperId": scraper_id,
                "urlCount": len(urls),
                "urlsSample": urls[:3],
            },
            work=api_post(SCRAPERS_AI_RERUN_BULK, headers=headers, json_body=payload),
        )
        return build_queued_tool_result(job)
