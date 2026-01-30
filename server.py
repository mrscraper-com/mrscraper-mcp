"""
MrScraper MCP Server using FastMCP
This server provides web scraping capabilities through the MrScraper API.
It allows you to scrape web pages with configurable options like geolocation,
timeout settings, and resource blocking.
"""
import os
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
    )
)


@mcp.tool
async def scrape_url(
    url: str,
    token: str,
    timeout: int = 120,
    geo_code: str = "US",
    block_resources: bool = False
) -> dict:
    """
    Scrape a web page using the MrScraper API.
    
    This tool fetches and renders web pages using MrScraper's infrastructure,
    which handles JavaScript execution, geolocation-based access, and resource management.
    
    Args:
        url: The target URL to scrape (e.g., 'https://www.example.com/page')
        token: Your MrScraper API token (required for authentication)
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
        Get HTML of https://stockx.com/air-jordan-1-retro-low-og-chicago-2025:
        scrape_url(
            url="https://stockx.com/air-jordan-1-retro-low-og-chicago-2025",
            token="atk_your_token_here",
            geo_code="US",
            timeout=120
        )
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
            
            return {
                "status_code": response.status_code,
                "data": data,
                "headers": dict(response.headers),
            }
        except httpx.HTTPError as e:
            return {
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None) if hasattr(e, "response") else None,
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
