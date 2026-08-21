# MrScraper MCP

MrScraper MCP exposes the MrScraper web-data service through the
[Model Context Protocol](https://modelcontextprotocol.io). Agents can fetch a
known page, extract structured records, search Google, inspect account usage,
rerun saved scrapers, and read stored results.

The server exposes seven web-data tools:

```text
fetch  scrape  serp  status  rerun  results  result
```

## Deployment options

| Option      | Endpoint or command                           | Best for                                |
| ----------- | --------------------------------------------- | --------------------------------------- |
| Hosted      | `https://mcp.mrscraper.com/mcp`               | A managed Streamable HTTP connection    |
| Local HTTP  | `TRANSPORT=http npx -y @mrscraper/mcp@latest` | A self-managed HTTP service             |
| Local stdio | `npx -y @mrscraper/mcp@latest`                | MCP clients that launch a local process |

The hosted server signs you in through your browser with OAuth 2.1, so there
is no key to copy. Self-hosted and stdio setups use a MrScraper API key from
[app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens), which the
hosted server also still accepts.

## Connect to the hosted server

Point your MCP client at `https://mcp.mrscraper.com/mcp` with no credential.
The server answers with an OAuth challenge, your client opens a browser, and
you approve the connection on `app.mrscraper.com`.

```sh
claude mcp add --transport http --scope user \
  mrscraper https://mcp.mrscraper.com/mcp
```

For clients configured by file, omit the `headers` block entirely:

```json
{
  "mcpServers": {
    "mrscraper": {
      "type": "http",
      "url": "https://mcp.mrscraper.com/mcp"
    }
  }
}
```

Use exactly this URL, including the `/mcp` path. It is the resource identifier
access tokens are issued for, and a token minted for a different spelling of
the address will be refused.

### What you are approving

| Scope          | Grants                                                    |
| -------------- | --------------------------------------------------------- |
| `scrape:read`  | `fetch`, `serp`, `results`, `result`                      |
| `scrape:write` | `scrape`, `rerun`: creating scrapers and running them     |
| `account:read` | `status`: subscription plan, quota, and request analytics |

A tool called without its scope is refused with `403 insufficient_scope`, and
your client will offer to grant the missing permission.

Disconnect it later under Connected applications in your MrScraper account.
Disconnecting revokes the refresh tokens immediately; an access token already
issued stops working within the hour.

### Connect with an API key instead

An API key still works as a bearer token, which is what self-hosted
deployments and non-OAuth clients use:

```json
{
  "mcpServers": {
    "mrscraper": {
      "type": "http",
      "url": "https://mcp.mrscraper.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

Use your client's environment-variable or secret-storage feature so the key
stays out of project files. An API key carries your full account authority, so
no scope is enforced against it.

#### Codex

```sh
export MRSCRAPER_API_KEY="YOUR_MRSCRAPER_API_KEY"
codex mcp add mrscraper \
  --url https://mcp.mrscraper.com/mcp \
  --bearer-token-env-var MRSCRAPER_API_KEY
```

Start Codex from an environment containing `MRSCRAPER_API_KEY`. Codex stores
the environment-variable name in its MCP configuration.

#### Claude Code

```sh
claude mcp add \
  --transport http \
  --scope user \
  --header "Authorization: Bearer YOUR_MRSCRAPER_API_KEY" \
  mrscraper https://mcp.mrscraper.com/mcp
```

Claude Code also supports project and local scopes. Choose the scope that
matches how broadly the connection should be available.

## Copyable agent setup prompt

```text
Connect MrScraper MCP to this agent. Detect the current MCP client and configure a Streamable HTTP server named mrscraper at https://mcp.mrscraper.com/mcp with no credential. The server uses OAuth 2.1, so the client will open a browser to sign in. If the client cannot do OAuth, fall back to a MrScraper API key from https://app.mrscraper.com/api-tokens stored through the client's environment-variable or secret-storage mechanism and sent as Authorization: Bearer <key>. Reload the MCP client when required, then list the tools and confirm that fetch, scrape, serp, status, rerun, results, and result are available.
```

## Choosing a tool

| Tool      | Choose it when                                                                    |
| --------- | --------------------------------------------------------------------------------- |
| `fetch`   | You already have a URL and need the page response from Web Unblocker.             |
| `scrape`  | You already have a URL and need defined fields, records, listings, or a site map. |
| `serp`    | You are starting from a Google query or Google search URL.                        |
| `status`  | You need subscription, quota, token usage, or domain request outcomes.            |
| `rerun`   | You have a saved AI or manual scraper ID and want to run it again.                |
| `results` | You need a paginated or filtered list of stored results.                          |
| `result`  | You know one result ID and need its complete stored record.                       |

A common discovery workflow is `serp` → `fetch` or `scrape`. A saved
scraper workflow is `scrape` → `rerun` → `result`.

## Response contract

API-backed tools return a response envelope in both MCP `structuredContent`
and a formatted JSON text block:

```json
{
  "status_code": 200,
  "data": {},
  "headers": {
    "content-type": "application/json"
  }
}
```

| Field         | Type                          | Meaning                                                                              |
| ------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `status_code` | number or `null`              | Upstream HTTP status, or `null` when a request ends before an HTTP response arrives. |
| `data`        | JSON value, string, or `null` | Parsed JSON or response text supplied by the MrScraper service.                      |
| `headers`     | object                        | Response headers with credential-bearing headers filtered out.                       |
| `error`       | string, when present          | Request failure summary.                                                             |

An API failure keeps this envelope in `structuredContent` and sets the MCP
result's `isError` flag. Input-contract errors are returned as MCP tool
errors. Parsed credential metadata and generated curl credentials are
sanitized while extracted scraper data remains available to the caller.

## Tool reference

### `fetch`

`fetch` calls the Web Unblocker endpoint once:

```text
GET https://api.mrscraper.com/
```

Start with the URL alone:

```json
{
  "url": "https://example.com/products"
}
```

Use browser rendering for JavaScript-driven content:

```json
{
  "url": "https://example.com/products",
  "browser_rendering": true,
  "wait_for_selector": ".product-card",
  "geo_code": "ID",
  "timeout": 45
}
```

| Input               | Required | Default | API mapping              | Purpose                                                                              |
| ------------------- | -------- | ------- | ------------------------ | ------------------------------------------------------------------------------------ |
| `url`               | Yes      | -       | Query `url`              | Target page URL.                                                                     |
| `browser_rendering` | No       | `false` | Query `browserRendering` | Executes page JavaScript in a browser.                                               |
| `geo_code`          | No       | omitted | Query `geoCode`          | Selects proxy-country routing.                                                       |
| `wait_for_selector` | No       | omitted | Query `waitForSelector`  | Waits for a CSS selector together with `browser_rendering: true`.                    |
| `home_page`         | No       | `false` | Query `homePage`         | Visits the site root before the target URL.                                          |
| `block_resources`   | No       | `false` | Query `blockResources`   | Applies resource blocking during page loading.                                       |
| `max_retries`       | No       | `3`     | Query `maxRetries`       | Sets the Web Unblocker retry limit; zero is accepted.                                |
| `token_cap`         | No       | omitted | Query `tokenCap`         | Sets the retry token budget.                                                         |
| `timeout`           | No       | `30`    | Query `timeout`          | Sets the page-load deadline in seconds; transport receives an additional 30 seconds. |

The response body's value is returned in `data`, commonly as HTML.

### `scrape`

`scrape` creates an AI scraper through:

```text
POST https://api.app.mrscraper.com/api/v1/scrapers-ai
```

Choose an agent based on the extraction shape:

| Agent     | Designed for                          | Available inputs                                                          |
| --------- | ------------------------------------- | ------------------------------------------------------------------------- |
| `general` | Defined fields from a page            | `prompt`, `schema_prompt`, `proxy_country`                                |
| `listing` | Repeated records across listing pages | `prompt`, `schema_prompt`, `proxy_country`, `max_pages`                   |
| `map`     | URL discovery across a site           | `max_depth`, `max_pages`, `limit`, `include_patterns`, `exclude_patterns` |

General extraction:

```json
{
  "url": "https://example.com/product",
  "agent": "general",
  "prompt": "Extract the product name, price, availability, and image URLs"
}
```

Listing extraction:

```json
{
  "url": "https://example.com/products",
  "agent": "listing",
  "prompt": "Extract every product name, price, and detail URL",
  "max_pages": 5
}
```

Site map:

```json
{
  "url": "https://example.com",
  "agent": "map",
  "max_depth": 2,
  "max_pages": 50,
  "limit": 1000,
  "include_patterns": "/products/",
  "exclude_patterns": "/cart/"
}
```

Best-effort schema guidance:

```json
{
  "url": "https://example.com/product",
  "prompt": "Extract the product",
  "schema_prompt": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "price": { "type": "number" }
    },
    "required": ["name", "price"]
  }
}
```

`schema_prompt` is appended to the natural-language instruction. Treat it as
shape guidance and validate returned data in the consuming application when
strict conformance is required.

| Input              | Required        | Default         | Request mapping        | Purpose                                                     |
| ------------------ | --------------- | --------------- | ---------------------- | ----------------------------------------------------------- |
| `url`              | Yes             | -               | Body `url`             | Target URL for every agent.                                 |
| `prompt`           | General/listing | -               | Body `message`         | Natural-language extraction instructions.                   |
| `schema_prompt`    | No              | omitted         | Appended to `message`  | Best-effort JSON Schema shape guidance for general/listing. |
| `agent`            | No              | `general`       | Body `agent`           | Selects `general`, `listing`, or `map`.                     |
| `proxy_country`    | No              | omitted         | Body `proxyCountry`    | Proxy country for general/listing.                          |
| `max_pages`        | No              | service default | Body `maxPages`        | Page bound for listing/map.                                 |
| `max_depth`        | No              | service default | Body `maxDepth`        | Link-depth bound for map.                                   |
| `limit`            | No              | service default | Body `limit`           | URL-result bound for map.                                   |
| `include_patterns` | No              | service default | Body `includePatterns` | URL inclusion expression for map.                           |
| `exclude_patterns` | No              | service default | Body `excludePatterns` | URL exclusion expression for map.                           |

General and listing send `url`, `message`, and `agent`, plus the supplied
agent inputs. Map sends `url`, `agent`, and only the supplied crawl inputs.

#### Reproduce a scrape with `rerun`

Every successful `scrape` creates a saved AI scraper configuration by default.
Its response run object contains `scraperId`. Pass that UUID to `rerun` as
`scraper_id` to apply the same saved extraction configuration to the original
URL or another URL without rebuilding the prompt and agent settings:

```json
{
  "target": "https://example.com/product-2",
  "type": "ai",
  "scraper_id": "scraper-uuid"
}
```

This makes the scraper configuration reproducible, but it does not guarantee
identical extracted values when the page or model behavior changes.

`rerun` also supports dashboard-built manual workflows and asynchronous bulk
jobs across multiple target URLs. See the full [`rerun`](#rerun) section below
for the available modes and result-tracking workflow.

### `serp`

`serp` calls the synchronous Google endpoint:

```text
POST https://sync.scraper.mrscraper.com/api/google/serp/v2/sync
```

Search from a query:

```json
{
  "query_or_url": "iphone 17",
  "region": "id",
  "language": "id",
  "page": 2,
  "format": "json"
}
```

A Google search URL can supply the query, locale, and page:

```json
{
  "query_or_url": "https://www.google.com/search?q=iphone+17&gl=us&hl=en&start=20"
}
```

The server derives `query` from `q`, `region` from `gl`, `language`
from `hl`, and a one-based page number from `start). Explicit tool inputs
take priority over URL-derived values.

