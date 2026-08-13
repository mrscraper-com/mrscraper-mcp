from importlib.metadata import entry_points

import pytest

from mrscraper_mcp.main import resolve_transport


@pytest.mark.parametrize(
    ("configured", "expected"),
    [("stdio", "stdio"), ("HTTP", "http"), (" http ", "http")],
)
def test_resolve_transport_accepts_supported_values(configured, expected):
    assert resolve_transport(configured) == expected


@pytest.mark.parametrize("configured", ["", "sse", "htp", "websocket"])
def test_resolve_transport_rejects_unknown_values(configured):
    with pytest.raises(ValueError, match="Unsupported TRANSPORT"):
        resolve_transport(configured)


def test_package_installs_console_entry_point():
    scripts = {
        entry.name: entry.value for entry in entry_points(group="console_scripts")
    }
    assert scripts["mrscraper-mcp"] == "mrscraper_mcp.main:run"
