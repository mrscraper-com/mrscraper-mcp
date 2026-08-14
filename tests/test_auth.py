import pytest
from fastmcp.exceptions import ToolError

from mrscraper_mcp import auth


def _no_http_request():
    raise RuntimeError("No active HTTP request found.")


def test_stdio_uses_environment_api_key(monkeypatch):
    monkeypatch.setattr(auth, "get_access_token", lambda: None)
    monkeypatch.setattr(auth, "get_http_request", _no_http_request)
    monkeypatch.setattr(
        auth,
        "get_http_headers",
        lambda **_kwargs: pytest.fail("stdio must not inspect HTTP headers"),
    )
    monkeypatch.setenv("MRSCRAPER_API_KEY", "stdio-key")
    monkeypatch.setenv("MRSCRAPER_API_TOKEN", "alternate-key")

    assert auth.resolve_api_token() == "stdio-key"


def test_http_uses_request_header_instead_of_environment(monkeypatch):
    monkeypatch.setattr(auth, "get_access_token", lambda: None)
    monkeypatch.setattr(auth, "get_http_request", lambda: object())
    monkeypatch.setattr(
        auth,
        "get_http_headers",
        lambda **_kwargs: {"authorization": "Bearer caller-key"},
    )
    monkeypatch.setenv("MRSCRAPER_API_KEY", "server-key")

    assert auth.resolve_api_token() == "caller-key"


def test_http_never_falls_back_to_environment_key(monkeypatch):
    monkeypatch.setattr(auth, "get_access_token", lambda: None)
    monkeypatch.setattr(auth, "get_http_request", lambda: object())
    monkeypatch.setattr(auth, "get_http_headers", lambda **_kwargs: {})
    monkeypatch.setenv("MRSCRAPER_API_KEY", "server-key")

    with pytest.raises(ToolError, match="MrScraper API token is required"):
        auth.resolve_api_token()
