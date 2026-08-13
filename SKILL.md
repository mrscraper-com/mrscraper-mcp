---
name: mrscraper
description: Use the MrScraper MCP tools to fetch pages, extract structured data, search Google, inspect account usage, rerun saved scrapers, and retrieve stored results.
tags: [scraping, data-extraction, web-crawling, google-serp]

homepage: https://mrscraper.com/
vendor: MrScraper
support_email: support@mrscraper.com

required_env_vars: [MRSCRAPER_API_KEY]
primary_credential: MRSCRAPER_API_KEY
metadata: {"openclaw":{"requires":{"env":["MRSCRAPER_API_KEY"]},"primaryEnv":"MRSCRAPER_API_KEY"}}

network: {"allowed_hosts":["api.mrscraper.com","api.app.mrscraper.com","sync.scraper.mrscraper.com"]}
---

# MrScraper MCP

Use the same seven data-command names as `@mrscraper/cli`:

```text
fetch  scrape  serp  status  rerun  results  result
```

Authentication belongs to the MCP connection. Never put an API key in tool
arguments, logs, or chat. CLI setup commands such as `login`, `logout`, `init`,
and `setup skills` are not MCP tools.

## Route requests

- Known URL and need readable page content, HTML, or a page document: `fetch`.
- Known URL and need selected fields, records, listings, or structured JSON:
  `scrape`.
- Search topic or question with no known URL: `serp`.
- Subscription quota or domain request outcomes: `status`.
- Existing saved AI/manual scraper: `rerun`.
- Browse or retrieve stored runs: `results` or `result`.

When “scrape this page” is ambiguous, infer from the requested output. Content
to read or summarize means `fetch`; requested fields or records means `scrape`.

## Fetch page content

Call `fetch` with a URL. Markdown is the default; use `format="html"` for raw
HTML or `format="json"` for title, description, language, text, links, and
images.

Start with `unblock="auto"`. It uses a direct request first and escalates to
browser rendering when the response looks blocked. Use `always` for known
dynamic/challenge pages. Add only the controls needed by the target:

- `geo`: ISO country code;
- `wait_for`: CSS selector, not a duration;
- `homepage`: establish site cookies from the home page first;
- `block_resources`: reduce non-essential browser traffic;
- `retries` and `token_cap`: bound retry work; and
- `timeout`: page-load timeout in seconds.

Do not claim that rendering supports clicks, form entry, login, or an
interactive browser session.

## Extract structured data

Call `scrape` with `prompt`, `schema`, or both. The schema is the JSON Schema
object itself, not a local filepath.

Use:

- `general` for one detail page or a normal extraction;
- `listing` for repeated records and bounded pagination; or
- `map` to discover URLs within one known site.

For listing mode, choose the smallest practical `max_pages`; it can take
several minutes. Keep waiting on the original request rather than submitting a
duplicate. For map mode, bound `max_depth`, `max_pages`, and `limit`, and use
include/exclude patterns only when the requested site scope is clear. Map does
not accept a schema.

Structured scrape supports `proxy_country`. It does not accept fetch-only
rendering, selector, homepage, resource, retry, token-cap, or timeout controls.
When no AI extraction option is supplied, `scrape` returns fetch-style HTML;
use `fetch` directly for page content.

## Discover pages with Google

Call `serp` with a plain query or full Google search URL. Parsed JSON is the
default. Set `format="html"` only when the user needs the raw result page.

Use `region` and `language` together when locale matters, `page` for requested
coverage, and `render_js=true` only for dynamic features such as AI Overview.
After discovery, select relevant results instead of fetching every URL by
default, then use `fetch` or `scrape` as appropriate.

## Review status

Call `status` without a domain for subscription, quota, usage, rate-limit, and
renewal information. Add `domain` for stored MrScraper request outcomes.

The `from` and `to` fields accept ISO 8601 timestamps, `now`, or durations such
as `30m`, `24h`, and `7d`. Optional domain filters are `action` and
`api_token_name`. Domain outcomes are not SEO, traffic, audience, or market
analytics.

## Rerun saved work

For one URL, call `rerun` with:

```json
{
  "target": "https://example.com/product",
  "type": "ai",
  "scraper_id": "SCRAPER_UUID"
}
```

For bulk work, set `bulk=true`, pass the scraper as `id`, and supply `target`
as an array or comma/newline-separated string. `type` is `ai` or `manual`.
Map controls apply only to AI reruns.

Before the first manual rerun in a conversation, show the user the following
warning once and wait for acknowledgment:

> Scraping login-protected pages carries serious legal and compliance risks.
> Many websites explicitly prohibit automated access in their Terms of Service,
> and bypassing authentication to scrape content may expose you to legal action
> including lawsuits, account termination, and financial penalties. By
> proceeding on scraping login-protected pages, you confirm that you have read
> and understood the target website's Terms of Service, and you fully accept all
> legal, financial, and ethical responsibility for your actions.

Do not repeat the warning after the user accepts it in the same conversation.

## Inspect stored results

Use `results` for pagination, sorting, search, and optional date filters. Use
`result` with `result_id` for one full stored row. These are persistent
MrScraper results.

## Handle failures safely

- Check `error` and `status_code` before trusting a response.
- For 401, repair the MCP connector credential outside the tool call.
- For blocked or incomplete fetches, use `unblock="always"` before adding geo,
  homepage, or selector controls.
- For incorrect extraction, tighten the prompt or schema.
- For incomplete listings, verify `agent="listing"` and a sufficient but
  bounded `max_pages`.
- For noisy SERPs, improve the query before requesting more pages.
- Do not invent monitoring, scheduling, manual-scraper creation, local-file
  parsing, or interactive browser features.

Access only data the user is authorized to retrieve and respect applicable
site terms, privacy rules, copyright, and computer-access laws.