| Input            | Required | Default              | Request mapping        | Purpose                                      |
| ---------------- | -------- | -------------------- | ---------------------- | -------------------------------------------- |
| `query_or_url`   | Yes      | -                    | Body `query`           | Google query or Google search URL.           |
| `region`         | No       | URL value or omitted | Body `region`          | Result country.                              |
| `language`       | No       | URL value or omitted | Body `language`        | Result language.                             |
| `page`           | No       | URL value or omitted | Body `page`            | One-based result page.                       |
| `format`         | No       | `json`               | Body `format`          | Selects parsed JSON or result-page HTML.     |
| `render_js`      | No       | `false`              | Body `renderJs`        | Waits for JavaScript-rendered SERP features. |
| `raw`            | No       | `false`              | Body `format=html`     | Compatibility alias for HTML output.         |
| `client_timeout` | No       | `120`                | Local request deadline | Sets the upstream HTTP timeout in seconds.   |

### `status`

`status` always reads account data from:

```text
GET https://api.app.mrscraper.com/api/v1/subscription-accounts
```

With `domain`, it also reads request-outcome analytics from:

```text
GET https://api.app.mrscraper.com/api/v1/analytic/statuses
```

```json
{
  "domain": "https://www.example.com/products",
  "from": "7d",
  "to": "now",
  "action": "fetch",
  "api_token_name": "production"
}
```

