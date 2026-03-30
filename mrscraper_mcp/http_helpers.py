"""Shared HTTP client helpers for MrScraper API responses."""

from typing import Any

import httpx

from mrscraper_mcp.constants import UNAUTHORIZED_ERROR


def _parse_body(response: httpx.Response) -> Any:
    content_type = response.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        return response.json()
    return response.text


def _success(response: httpx.Response) -> dict[str, Any]:
    if response.status_code == 401:
        return {"error": UNAUTHORIZED_ERROR, "status_code": response.status_code}
    return {
        "status_code": response.status_code,
        "data": _parse_body(response),
        "headers": dict(response.headers),
    }


def _http_error(e: httpx.HTTPError) -> dict[str, Any]:
    return {
        "error": str(e),
        "status_code": getattr(e.response, "status_code", None)
        if hasattr(e, "response")
        else None,
    }


def _unexpected(e: Exception) -> dict[str, Any]:
    return {"error": f"Unexpected error: {str(e)}", "status_code": None}


async def api_get(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 600.0,
) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers or {}, timeout=timeout)
            response.raise_for_status()
            return _success(response)
        except httpx.HTTPError as e:
            return _http_error(e)
        except Exception as e:
            return _unexpected(e)


async def api_post(
    url: str,
    *,
    headers: dict[str, str],
    json_body: dict[str, Any],
    timeout: float = 600.0,
) -> dict[str, Any]:
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                url, headers=headers, json=json_body, timeout=timeout
            )
            response.raise_for_status()
            return _success(response)
        except httpx.HTTPError as e:
            return _http_error(e)
        except Exception as e:
            return _unexpected(e)
