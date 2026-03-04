"""
MrScraper MCP Server using FastMCP
This server provides web scraping capabilities through the MrScraper API.
It allows you to scrape web pages with configurable options like geolocation,
timeout settings, and resource blocking.
"""

import os
from typing import Literal
from urllib.parse import urlencode

from dotenv import load_dotenv
from fastmcp import FastMCP
import httpx

load_dotenv()


# Create the FastMCP server instance with instructions
mcp = FastMCP(
    name="MrScraper MCP Server",
    instructions=(
        "An MCP server that provides web scraping capabilities through the MrScraper API. "
        "This server allows you to scrape web pages with advanced features including "
        "geolocation-based scraping, configurable timeouts, and resource blocking options. "
        "Perfect for extracting content from websites that require JavaScript rendering, "
        "geographic restrictions, or complex page structures."
    ),
)


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
            token="atk_your_token_here",
            url="https://stockx.com/air-jordan-1-retro-low-og-chicago-2025",
            geo_code="US",
            timeout=120,
            block_resources=False
        )

        Fast scraping with resource blocking enabled:
        fetch_html(
            token="atk_your_token_here",
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
    base_url = "https://api.mrscraper.com"

    # Build query parameters
    params = {
        "token": token,
        "timeout": timeout,
        "geoCode": geo_code,
        "url": url,
        "blockResources": str(block_resources).lower(),
    }

    # Construct the full URL with query parameters
    full_url = f"{base_url}?{urlencode(params)}"

    async with httpx.AsyncClient() as client:
        try:
            # Use a longer timeout since scraping can take time
            response = await client.get(full_url, timeout=float(timeout + 30))
            response.raise_for_status()

            # Try to parse as JSON first, fallback to text
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
        A dictionary containing:
        - status_code: HTTP status code of the response
        - data: The created scraper information including scraper ID, configuration, and status.
                The scraper ID is essential for subsequent operations like rerun_scraper.
        - headers: Response headers from the API
        - error: Error message if the request failed (if applicable)

    Example:
        Create a scraper to extract product information from an e-commerce page:
        create_scraper(
            token="atk_your_token_here",
            url="https://www.example.com/products",
            message="Extract all product names, prices, and ratings from the product listings",
            agent="general",
            proxy_country="US"
        )

    Notes:
        - This is the default go to tool from MrScraper for scraping websites.
          There is another way which is the 'Manual Scraper' tool. But if the user doesn't specify, this tool is preferred as it can dynamically scrape almost any website.
    """
    endpoint_url = "https://api.app.mrscraper.com/api/v1/scrapers-ai"
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

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                endpoint_url, headers=headers, json=payload, timeout=600
            )
            response.raise_for_status()

            # Try to parse as JSON first, fallback to text
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
        A dictionary containing:
        - status_code: HTTP status code of the response
        - data: The scraping job information including job ID, status, and result metadata.
                The results can be retrieved using get_all_results or get_result_by_id.
        - headers: Response headers from the API
        - error: Error message if the request failed (if applicable)

    Example:
        Rerun a product scraper on a category page, crawling up to 3 levels deep:
        rerun_scraper(
            token="atk_your_token_here",
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
    endpoint_url = "https://api.app.mrscraper.com/api/v1/scrapers-ai-rerun"
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
                endpoint_url, headers=headers, json=payload, timeout=600
            )
            response.raise_for_status()

            # Try to parse as JSON first, fallback to text
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


@mcp.tool
async def bulk_rerun_ai_scraper(
    token: str,
    scraper_id: str,
    urls: list[str],
) -> dict:
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
        A dictionary containing:
        - status_code: HTTP status code of the response
        - data: Bulk scraping job information including job ID, status, and metadata for all URLs.
                Results for individual URLs can be retrieved using get_all_results or get_result_by_id.
                The response may include per-URL status information.
        - headers: Response headers from the API
        - error: Error message if the request failed (if applicable)

    Example:
        Bulk scrape multiple product pages with the same scraper:
        bulk_rerun_scraper(
            token="atk_your_token_here",
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
    endpoint_url = "https://api.app.mrscraper.com/api/v1/scrapers-ai-rerun/bulk"
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

            # Try to parse as JSON first, fallback to text
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
            token="atk_your_token_here",
            scraper_id="manual_scraper_67890",
            url="https://www.example.com/products/new-item"
        )

    Notes:
        - This tool is specifically to rerun manually configured scrapers. It is not applicable for AI scrapers. Call this tool when the user specifies a manual scraper.
    """
    endpoint_url = "https://api.app.mrscraper.com/api/v1/scrapers-manual-rerun"
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

            # Try to parse as JSON first, fallback to text
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
            token="atk_your_token_here",
            scraper_id="scraper_12345",
            urls=[
                "https://www.example.com/products/item1",
                "https://www.example.com/products/item2",
                "https://www.example.com/products/item3"
            ]
        )
    """

    endpoint_url = "https://api.app.mrscraper.com/api/v1/scrapers-manual-rerun/bulk"
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

            # Try to parse as JSON first, fallback to text
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


@mcp.tool
async def get_all_results(
    token: str,
    sort_field: Literal[
        "createdAt",
        "updatedAt",
        "id",
        "type",
        "url",
        "status",
        "error",
        "tokenUsage",
        "runtime",
    ] = "updatedAt",
    sort_order: Literal["ASC", "DESC"] = "DESC",
    page_size: int = 10,
    page: int = 1,
    search: str = None,
    date_range_column: str = None,
    start_at: str = None,
    end_at: str = None,
) -> dict:
    """
    Retrieves a paginated list of all scraping results with advanced filtering, sorting, and search capabilities.
    This tool allows you to browse, search, and filter all results from your scrapers, making it easy to
    find specific data or monitor scraping activity. Results are returned in pages for efficient handling
    of large datasets.

    Args:
        token: Your MrScraper API token (required for authentication)
        sort_field: Field name to sort results by (default: 'updatedAt').
                    Valid options: 'createdAt', 'updatedAt', 'id', 'type', 'url', 'status', 'error', 'tokenUsage', 'runtime'.
                    Use 'updatedAt' or 'createdAt' for time-based sorting, 'id' for ID-based sorting,
                    'url' for URL-based sorting, 'status' or 'error' for status-based sorting,
                    'tokenUsage' for token usage sorting, or 'runtime' for execution time sorting.
        sort_order: Sort direction, either 'ASC' for ascending or 'DESC' for descending (default: 'DESC').
        page_size: Number of results to return per page (default: 10).
                   Use smaller values (10-50) for faster responses, larger values (100-500) for bulk retrieval.
                   Maximum value may be limited by API constraints.
        page: Page number to retrieve, starting from 1 (default: 1).
              Use this with page_size to paginate through all results.
              Example: page=1 gets first page, page=2 gets second page, etc.
        search: Optional search query to filter results by text content (default: None).
                Searches across result data fields. Leave as None to return all results.
                Examples: "product", "2024", "example.com"
        date_range_column: Column name to use for date range filtering (default: None).
                           Must be set along with start_at and/or end_at to enable date filtering.
                           Common options: 'updatedAt', 'createdAt', 'scrapedAt'
                           Leave as None if not using date range filtering.
        start_at: Start date/time for date range filtering (default: None).
                  Format should match API expectations (typically ISO 8601: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS').
                  Only results with date_range_column >= start_at will be returned.
                  Requires date_range_column to be set. Leave as None to not filter by start date.
        end_at: End date/time for date range filtering (default: None).
                Format should match API expectations (typically ISO 8601: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS').
                Only results with date_range_column <= end_at will be returned.
                Requires date_range_column to be set. Leave as None to not filter by end date.

    Returns:
        A dictionary containing:
        - status_code: HTTP status code of the response
        - data: Paginated results object containing:
                - results: Array of result objects with extracted data, metadata, and IDs
                - pagination: Information about total pages, current page, total results, etc.
                - Each result includes fields like result ID, scraper ID, URL, extracted data, timestamps
        - headers: Response headers from the API
        - error: Error message if the request failed (if applicable)

    Example:
        Get the 20 most recently updated results from the last 7 days:
        get_all_results(
            token="atk_your_token_here",
            sort_field="updatedAt",
            sort_order="DESC",
            page_size=20,
            page=1,
            date_range_column="updatedAt",
            start_at="2024-01-01",
            end_at="2024-01-08"
        )

        Search for results containing "product" and sort by creation date:
        get_all_results(
            token="atk_your_token_here",
            search="product",
            sort_field="createdAt",
            sort_order="DESC",
            page_size=50
        )
    """
    endpoint_url = "https://api.app.mrscraper.com/api/v1/results"
    headers = {
        "Content-Type": "application/json",
        "accept": "application/json",
        "x-api-token": token,
    }
    params = {
        "sortField": sort_field,
        "sortOrder": sort_order,
        "pageSize": page_size,
        "page": page,
    }
    if search:
        params["search"] = search
    if date_range_column:
        params["dateRangeColumn"] = date_range_column
    if start_at:
        params["startAt"] = start_at
    if end_at:
        params["endAt"] = end_at

    full_url = f"{endpoint_url}?{urlencode(params)}"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(full_url, headers=headers, timeout=600)
            response.raise_for_status()

            # Try to parse as JSON first, fallback to text
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


@mcp.tool
async def get_result_by_id(
    token: str,
    result_id: str,
) -> dict:
    """
    Retrieves detailed information for a specific scraping result by its unique result ID.
    This tool provides complete result data including all extracted fields, metadata, timestamps,
    and associated scraper information. Use this when you have a result ID (from get_all_results
    or scraper execution responses) and need the full details of that specific result.

    Args:
        token: Your MrScraper API token (required for authentication)
        result_id: The unique identifier of the result to retrieve (required).
                   Result IDs are returned in responses from scraper execution (rerun_scraper,
                   bulk_rerun_scraper, etc.) and in the results array from get_all_results.

    Returns:
        A dictionary containing:
        - status_code: HTTP status code of the response
        - data: Complete result object containing:
                - result_id: The unique identifier for this result
                - scraper_id: ID of the scraper that generated this result
                - url: The URL that was scraped
                - extracted_data: The actual data extracted by the scraper (structure depends on scraper configuration)
                - metadata: Additional information like timestamps (createdAt, updatedAt), status, etc.
                - Any other fields specific to the result type
        - headers: Response headers from the API
        - error: Error message if the request failed (if applicable)

    Example:
        Retrieve detailed information for a specific scraping result:
        get_result_by_id(
            token="atk_your_token_here",
            result_id="result_12345"
        )
    """
    endpoint_url = f"https://api.app.mrscraper.com/api/v1/results/{result_id}"
    headers = {
        "Content-Type": "application/json",
        "accept": "application/json",
        "x-api-token": token,
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(endpoint_url, headers=headers, timeout=600)
            response.raise_for_status()

            # Try to parse as JSON first, fallback to text
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


if __name__ == "__main__":
    # Check if running in Docker/remote mode (HTTP transport)
    # or local mode (stdio transport)
    transport = os.getenv("TRANSPORT", "stdio").lower()

    if transport == "http":
        # Run with HTTP transport for remote access
        port = int(os.getenv("PORT", 8000))
        host = os.getenv("HOST", "0.0.0.0")
        mcp.run(transport="http", port=port, host=host)
    else:
        # Run with stdio transport for local MCP clients
        mcp.run()
