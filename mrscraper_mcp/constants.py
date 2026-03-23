"""API endpoints and shared messages."""

FETCH_HTML_API_BASE = "https://api.mrscraper.com"

API_APP_BASE = "https://api.app.mrscraper.com"
SCRAPERS_AI = f"{API_APP_BASE}/api/v1/scrapers-ai"
SCRAPERS_AI_RERUN = f"{API_APP_BASE}/api/v1/scrapers-ai-rerun"
SCRAPERS_AI_RERUN_BULK = f"{API_APP_BASE}/api/v1/scrapers-ai-rerun/bulk"
SCRAPERS_MANUAL_RERUN = f"{API_APP_BASE}/api/v1/scrapers-manual-rerun"
SCRAPERS_MANUAL_RERUN_BULK = f"{API_APP_BASE}/api/v1/scrapers-manual-rerun/bulk"
RESULTS = f"{API_APP_BASE}/api/v1/results"

UNAUTHORIZED_ERROR = "Unauthorized or invalid token. Please go to https://app.mrscraper.com to get your token."

OPENAI_APPS_CHALLENGE_TOKEN = "UkKS1u5vKkqnhEPjgQC2mImFd4J0oNsjNHTfoL6df0s"

SCRAPE_JOB_WIDGET_URI = "ui://widget/mrscraper-job-status-v2.html"
MAX_ASYNC_JOB_HISTORY = 200
