"""Google SERP sync API (MrScraper sync scraper)."""

from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult
import httpx

from mrscraper_mcp.auth import normalize_bearer_token, resolve_api_token
from mrscraper_mcp.constants import GOOGLE_SERP_SYNC
from mrscraper_mcp.job_runtime import (
    JOB_STORE,
    async_tool_meta,
    build_queued_tool_result,
)


async def _google_serp_sync_impl(
    access_token: str,
    url: str,
    raw: bool = True,
    session_cookie: str = "",
    timeout: float = 600.0,
) -> dict:
    bearer = normalize_bearer_token(access_token)
    headers: dict[str, str] = {
        "Authorization": f"Bearer {bearer}",
        "Content-Type": "application/json",
        "accept": "application/json",
    }
    if session_cookie.strip():
        headers["Cookie"] = session_cookie.strip()

    payload = {"url": url, "raw": raw}

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                GOOGLE_SERP_SYNC,
                headers=headers,
                json=payload,
                timeout=timeout,
            )

            if response.status_code == 401:
                return {
                    "error": (
                        "Unauthorized or invalid access token. "
                        "Use a valid sync API bearer token from MrScraper."
                    ),
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


def register_google_serp_sync_tool(mcp: FastMCP) -> None:
    @mcp.tool
    async def google_serp_sync(
        url: str,
        raw: bool = True,
        session_cookie: str = "",
        timeout: float = 600.0,
    ) -> dict:
        """
        Run a synchronous Google SERP scrape via the MrScraper sync API
        (`/api/google/serp/sync`). Returns parsed SERP payload (or raw HTML/text when
        `raw` is true, depending on API behavior).

        Args:
            url: Full Google search URL to fetch (e.g. `https://www.google.com/search?q=iphone+17`).
            raw: When true, requests raw response from the API (default: True).
            session_cookie: Optional `Cookie` header value (e.g. `sl-session=...`) if your
                deployment requires it.
            timeout: HTTP client timeout in seconds (default: 600).

        Returns:
            Dict with `status_code`, `data`, `headers`, or `error` on failure.

        Notes:
            - API token is set on the MCP connection (`Authorization: Bearer …`), not tool args.
            - SERP/HTML responses can be very large; avoid loading entire `data` into the model
              context—save externally or summarize.
        """
        return await _google_serp_sync_impl(
            access_token=resolve_api_token(),
            url=url,
            raw=raw,
            session_cookie=session_cookie,
            timeout=timeout,
        )


def register_google_serp_sync_job_tool(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta(
            "Google SERP sync running in background...",
            "Google SERP sync job started.",
        ),
        annotations={
            "openWorldHint": True,
            "readOnlyHint": True,
            "destructiveHint": False,
        },
    )
    async def google_serp_sync_job(
        url: str,
        raw: bool = True,
        session_cookie: str = "",
        timeout: float = 600.0,
    ) -> ToolResult:
        """
        Same as `google_serp_sync` but runs as a background job (for clients that time out
        on long tool calls). Use `get_scrape_job(job_id=...)` when the job finishes for the
        same `status_code` / `data` / `headers` / `error` shape as the synchronous tool.

        Args:
            url: Full Google search URL.
            raw: Request raw API output (default: True).
            session_cookie: Optional Cookie header if required.
            timeout: HTTP timeout in seconds (default: 600).

        Notes:
            - API token is set on the MCP connection (`Authorization: Bearer …`), not tool args.
        """
        api_token = resolve_api_token()
        job = await JOB_STORE.enqueue(
            tool_name="google_serp_sync_job",
            input_preview={"url": url, "raw": raw},
            work=_google_serp_sync_impl(
                access_token=api_token,
                url=url,
                raw=raw,
                session_cookie=session_cookie,
                timeout=timeout,
            ),
        )
        return build_queued_tool_result(job)
