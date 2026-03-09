"""
MrScraper MCP Server using FastMCP
This server provides web scraping capabilities through the MrScraper API.
It allows you to scrape web pages with configurable options like geolocation,
timeout settings, and resource blocking.
"""

import os
import asyncio
from pathlib import Path
from uuid import uuid4
from typing import Literal
from urllib.parse import urlencode

from dotenv import load_dotenv
from fastmcp import FastMCP
from fastmcp.server.apps import AppConfig
from fastmcp.server.dependencies import get_http_request
from starlette.requests import Request
from starlette.responses import PlainTextResponse
import httpx


load_dotenv()

# UI resource URI constant and helper for UI metadata
UI_RESOURCE_URI = os.getenv("UI_RESOURCE_URI", "ui://mrscraper/widget.html")
OPENAI_APPS_CHALLENGE_FILE = Path(".well-known/openai-apps-challenge")
TASKS: dict[str, dict] = {}


def with_ui_metadata(payload: dict) -> dict:
    return {
        "structuredContent": payload,
        "content": [],
        "_meta": {
            "openai/outputTemplate": UI_RESOURCE_URI,
        },
    }


def create_task_record(task_type: str, payload: dict) -> str:
    task_id = str(uuid4())
    TASKS[task_id] = {
        "taskId": task_id,
        "type": task_type,
        "status": "queued",
        "progress": 0.0,
        "message": "Queued",
        "result": None,
        "error": None,
        "payload": payload,
    }
    return task_id


def build_widget_html(initial_payload: dict) -> str:
    import json

    safe_payload = json.dumps(initial_payload)
    safe_ui_url = json.dumps(UI_RESOURCE_URI)
    return f"""<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>MrScraper Task</title>
    <style>
      body {{ font-family: system-ui, sans-serif; margin: 0; padding: 16px; background: transparent; color: #111; }}
      .card {{ border: 1px solid rgba(0,0,0,0.12); border-radius: 12px; padding: 16px; }}
      .row {{ display: flex; justify-content: space-between; gap: 12px; align-items: center; }}
      .muted {{ color: rgba(0,0,0,0.65); font-size: 14px; }}
      .bar {{ width: 100%; height: 10px; background: rgba(0,0,0,0.08); border-radius: 999px; overflow: hidden; margin-top: 12px; }}
      .fill {{ height: 100%; width: 0%; background: rgba(0,0,0,0.55); transition: width 250ms linear; }}
      pre {{ white-space: pre-wrap; word-break: break-word; background: rgba(0,0,0,0.04); padding: 12px; border-radius: 8px; max-height: 360px; overflow: auto; }}
      button {{ margin-top: 12px; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.15); background: white; cursor: pointer; }}
    </style>
  </head>
  <body>
    <div class=\"card\">
      <div class=\"row\">
        <strong>MrScraper</strong>
        <span id=\"status\">queued</span>
      </div>
      <div class=\"muted\" id=\"message\">Starting task…</div>
      <div class=\"muted\" id=\"elapsed\">Elapsed: 00:00</div>
      <div class=\"bar\"><div class=\"fill\" id=\"fill\"></div></div>
      <button id=\"refresh\" type=\"button\">Refresh status</button>
      <div id=\"result\" style=\"margin-top: 12px;\"></div>
    </div>

    <script>
      const initialPayload = {safe_payload};
      const uiUrl = {safe_ui_url};
      const statusEl = document.getElementById('status');
      const messageEl = document.getElementById('message');
      const elapsedEl = document.getElementById('elapsed');
      const fillEl = document.getElementById('fill');
      const resultEl = document.getElementById('result');
      const refreshBtn = document.getElementById('refresh');

      let taskId = initialPayload.taskId || null;
      let startedAt = Date.now();
      let pollHandle = null;
      let rpcId = 0;
      const pending = new Map();

      function formatElapsed(ms) {{
        const s = Math.floor(ms / 1000);
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        return `${{mm}}:${{ss}}`;
      }}

      function renderStatus(data) {{
        if (!data) return;
        statusEl.textContent = data.status || 'queued';
        messageEl.textContent = data.message || 'Working…';
        const progress = Math.max(0, Math.min(1, Number(data.progress ?? 0)));
        fillEl.style.width = `${{progress * 100}}%`;
      }}

      function renderResult(data) {{
        resultEl.innerHTML = '';
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(data, null, 2);
        resultEl.appendChild(pre);
      }}

      function postRpc(method, params) {{
        rpcId += 1;
        const id = rpcId;
        window.parent.postMessage({{ jsonrpc: '2.0', id, method, params }}, '*');
        return new Promise((resolve, reject) => {{
          pending.set(id, {{ resolve, reject }});
          setTimeout(() => {{
            if (pending.has(id)) {{
              pending.delete(id);
              reject(new Error('RPC timeout'));
            }}
          }}, 15000);
        }});
      }}

      async function refreshStatus() {{
        if (!taskId) return;
        try {{
          const res = await postRpc('tools/call', {{
            name: 'get_task_status',
            arguments: {{ task_id: taskId }}
          }});
          const payload = res?.structuredContent || res?.content?.[0]?.text || res;
          renderStatus(payload);
          if (payload?.status === 'completed' || payload?.status === 'failed' || payload?.status === 'not_found') {{
            stopPolling();
            await loadResult();
          }}
        }} catch (err) {{
          messageEl.textContent = `Status error: ${{err.message}}`;
        }}
      }}

      async function loadResult() {{
        if (!taskId) return;
        try {{
          const res = await postRpc('tools/call', {{
            name: 'get_task_result',
            arguments: {{ task_id: taskId }}
          }});
          const payload = res?.structuredContent || res?.content?.[0]?.text || res;
          renderResult(payload);
        }} catch (err) {{
          resultEl.textContent = `Result error: ${{err.message}}`;
        }}
      }}

      function startPolling() {{
        stopPolling();
        pollHandle = setInterval(refreshStatus, 1500);
      }}

      function stopPolling() {{
        if (pollHandle) clearInterval(pollHandle);
        pollHandle = null;
      }}

      window.addEventListener('message', (event) => {{
        const msg = event.data;
        if (!msg || msg.jsonrpc !== '2.0') return;

        if (msg.id && pending.has(msg.id)) {{
          const {{ resolve, reject }} = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || 'RPC error'));
          else resolve(msg.result || msg);
          return;
        }}

        if (msg.method === 'ui/notifications/tool-result') {{
          const payload = msg.params?.structuredContent || null;
          if (payload?.taskId) {{
            taskId = payload.taskId;
            renderStatus(payload);
            startPolling();
          }}
        }}
      }});

      refreshBtn.addEventListener('click', refreshStatus);
      renderStatus(initialPayload);
      setInterval(() => {{
        elapsedEl.textContent = `Elapsed: ${{formatElapsed(Date.now() - startedAt)}}`;
      }}, 250);
      if (taskId) startPolling();
    </script>
  </body>
</html>"""


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




