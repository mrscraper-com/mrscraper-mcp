"""API endpoints and shared messages.

The environment overrides intentionally match ``@mrscraper/cli`` so the MCP
and CLI can target the same local or staging services during development.
"""

import os

from dotenv import load_dotenv


load_dotenv()


def _base_url(environment_name: str, default: str) -> str:
    return os.environ.get(environment_name, default).rstrip("/")


API_BASE_URL = _base_url(
    "MRSCRAPER_API_BASE_URL", "https://api.app.mrscraper.com/api/v1"
)
FETCH_HTML_BASE_URL = _base_url("MRSCRAPER_FETCH_BASE_URL", "https://api.mrscraper.com")
SYNC_SCRAPER_BASE_URL = _base_url(
    "MRSCRAPER_SYNC_BASE_URL", "https://sync.scraper.mrscraper.com"
)

# Backward-compatible aliases for legacy modules that are no longer registered.
API_BASE = FETCH_HTML_BASE_URL
API_APP_BASE = API_BASE_URL.removesuffix("/api/v1")

SUBSCRIPTION_ACCOUNTS = f"{API_BASE_URL}/subscription-accounts"
ANALYTIC_STATUSES = f"{API_BASE_URL}/analytic/statuses"
SCRAPERS_AI = f"{API_BASE_URL}/scrapers-ai"
SCRAPERS_AI_RERUN = f"{API_BASE_URL}/scrapers-ai-rerun"
SCRAPERS_AI_RERUN_BULK = f"{API_BASE_URL}/scrapers-ai-rerun/bulk"
SCRAPERS_MANUAL_RERUN = f"{API_BASE_URL}/scrapers-manual-rerun"
SCRAPERS_MANUAL_RERUN_BULK = f"{API_BASE_URL}/scrapers-manual-rerun/bulk"
RESULTS = f"{API_BASE_URL}/results"
GOOGLE_SERP_SYNC = f"{SYNC_SCRAPER_BASE_URL}/api/google/serp/v2/sync"

UNAUTHORIZED_ERROR = "Unauthorized or invalid token. Please go to https://app.mrscraper.com to get your token."
