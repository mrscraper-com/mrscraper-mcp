"""CLI-compatible HTML formatting for the canonical ``fetch`` tool."""

from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from markdownify import markdownify

FetchFormat = Literal["markdown", "html", "json"]
FETCH_FORMATS = ("markdown", "html", "json")


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _resolve_http_url(value: str | None, base_url: str) -> str | None:
    if not value or value.lower().startswith(
        ("data:", "javascript:", "mailto:", "tel:")
    ):
        return None
    resolved = urljoin(base_url, value)
    parsed = urlparse(resolved)
    return resolved if parsed.scheme in {"http", "https"} else None


def html_to_document(html: str, url: str) -> dict[str, Any]:
    """Convert HTML to the compact document representation used by the CLI."""
    soup = BeautifulSoup(html, "html.parser")
    for element in soup.select("script, style, noscript, template, svg"):
        element.decompose()

    title = _clean_text(soup.title.get_text(" ", strip=True)) if soup.title else ""
    description_element = soup.select_one(
        'meta[name="description"], meta[property="og:description"]'
    )
    description = (
        _clean_text(description_element.get("content", ""))
        if description_element
        else ""
    )
    language = soup.html.get("lang") if soup.html else None

    links: list[dict[str, str]] = []
    seen_links: set[str] = set()
    for anchor in soup.find_all("a"):
        resolved = _resolve_http_url(anchor.get("href"), url)
        if not resolved or resolved in seen_links:
            continue
        seen_links.add(resolved)
        links.append(
            {
                "text": _clean_text(anchor.get_text(" ", strip=True)),
                "url": resolved,
            }
        )

    images: list[dict[str, str]] = []
    seen_images: set[str] = set()
    for image in soup.find_all("img"):
        resolved = _resolve_http_url(image.get("src") or image.get("data-src"), url)
        if not resolved or resolved in seen_images:
            continue
        seen_images.add(resolved)
        images.append(
            {
                "alt": _clean_text(image.get("alt", "")),
                "url": resolved,
            }
        )

    content_root = soup.body or soup
    return {
        "url": url,
        "title": title or None,
        "description": description or None,
        "language": language,
        "text": _clean_text(content_root.get_text(" ", strip=True)),
        "links": links,
        "images": images,
    }


def convert_html(html: str, format: FetchFormat, url: str) -> str | dict[str, Any]:
    if format not in FETCH_FORMATS:
        raise ValueError(f"format must be one of: {', '.join(FETCH_FORMATS)}")
    if format == "html":
        return html
    if format == "json":
        return html_to_document(html, url)

    soup = BeautifulSoup(html, "html.parser")
    for element in soup.select("script, style, noscript, template, svg"):
        element.decompose()
    for anchor in soup.find_all("a"):
        resolved = _resolve_http_url(anchor.get("href"), url)
        if resolved:
            anchor["href"] = resolved
    for image in soup.find_all("img"):
        resolved = _resolve_http_url(image.get("src") or image.get("data-src"), url)
        if resolved:
            image["src"] = resolved

    return markdownify(
        str(soup),
        heading_style="ATX",
        keep_inline_images_in=["p", "div"],
    ).strip()


def format_fetch_result(
    result: dict[str, Any], *, format: FetchFormat, url: str
) -> dict[str, Any]:
    formatted = {**result, "format": format, "url": url}
    if not result.get("error") and isinstance(result.get("data"), str):
        formatted["data"] = convert_html(result["data"], format, url)
    return formatted