@mcp.custom_route("/.well-known/openai-apps-challenge", methods=["GET"])
async def openai_apps_challenge(_: Request):
    if not OPENAI_APPS_CHALLENGE_FILE.exists():
        return PlainTextResponse("Verification file not found", status_code=404)

    token = OPENAI_APPS_CHALLENGE_FILE.read_text(encoding="utf-8").strip()
    return PlainTextResponse(token)


# Resource definition for widget UI
@mcp.resource("ui://mrscraper/widget.html")
def widget_resource() -> str:
    return build_widget_html(
        {
            "taskId": None,
            "status": "queued",
            "progress": 0.0,
            "message": "Starting task…",
            "kind": None,
            "url": None,
        }
    )



# Async helper for fetch_html task
async def _run_fetch_html_task(task_id: str) -> None:
    task = TASKS[task_id]
    payload = task["payload"]
    base_url = "https://api.mrscraper.com"
    params = {
        "token": payload["token"],
        "timeout": payload["timeout"],
        "geoCode": payload["geo_code"],
        "url": payload["url"],
        "blockResources": str(payload["block_resources"]).lower(),
    }
    full_url = f"{base_url}?{urlencode(params)}"

    task["status"] = "running"
    task["progress"] = 0.1
    task["message"] = "Fetching HTML..."

    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(full_url, timeout=float(payload["timeout"] + 30))
            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            if "application/json" in content_type:
                data = response.json()
            else:
                data = response.text

            task["status"] = "completed"
            task["progress"] = 1.0
            task["message"] = "Completed"
            task["result"] = {
                "status_code": response.status_code,
                "data": data,
                "headers": dict(response.headers),
            }
        except httpx.HTTPError as e:
            task["status"] = "failed"
            task["progress"] = 1.0
            task["message"] = "Failed"
            task["error"] = {
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None)
                if hasattr(e, "response")
                else None,
            }
        except Exception as e:
            task["status"] = "failed"
            task["progress"] = 1.0
            task["message"] = "Failed"
            task["error"] = {
                "error": f"Unexpected error: {str(e)}",
                "status_code": None,
            }


