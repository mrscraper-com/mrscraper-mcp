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

OPENAI_APPS_CHALLENGE_TOKEN = "9WkUWd9sj6L2vESfRpJFdiWVsL2pI7UFZgsr1PVKec0"

SCRAPE_JOB_WIDGET_URI = "ui://widget/mrscraper-job-status-v2.html"
MAX_ASYNC_JOB_HISTORY = 200

# ChatGPT Apps SDK: resource _meta for the widget template. Submission requires a
# dedicated app origin and a non-empty CSP (empty allowlists count as "not set").
WIDGET_APP_ORIGIN = "https://mrscraper.com"
WIDGET_CSP_CONNECT_DOMAINS = []
WIDGET_CSP_RESOURCE_DOMAINS = [
    "https://persistent.oaistatic.com",
]