| Input            | Required | Default      | Purpose                                                                                     |
| ---------------- | -------- | ------------ | ------------------------------------------------------------------------------------------- |
| `domain`         | No       | omitted      | Adds request-outcome analytics for a hostname or URL.                                       |
| `from`           | No       | `24h`        | Range start as ISO 8601, `now`, or a relative duration such as `30m`, `24h`, `7d`, or `2w`. |
| `to`             | No       | `now`        | Range end using the same date syntax.                                                       |
| `action`         | No       | empty filter | Filters analytics by exact action.                                                          |
| `api_token_name` | No       | empty filter | Filters analytics by API-token name.                                                        |

Successful output is a normalized account and analytics summary:

```json
{
  "kind": "mrscraper-cli-status-summary",
  "source_endpoints": ["/subscription-accounts", "/analytic/statuses"],
  "status_code": 200,
  "data": {
    "account": {
      "subscription_status": "active",
      "enterprise": false,
      "token_usage": 250,
      "token_limit": 1000,
      "token_remaining": 750,
      "usage_percent": 25,
      "rate_limit": 10,
      "rate_ttl": 60,
      "auto_renew": true,
      "ends_at": null,
      "user": {
        "name": "Ada",
        "email": "ada@example.com",
        "verified": true
      }
    },
    "analytics": {
      "domain": "www.example.com",
      "from": "2026-08-11 00:00:00 UTC",
      "to": "2026-08-18 00:00:00 UTC"
    }
  }
}
```