@mcp.tool(
    app=AppConfig(resource_uri=UI_RESOURCE_URI),
    meta={
        "ui": {"resourceUri": UI_RESOURCE_URI},
        "openai/outputTemplate": UI_RESOURCE_URI,
        "openai/toolInvocation/invoking": "Fetching HTML…",
        "openai/toolInvocation/invoked": "HTML ready",
    },
)
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
    """
    task_id = create_task_record(
        "fetch_html",
        {
            "token": token,
            "url": url,
            "timeout": timeout,
            "geo_code": geo_code,
            "block_resources": block_resources,
        },
    )
    asyncio.create_task(_run_fetch_html_task(task_id))

    return {
        "structuredContent": {
            "taskId": task_id,
            "status": "queued",
            "progress": 0.0,
            "message": "Started fetch_html task",
            "kind": "fetch_html",
            "url": url,
        },
        "content": [],
        "_meta": {
            "openai/outputTemplate": UI_RESOURCE_URI,
        },
    }



# Async helper for create_ai_scraper task
async def _run_create_ai_scraper_task(task_id: str) -> None:
    task = TASKS[task_id]
    payload = task["payload"]
    endpoint_url = "https://api.app.mrscraper.com/api/v1/scrapers-ai"
    headers = {
        "Content-Type": "application/json",
        "accept": "application/json",
        "x-api-token": payload["token"],
    }

    if payload["agent"] == "general" or payload["agent"] == "listing":
        request_payload = {
            "url": payload["url"],
            "message": payload["message"],
            "agent": payload["agent"],
            "proxyCountry": payload["proxy_country"],
        }
    else:
        request_payload = {
            "url": payload["url"],
            "agent": payload["agent"],
            "maxDepth": payload["max_depth"],
            "maxPages": payload["max_pages"],
            "limit": payload["limit"],
            "includePatterns": payload["include_patterns"],
            "excludePatterns": payload["exclude_patterns"],
        }

    task["status"] = "running"
    task["progress"] = 0.1
    task["message"] = "Creating AI scraper..."

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                endpoint_url, headers=headers, json=request_payload, timeout=600
            )
            response.raise_for_status()

            content_type = response.headers.get("content-type", "").lower()
            if "application/json" in content_type:
                data = response.json()
            else:
                data = response.text

            task["status"] = "completed"
            task["progress"] = 1.0
            task["message"] = "Completed"
            task["result"] = {
                "status_code": response.status_code,
                "data": data,
                "headers": dict(response.headers),
            }
        except httpx.HTTPError as e:
            task["status"] = "failed"
            task["progress"] = 1.0
            task["message"] = "Failed"
            task["error"] = {
                "error": str(e),
                "status_code": getattr(e.response, "status_code", None)
                if hasattr(e, "response")
                else None,
            }
        except Exception as e:
            task["status"] = "failed"
            task["progress"] = 1.0
            task["message"] = "Failed"
            task["error"] = {
                "error": f"Unexpected error: {str(e)}",
                "status_code": None,
            }


@mcp.tool(
    app=AppConfig(resource_uri=UI_RESOURCE_URI),
    meta={
        "ui": {"resourceUri": UI_RESOURCE_URI},
        "openai/outputTemplate": UI_RESOURCE_URI,
        "openai/toolInvocation/invoking": "Creating scraper…",
        "openai/toolInvocation/invoked": "Scraper ready",
    },
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
) -> dict:
    """
    Creates an AI-powered scraper that intelligently extracts structured data from a website based on natural language instructions.
    The scraper uses AI agents to understand the page structure and extract the requested information automatically.
    This is ideal for extracting data from complex websites without writing custom selectors.
    """
    task_id = create_task_record(
        "create_ai_scraper",
        {
            "token": token,
            "url": url,
            "message": message,
            "agent": agent,
            "proxy_country": proxy_country,
            "max_depth": max_depth,
            "max_pages": max_pages,
            "limit": limit,
            "include_patterns": include_patterns,
            "exclude_patterns": exclude_patterns,
        },
    )
    asyncio.create_task(_run_create_ai_scraper_task(task_id))

    return {
        "structuredContent": {
            "taskId": task_id,
            "status": "queued",
            "progress": 0.0,
            "message": "Started create_ai_scraper task",
            "kind": "create_ai_scraper",
            "url": url,
            "agent": agent,
        },
        "content": [],
        "_meta": {
            "openai/outputTemplate": UI_RESOURCE_URI,
        },
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


# Move main block to end of file

# Insert new tools for async task status/result before rerun_ai_scraper

@mcp.tool
async def get_task_status(task_id: str) -> dict:
    """
    Returns the current status for an async task started by fetch_html or create_ai_scraper.
    Use this from the ChatGPT App UI to poll progress and show a loading bar.
    """
    task = TASKS.get(task_id)
    if not task:
        return with_ui_metadata(
            {
                "taskId": task_id,
                "status": "not_found",
                "progress": 1.0,
                "message": "Task not found",
            }
        )

    return with_ui_metadata(
        {
            "taskId": task["taskId"],
            "type": task["type"],
            "status": task["status"],
            "progress": task["progress"],
            "message": task["message"],
            "hasResult": task["result"] is not None,
            "hasError": task["error"] is not None,
        }
    )


@mcp.tool
async def get_task_result(task_id: str) -> dict:
    """
    Returns the final result for an async task started by fetch_html or create_ai_scraper.
    """
    task = TASKS.get(task_id)
    if not task:
        return with_ui_metadata(
            {
                "taskId": task_id,
                "status": "not_found",
                "message": "Task not found",
            }
        )

    if task["error"] is not None:
        return with_ui_metadata(
            {
                "taskId": task_id,
                "status": task["status"],
                "error": task["error"],
            }
        )

    return with_ui_metadata(
        {
            "taskId": task_id,
            "status": task["status"],
            "result": task["result"],
        }
    )
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