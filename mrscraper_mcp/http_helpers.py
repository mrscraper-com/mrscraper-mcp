"""Shared, credential-safe HTTP helpers for MrScraper API responses."""

from __future__ import annotations

import re
from typing import Any

import httpx

from mrscraper_mcp.constants import UNAUTHORIZED_ERROR

DEFAULT_TIMEOUT = 600.0
SENSITIVE_RESPONSE_HEADERS = {
    "authorization",
    "proxy-authorization",
    "set-cookie",
    "set-cookie2",
    "x-api-token",
}
SENSITIVE_DATA_KEYS = {
    "accesstoken",
    "api_key",
    "apikey",
    "apitoken",
    "authorization",
    "cookie",
    "latestapitoken",
    "password",
    "refreshtoken",
    "secret",
    "set-cookie",
    "token",
    "x-api-token",
}

_API_TOKEN_PATTERN = re.compile(r"\batk_[A-Za-z0-9_-]{12,}\b")
_AUTHORIZATION_PATTERN = re.compile(
    r"(authorization\s*:\s*bearer\s+)[^\s'\"\\]+", re.IGNORECASE
)
_API_HEADER_PATTERN = re.compile(r"(x-api-token\s*:\s*)[^\s'\"\\]+", re.IGNORECASE)
_SIGNED_QUERY_PATTERN = re.compile(
    r"([?&](?:token|api[_-]?key|signature|sig|x-amz-"
    r"(?:credential|security-token|signature))=)[^&\s'\"\\]+",
    re.IGNORECASE,
)


def _redact_sensitive_string(value: str) -> str:
    redacted = _API_TOKEN_PATTERN.sub("[REDACTED_API_TOKEN]", value)
    redacted = _AUTHORIZATION_PATTERN.sub(r"\1[REDACTED]", redacted)
    redacted = _API_HEADER_PATTERN.sub(r"\1[REDACTED]", redacted)
    return _SIGNED_QUERY_PATTERN.sub(r"\1[REDACTED]", redacted)


def sanitize_response_data(value: Any, seen: set[int] | None = None) -> Any:
    """Recursively remove credentials from arbitrary API response bodies."""
    if isinstance(value, str):
        return _redact_sensitive_string(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value

    object_ids = seen if seen is not None else set()
    if isinstance(value, (list, tuple, dict)):
        identity = id(value)
        if identity in object_ids:
            return "[CIRCULAR]"
        object_ids.add(identity)

    if isinstance(value, (list, tuple)):
        return [sanitize_response_data(item, object_ids) for item in value]
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            sanitized[key_text] = (
                "[REDACTED]"
                if key_text.lower() in SENSITIVE_DATA_KEYS
                else sanitize_response_data(item, object_ids)
            )
        return sanitized
    return value


def _parse_body(response: httpx.Response) -> Any:
    content_type = response.headers.get("content-type", "").lower()
    if "application/json" in content_type:
        try:
            return response.json()
        except ValueError:
            return response.text
    return response.text


def _response_headers(response: httpx.Response) -> dict[str, str]:
    return {
        name: value
        for name, value in response.headers.items()
        if name.lower() not in SENSITIVE_RESPONSE_HEADERS
    }


def _response_result(response: httpx.Response) -> dict[str, Any]:
    data = sanitize_response_data(_parse_body(response))
    headers = _response_headers(response)
    if response.status_code == 401:
        return {
            "error": UNAUTHORIZED_ERROR,
            "status_code": response.status_code,
            "data": data,
            "headers": headers,
        }
    if response.is_error:
        return {
            "error": f"HTTP {response.status_code}",
            "status_code": response.status_code,
            "data": data,
            "headers": headers,
        }
    return {
        "status_code": response.status_code,
        "data": data,
        "headers": headers,
    }


async def request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    json_body: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Make one request and preserve sanitized response details on failures."""
    try:
        if client is not None:
            response = await client.request(
                method,
                url,
                headers=headers,
                params=params,
                json=json_body,
                timeout=timeout,
            )
        else:
            async with httpx.AsyncClient() as owned_client:
                response = await owned_client.request(
                    method,
                    url,
                    headers=headers,
                    params=params,
                    json=json_body,
                    timeout=timeout,
                )
        return _response_result(response)
    except httpx.TimeoutException:
        return {
            "error": f"Request timed out after {timeout:g}s",
            "status_code": None,
            "data": None,
            "headers": {},
        }
    except httpx.HTTPError as exc:
        return {
            "error": str(exc),
            "status_code": None,
            "data": None,
            "headers": {},
        }
    except Exception as exc:  # pragma: no cover - defensive fallback
        return {
            "error": f"Unexpected error: {exc}",
            "status_code": None,
            "data": None,
            "headers": {},
        }


async def api_get(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    return await request(
        "GET",
        url,
        headers=headers,
        params=params,
        timeout=timeout,
        client=client,
    )


async def api_post(
    url: str,
    *,
    headers: dict[str, str],
    json_body: dict[str, Any],
    timeout: float = DEFAULT_TIMEOUT,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    return await request(
        "POST",
        url,
        headers=headers,
        json_body=json_body,
        timeout=timeout,
        client=client,
    )