The summary calculates `token_remaining` and `usage_percent`, normalizes a
URL to its hostname, and records the source endpoints used for the response.

### `rerun`

`type` and `bulk` describe different parts of the request:

- Set `type` to `ai` for a saved AI scraper created by the `scrape` tool.
- Set `type` to `manual` for a saved step-based workflow created in the
  MrScraper dashboard. MCP reruns that workflow but does not create it.
- Leave `bulk` as `false` for one URL. Set it to `true` to apply the same saved
  configuration to a comma- or newline-separated URL list in one bulk request.

Manual reruns can be single or bulk, and bulk reruns can use either scraper
type. Bulk describes the number of targets; manual describes how the saved
scraper was built.

Bulk mode submits one asynchronous backend job; MCP does not repeat the
single-URL tool call locally. Save `data.data.bulkResultId` from the response
and pass it to `result` as `result_id` until the stored result is finished.

`rerun` routes one tool contract to four saved-scraper endpoints:

| Mode          | Endpoint                           | ID input     | Target format                | Crawl controls      |
| ------------- | ---------------------------------- | ------------ | ---------------------------- | ------------------- |
| Single AI     | `POST /scrapers-ai-rerun`          | `scraper_id` | One URL                      | Available           |
| Bulk AI       | `POST /scrapers-ai-rerun/bulk`     | `id`         | Comma/newline-separated URLs | Saved configuration |
| Single manual | `POST /scrapers-manual-rerun`      | `scraper_id` | One URL                      | Saved configuration |
| Bulk manual   | `POST /scrapers-manual-rerun/bulk` | `id`         | Comma/newline-separated URLs | Saved configuration |

Single AI rerun:

```json
{
  "target": "https://example.com/products",
  "type": "ai",
  "scraper_id": "scraper-uuid",
  "max_depth": 2,
  "max_pages": 50,
  "limit": 1000,
  "include_patterns": "/products/",
  "exclude_patterns": "/cart/"
}
```

Bulk manual rerun:

```json
{
  "target": "https://example.com/a,https://example.com/b\nhttps://example.com/c",
  "type": "manual",
  "bulk": true,
  "id": "scraper-uuid"
}
```

| Input              | Required    | Default      | Purpose                                                         |
| ------------------ | ----------- | ------------ | --------------------------------------------------------------- |
| `target`           | Yes         | -            | One URL, or a comma/newline-separated URL string for bulk mode. |
| `type`             | Yes         | -            | Selects `ai` or `manual`.                                       |
| `bulk`             | No          | `false`      | Selects a bulk endpoint.                                        |
| `scraper_id`       | Single mode | -            | Saved scraper UUID for one URL.                                 |
| `id`               | Bulk mode   | -            | Saved scraper UUID for the bulk URL list.                       |
| `max_depth`        | Single AI   | `2`          | Crawl depth.                                                    |
| `max_pages`        | Single AI   | `50`         | Page bound.                                                     |
| `limit`            | Single AI   | `1000`       | Result bound.                                                   |
| `include_patterns` | Single AI   | empty string | URL inclusion expression.                                       |
| `exclude_patterns` | Single AI   | empty string | URL exclusion expression.                                       |

Manual reruns carry a compliance acknowledgment in the MCP server
instructions. MCP clients should present that acknowledgment before executing
the manual mode.

### `results`

`results` reads the stored result collection:

```text
GET https://api.app.mrscraper.com/api/v1/results
```

```json
{
  "sort_field": "updatedAt",
  "sort_order": "desc",
  "page_size": 25,
  "page": 1,
  "search": "example.com",
  "date_range_column": "updatedAt",
  "start_at": "2026-08-01T00:00:00Z",
  "end_at": "2026-08-18T23:59:59Z"
}
```

| Input               | Required | Default     | Query mapping     | Purpose                                                       |
| ------------------- | -------- | ----------- | ----------------- | ------------------------------------------------------------- |
| `sort_field`        | No       | `updatedAt` | `sortField`       | Field used by the results API for sorting.                    |
| `sort_order`        | No       | `desc`      | `sortOrder`       | Case-insensitive `asc` or `desc`; sent upstream in uppercase. |
| `page_size`         | No       | `10`        | `pageSize`        | Number of rows per page.                                      |
| `page`              | No       | `1`         | `page`            | One-based page index.                                         |
| `search`            | No       | omitted     | `search`          | Free-text result filter.                                      |
| `date_range_column` | No       | omitted     | `dateRangeColumn` | Column used by the date range.                                |
| `start_at`          | No       | omitted     | `startAt`         | Inclusive range start.                                        |
| `end_at`            | No       | omitted     | `endAt`           | Inclusive range end.                                          |

### `result`

`result` reads one stored result:

```text
GET https://api.app.mrscraper.com/api/v1/results/{result_id}
```

```json
{
  "result_id": "result-uuid"
}
```

| Input       | Required | Purpose                       |
| ----------- | -------- | ----------------------------- |
| `result_id` | Yes      | Stored MrScraper result UUID. |

## Run the server locally

Node.js 20 or newer is required.

```sh
git clone https://github.com/mrscraper-com/mrscraper-mcp.git
cd mrscraper-mcp
npm ci
npm run build
```

### Streamable HTTP

```sh
TRANSPORT=http npm start
```

The default endpoint is `http://127.0.0.1:8000/mcp`.

```json
{
  "mcpServers": {
    "mrscraper": {
      "type": "http",
      "url": "http://127.0.0.1:8000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

### stdio

```json
{
  "mcpServers": {
    "mrscraper": {
      "command": "npx",
      "args": ["-y", "@mrscraper/mcp@latest"],
      "env": {
        "MRSCRAPER_API_KEY": "YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

Stdio credential precedence is `MRSCRAPER_API_KEY`, then
`MRSCRAPER_API_TOKEN`.

## Authentication and security

| Transport            | Credential                                                                    |
| -------------------- | ----------------------------------------------------------------------------- |
| Hosted or local HTTP | An OAuth 2.1 access token, or a MrScraper API key, as `Authorization: Bearer` |
| Local stdio          | `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`                               |

The HTTP transport is an OAuth 2.1 resource server. It publishes RFC 9728
protected resource metadata at `/.well-known/oauth-protected-resource` (and at
the `/mcp` path-suffixed variant), and an unauthenticated request is answered
with `401` and a `WWW-Authenticate` header naming that document, which is how a
client discovers where to send you to sign in.

Access tokens are verified locally against the authorization server's published
JWKS. A token must name this server in its `aud` claim, so a token issued for
another MrScraper surface cannot be replayed here.

API keys are validated against the MrScraper account endpoint before tool
execution. Either way, each HTTP request uses its own caller's credential;
server environment credentials are never used on the HTTP transport.

The server filters credential-bearing response headers. Parsed JSON credential
metadata and credentials embedded in generated curl commands are redacted.
Scraper run extraction values remain available in `data`.

Browser-origin requests are accepted from trusted local origins, from
`claude.ai` and `chatgpt.com`, and from exact origins configured through
`MRSCRAPER_ALLOWED_ORIGINS`. Service-to-service MCP clients typically connect
without an `Origin` header. The discovery documents are served ahead of origin
checks, since any client must be able to read them before it has credentials.

## Interactive widgets

Tool results that suit a visual answer carry a UI resource: `serp` renders a
result list, `scrape`/`results`/`result` render a record table, and `status`
renders a quota card. Hosts that do not support MCP Apps ignore them and show
the JSON as before.

Each widget is a self-contained document with its script and styles inlined,
because strict host CSP blocks anything external. Each one declares an empty
network allowlist, since it only renders data the tool already returned. Sources live
in `ui/`; `npm run build:widgets` bundles them into
`src/widgets/bundles.generated.ts`, which `npm run build` does for you.

## Docker

```sh
docker build -f docker/Dockerfile -t mrscraper-mcp .
docker run --rm -p 8000:8000 mrscraper-mcp
```

The image binds to `0.0.0.0`. Apply the network controls appropriate for the
deployment and keep bearer authentication enabled.

## Environment variables

| Variable                         | Default                           | Purpose                                                          |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `TRANSPORT`                      | `stdio`                           | Selects `stdio` or `http`.                                       |
| `HOST`                           | `127.0.0.1`                       | HTTP bind address; the Docker image uses `0.0.0.0`.              |
| `PORT`                           | `8000`                            | HTTP listen port.                                                |
| `MRSCRAPER_API_KEY`              | -                                 | Primary stdio credential.                                        |
| `MRSCRAPER_API_TOKEN`            | -                                 | Legacy stdio credential alias.                                   |
| `MRSCRAPER_HTTP_AUTH`            | `1`                               | Enables HTTP bearer verification.                                |
| `MRSCRAPER_OAUTH`                | `1`                               | Accepts OAuth 2.1 access tokens alongside API keys.              |
| `MRSCRAPER_MCP_PUBLIC_URL`       | `https://mcp.mrscraper.com`       | Public origin; `<origin>/mcp` is the required token audience.    |
| `MRSCRAPER_OAUTH_ISSUER`         | `https://api.app.mrscraper.com`   | Authorization server issuer.                                     |
| `MRSCRAPER_OAUTH_JWKS_URL`       | `<issuer>/.well-known/jwks.json`  | Key set used to verify access tokens.                            |
| `MRSCRAPER_ALLOWED_ORIGINS`      | -                                 | Comma-separated browser origins allowed to call the HTTP server. |
| `MRSCRAPER_API_BASE_URL`         | MrScraper platform API            | Platform endpoint override for development and testing.          |
| `MRSCRAPER_FETCH_BASE_URL`       | MrScraper Web Unblocker           | Fetch endpoint override.                                         |
| `MRSCRAPER_SYNC_BASE_URL`        | MrScraper synchronous scraper API | SERP endpoint override.                                          |
| `MRSCRAPER_LOG_HTTP_PAYLOAD`     | off                               | Enables trusted-environment request-body diagnostics.            |
| `MRSCRAPER_LOG_HTTP_PAYLOAD_MAX` | `8192`                            | Maximum diagnostic payload length.                               |

## Troubleshooting

- **Connection error:** Confirm the server URL ends in `/mcp` and reload the
  MCP client after configuration changes.
- **401 Unauthorized:** For OAuth, reconnect the server so your client runs the
  sign-in flow again. For an API key, confirm the bearer key for HTTP or the
  environment key for stdio.
- **403 insufficient_scope:** The token lacks a scope the tool needs. Reconnect
  and approve the additional permission.
- **Signing in succeeds but tools fail:** Confirm the server URL is exactly
  `https://mcp.mrscraper.com/mcp`; the token audience is bound to it.
- **403 Forbidden Origin:** Add the exact browser origin to
  `MRSCRAPER_ALLOWED_ORIGINS`.
- **Tool input error:** Compare the call with the tool's parameter table and
  the selected scrape or rerun mode.
- **Upstream timeout:** Increase `fetch.timeout` or `serp.client_timeout`
  when the target requires a longer request window.
- **New tools are missing:** Start a new client session and inspect
  `tools/list` for all seven names.

## Development

```sh
npm ci
npm run format:check
npm run lint
npm test
npm run build
npm pack --dry-run
```

Smoke-test a running HTTP server:

```sh
npm run test:mcp -- \
  --target http://127.0.0.1:8000/mcp \
  --token "$MRSCRAPER_API_KEY"
```

`npm run test:e2e` exercises all seven tools against the live MrScraper
service and creates stored scraper results.

## License

MIT. See [LICENSE](./LICENSE).
