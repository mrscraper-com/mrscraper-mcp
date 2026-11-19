# MrScraper MCP Server for Web Scraping and Web Search

MrScraper MCP is the official [MrScraper](https://mrscraper.com) server for the
[Model Context Protocol](https://modelcontextprotocol.io). It connects AI
assistants to page content, data extraction, and web search through six tools
that match the [MrScraper CLI](https://github.com/mrscraper-com/cli), plus an
account check. Retrieve a page with `scrapeHtml`, `scrapeMarkdown`, or
`getScreenshot`, extract data with `scrapeJson` or `scrapeBrand`, discover
pages with `webSearch`, and check your plan and token usage with `status`.

Use the hosted server with OAuth sign-in, or run the open-source server locally
with the [`@mrscraper/mcp` npm package](https://www.npmjs.com/package/@mrscraper/mcp).
See the [MrScraper MCP documentation](https://docs.mrscraper.com/docs/getting-started/mcp-server)
for setup instructions and client configurations.

The server exposes seven tools:

```text
scrapeHtml  scrapeMarkdown  getScreenshot  scrapeBrand  scrapeJson  webSearch  status
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

ChatGPT and Codex get the page tools with fewer options, on `/mcp` and on
`https://mcp.mrscraper.com/mcp/chatgpt` (see
[ChatGPT and Codex endpoint](#chatgpt-and-codex-endpoint)).

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

| Scope          | Grants                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| `scrape:read`  | `webSearch`                                                                  |
| `scrape:write` | `scrapeHtml`, `scrapeMarkdown`, `getScreenshot`, `scrapeBrand`, `scrapeJson` |
| `account:read` | `status`                                                                     |

A tool called without its scope is refused with `403 insufficient_scope`, and
your client will offer to grant the missing permission.

The page tools submit scraping jobs to the backend with `GET /`, which requires
`scrape:write`. Connections authorized before this scope was advertised need to
authorize again and grant it; `scrape:read` alone does not grant write access.

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
Connect MrScraper MCP to this agent. Detect the current MCP client and configure a Streamable HTTP server named mrscraper at https://mcp.mrscraper.com/mcp with no credential. The server uses OAuth 2.1, so the client will open a browser to sign in. If the client cannot do OAuth, fall back to a MrScraper API key from https://app.mrscraper.com/api-tokens stored through the client's environment-variable or secret-storage mechanism and sent as Authorization: Bearer <key>. Reload the MCP client when required, then list the tools and confirm that scrapeHtml, scrapeMarkdown, getScreenshot, scrapeBrand, scrapeJson, webSearch, and status are the only available tools.
```

## Choosing a tool

| Tool             | Choose it when                                                    |
| ---------------- | ----------------------------------------------------------------- |
| `scrapeHtml`     | You have a page URL and need its raw HTML.                        |
| `scrapeMarkdown` | You have a page URL and need its content as Markdown.             |
| `getScreenshot`  | You need an image of a page, full length or the top viewport.     |
| `scrapeJson`     | You need specific data from a page as JSON.                       |
| `scrapeBrand`    | You need a website's colors, typography, logos, and social links. |
| `webSearch`      | You have a search query and need ranked results with links.       |
| `status`         | You need the account's plan, token usage, or remaining tokens.    |

A discovery workflow is `webSearch` → `scrapeMarkdown` or `scrapeJson`. The six
web tools advertise `readOnlyHint: true`, `openWorldHint: true`, and
`destructiveHint: false`; `status` is read-only and not open-world.
Authentication comes from the MCP connection; no tool takes an API token
argument.

### Migration from 0.4

| 0.4 call                             | 0.5 replacement                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `scraperAPI`                         | `scrapeHtml`                                                                                           |
| `scraperAPI` with `markdown: true`   | `scrapeMarkdown`; `html: true` also returns the HTML                                                   |
| `scraperAPI` with `screenshot: true` | `getScreenshot`; `screenshot` is `"full"` or `"top"`                                                   |
| `webSearch`                          | `webSearch`; `url` becomes `query`, `region` becomes `country`, and `num_results` becomes `numResults` |
| `status`                             | `status`, unchanged                                                                                    |

Options use the Scraper API's camelCase names: `geo_code` becomes `geoCode`,
and likewise `proxyCountry`, `browserRendering`, `waitForSelector`,
`blockResources`, and `maxRetries`. `use_proxy`, `home_page`, `bypass_proxy`,
`cookie_jar`, `headers`, `token_cap`, `stream`, `discard_token_secret`, and the
`webSearch` `timeout` are removed. Restart the server and reconnect the MCP
client after updating so it refreshes `tools/list`.

### Changes in 0.5.0

`scraperAPI` is replaced by five tools that match the MrScraper CLI commands
`scrape-html`, `scrape-markdown`, `get-screenshot`, `scrape-brand`, and
`scrape-json`, and `webSearch` follows `web-search`: each sends a `GET`
request with fixed values for the parameters that define the tool, and
`scrapeJson` switches to `POST` only for a prompt too long for the URL. Page tools
default `geoCode` and `proxyCountry` to `us` again, `timeout` to 300 seconds,
and send `super=false` unless enabled; `maxRetries` is unset, which means no
limit. Arguments outside a tool's schema are rejected instead of ignored. A
`200` response with `success: false`, a non-empty `error`, or a failed brand
job now sets `isError: true`. API keys travel only in the `Authorization` and
`x-api-token` headers, no longer in a `token` query parameter.

### Changes in 0.4.2

`scraperAPI` now loads pages with `GET`: `url`, `maxRetries`, and `tokenCap`
moved from the JSON body to the query string, and the request has no body. The
API replays a request body to the target page, so sites used to receive a POST
carrying that body, and many refused it. With `html: false`, HTML that the API
still returns is dropped. `geo_code` no longer defaults to `"US"`: when it is
omitted, the Scraper API chooses the country.

### Changes in 0.4.1

On `/mcp`, ChatGPT and Codex sign-ins now get the same `scraperAPI` as
`/mcp/chatgpt`. OpenAI's plugin directory doesn't allow an existing plugin to
move to another MCP URL, so the MrScraper plugin keeps using `/mcp`. Other
clients and API keys still get the full set of options.

### Changes in 0.4.0

The HTTP server adds a second endpoint, `/mcp/chatgpt`, for the MrScraper
plugin in ChatGPT and Codex. It is described under
[ChatGPT and Codex endpoint](#chatgpt-and-codex-endpoint). `/mcp` is unchanged.

### Changes in 0.3.0

`webSearch` now calls MrScraper's web search action on the Scraper API host
and returns a ranked list of results. It gained `num_results`, and `region`
must be a two-letter country code. The 0.2 options `raw`, `format`,
`language`, `page`, and `render_js` are no longer supported: calls that still
send them succeed, and the options are ignored. `MRSCRAPER_SYNC_BASE_URL` is
gone; `MRSCRAPER_FETCH_BASE_URL` now covers both web tools.

## Tool reference

Tool inputs use the Scraper API's query parameter names and the
[MrScraper CLI](https://github.com/mrscraper-com/cli)'s defaults. Every web
tool calls `https://api.mrscraper.com/` with its options in the query string
and no body, since the API replays a request body to the target page.
Arguments a tool does not list, such as `tokenCap`, `record`, or `action`, are
rejected, and `null` for an optional input counts as omitted. API keys are sent
in the `Authorization` and `x-api-token` headers; OAuth access tokens only in
`Authorization`.

### Page options

`scrapeHtml`, `scrapeMarkdown`, `getScreenshot`, and `scrapeJson` share these
inputs:

| Input          | Default              | Purpose                                                                                                 |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| `url`          | required             | Absolute HTTP(S) page URL.                                                                              |
| `super`        | `false`              | Route the request through real devices. The API defaults to `true`, so `false` is always sent.          |
| `waitUntil`    | `"domcontentloaded"` | Navigation event that completes loading: `domcontentloaded`, `load`, `networkidle0`, or `networkidle2`. |
| `timeout`      | `300`                | Page load timeout, 1–300 seconds; the HTTP request allows 30 seconds more.                              |
| `geoCode`      | `"us"`               | Two-letter country to load the page from; sent in lowercase.                                            |
| `proxyCountry` | `"us"`               | Two-letter country of the proxy server; sent in lowercase.                                              |
| `proxy`        | omitted              | Your own proxy, such as `http://user:pass@host:port`.                                                   |
| `maxRetries`   | omitted              | Nonnegative retry limit; omitted means no limit.                                                        |
| `saveResult`   | `false`              | Save the result to the dashboard Result tab.                                                            |

`scrapeHtml`, `scrapeMarkdown`, and `getScreenshot` also take the loading
controls:

| Input             | Default | Purpose                                    |
| ----------------- | ------- | ------------------------------------------ |
| `waitForSelector` | omitted | CSS selector to wait for before returning. |
| `blockResources`  | `false` | Block images, fonts, and stylesheets.      |
| `returnCookie`    | `false` | Include the browser session cookies.       |

### `scrapeHtml`

Returns the page's raw HTML. Sends `html=true`, `markdown=false`, and
`screenshot=false`, plus `browserRendering` (default `false`) to render the
page in Chromium.

```json
{ "url": "https://www.scrapethissite.com/pages/simple/" }
```

### `scrapeMarkdown`

Returns the page as Markdown. Sends `markdown=true` and `screenshot=false`.

| Input              | Default | Purpose                                                                                         |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| `html`             | `false` | Also return the page HTML, as JSON holding both. Sends `browserRendering=true`, which it needs. |
| `browserRendering` | `false` | Render the page in Chromium.                                                                    |

### `getScreenshot`

Returns a base64-encoded screenshot. Always sends `browserRendering=true`.

| Input        | Default  | Purpose                                                      |
| ------------ | -------- | ------------------------------------------------------------ |
| `screenshot` | `"full"` | `full` captures the entire page, `top` the visible viewport. |
| `html`       | `true`   | Include the page HTML.                                       |
| `markdown`   | `false`  | Include the page Markdown.                                   |

```json
{ "url": "https://example.com", "screenshot": "top", "html": false }
```

### `scrapeJson`

Extracts structured JSON with the `general` agent, sent as `agent=general`. It
takes the page options but not the loading controls.

| Input              | Default                                       | Purpose                                                                       |
| ------------------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| `prompt`           | `"Extract all data as complete as possible."` | Data to extract. Append `Json Schema:` and a JSON schema to shape the output. |
| `browserRendering` | `false`                                       | Render the page in Chromium.                                                  |
| `html`             | `false`                                       | Also return the page HTML.                                                    |
| `screenshot`       | `false`                                       | Also return a base64 screenshot.                                              |

The API refuses request URLs over about 8 KB, so when the encoded URL exceeds
8,000 characters, `scrapeJson` sends a `POST` with `url`, `prompt`, and `agent`
in a JSON body and the other options in the query string. A failed run
returns `success: false` and is not billed.

```json
{
  "url": "https://www.scrapethissite.com/pages/simple/",
  "prompt": "Extract each country's name and capital. Json Schema: {\"countries\":[{\"name\":\"string\",\"capital\":\"string\"}]}"
}
```

### `scrapeBrand`

```text
GET https://api.mrscraper.com/?action=brand-scraping&url=…&bundle=none
```

Takes only `url` and returns the brand in `data.data.brand` and the job ID in
`data.data.job_id`, usually within seconds; the HTTP deadline is 120 seconds.
The `clean` and `full` bundles aren't offered, because downloading their files
needs the account's API key.

### `webSearch`

```text
GET https://api.mrscraper.com/?action=websearch&query=…&country=us&numResults=10
```

Ask for 20 results from the United Kingdom:

```json
{ "query": "running shoes", "country": "gb", "numResults": 20 }
```

| Input        | Default  | Purpose                                                    |
| ------------ | -------- | ---------------------------------------------------------- |
| `query`      | required | Search text, 1–1000 characters after trimming.             |
| `country`    | `"us"`   | Two-letter country to search from; sent in lowercase.      |
| `numResults` | `10`     | Number of results, 10 to 100. The search may return fewer. |

The HTTP deadline is 120 seconds.

### `status`

```text
GET https://api.app.mrscraper.com/api/v1/subscription-accounts
```

`status` takes no input. It returns the connected account's identity (name,
email, and verification state), subscription status, token limit, token usage,
remaining tokens, usage percentage, rate limit, auto-renewal, and renewal date.
It copies only those fields, so the API key and Stripe identifiers in the raw
account record never reach the client.

```json
{
  "kind": "mrscraper-cli-status-summary",
  "source_endpoints": ["/subscription-accounts"],
  "status_code": 200,
  "data": {
    "account": {
      "subscription_status": "active",
      "enterprise": false,
      "token_usage": 61240,
      "token_limit": 100000,
      "token_remaining": 38760,
      "usage_percent": 61.24,
      "rate_limit": 0,
      "rate_ttl": 0,
      "auto_renew": true,
      "ends_at": "2026-12-01T00:00:00.000Z",
      "user": {
        "name": "Ada",
        "email": "ada@example.com",
        "verified": true
      }
    }
  }
}
```

An OAuth connection needs the `account:read` scope for `status`.

### Response envelope

The six web tools return `status_code`, `data`, and `headers` in
`structuredContent` and as JSON text. JSON bodies are parsed; other response
bodies remain text. The `token_usage` header reports the tokens a page request
used, and `x-status-code` the target page's status. `status` returns the
summary shown above.

| Tool             | `data`                                                                        |
| ---------------- | ----------------------------------------------------------------------------- |
| `scrapeHtml`     | The HTML as text (`text/html`).                                               |
| `scrapeMarkdown` | The Markdown as text (`text/markdown`); with `html: true`, JSON holding both. |
| `getScreenshot`  | JSON with the base64 `screenshot`, plus `html` and `markdown` as requested.   |
| `scrapeJson`     | JSON with `success` and the extracted `data`.                                 |
| `scrapeBrand`    | JSON with `data.job_id`, `data.status`, and `data.brand`.                     |
| `webSearch`      | JSON with `success`, `message`, `tokenUsage`, and the results in `data`.      |

The Scraper API returns the page HTML with a screenshot even for `html=false`,
so `getScreenshot` sets `data.html` to `null` in that case.

A `webSearch` response lists the results in `data.data`, each with `rank`,
`title`, `url`, `description`, and `source`:

```json
{
  "status_code": 200,
  "data": {
    "success": true,
    "message": "Search completed",
    "data": [
      {
        "rank": 1,
        "title": "Web Scraping API | MrScraper",
        "url": "https://mrscraper.com/",
        "description": "Extract structured data from any website with AI.",
        "source": "MrScraper"
      }
    ],
    "tokenUsage": 1
  },
  "headers": { "content-type": "application/json; charset=utf-8" }
}
```

Failures include `error` or a failure body and set MCP `isError=true`: an HTTP
error status, `success: false`, a non-empty `error` in the body, or a brand job
with `status: "failed"`. Network failures have `status_code=null`.
Credential-bearing response headers and JSON metadata are filtered; network
errors redact signed query credentials.

## Manual testing: one tool at a time

[`scripts/test-tools.ts`](scripts/test-tools.ts) starts the compiled local MCP
server over stdio, verifies that exactly the seven tools are exposed, calls one
tool, prints its response, and exits. No separate server terminal is needed.
The runner loads `.env`, or reads `MRSCRAPER_API_KEY` / `MRSCRAPER_API_TOKEN`
from your shell. Each tool call uses the live MrScraper service.

Run these commands individually from the repository directory:

1. Install dependencies:

   ```sh
   npm ci
   ```

2. Build the current server:

   ```sh
   npm run build
   ```

3. Set your API key:

   ```sh
   export MRSCRAPER_API_KEY="YOUR_MRSCRAPER_API_KEY"
   ```

4. Test a page tool (`scrapeHtml`, `scrapeMarkdown`, `getScreenshot`,
   `scrapeBrand`, or `scrapeJson`):

   ```sh
   npm run test:manual -- scrapeMarkdown --url "https://www.scrapethissite.com/pages/simple/"
   ```

5. Test `webSearch`:

   ```sh
   npm run test:manual -- webSearch --query "MrScraper web scraping"
   ```

6. Test `status`:

   ```sh
   npm run test:manual -- status
   ```

The webSearch sample asks for US results (`country` `us`). Each command prints
`Tools: scrapeHtml, scrapeMarkdown, getScreenshot, scrapeBrand, scrapeJson, webSearch, status`
and `PASS <tool>` on success. Exit codes are 0 for success, 1 for a tool or
connection failure, and 2 for invalid command arguments.

Pass a complete JSON object to test any supported options:

```sh
npm run test:manual -- getScreenshot --args '{"url":"https://example.com","screenshot":"top","markdown":true}'
```

```sh
npm run test:manual -- webSearch --args '{"query":"web scraping","country":"id","numResults":20}'
```

To test an already running HTTP MCP server, append
`--target http://127.0.0.1:8000/mcp`. Rebuild after source changes when testing
local stdio. `npm run test:manual -- --help` lists runner options.

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
Page content remains available in `data`.

Browser-origin requests are accepted from trusted local origins, from
`claude.ai` and `chatgpt.com`, and from exact origins configured through
`MRSCRAPER_ALLOWED_ORIGINS`. Service-to-service MCP clients typically connect
without an `Origin` header. The discovery documents are served ahead of origin
checks, since any client must be able to read them before it has credentials.

### ChatGPT and Codex endpoint

ChatGPT and Codex get the same seven tools, but the page tools offer only the
basic page controls: `url`, `timeout`, `geoCode`, `waitUntil`,
`waitForSelector`, `browserRendering`, and each tool's own output options
(`html`, `markdown`, `screenshot`, `prompt`). `super`, `proxyCountry`,
`proxy`, `maxRetries`, `saveResult`, `blockResources`, and `returnCookie`
aren't offered; they keep their defaults, and a call that sends them is
rejected. `scrapeBrand`, `webSearch`, and `status` are the same as for other
clients.

The server picks this tool set in two cases:

- On `/mcp`, when the access token's `client_id` starts with
  `https://chatgpt.com/oauth/`. ChatGPT and Codex sign in with Client ID
  Metadata Documents at that address, so the MrScraper plugin in ChatGPT and
  Codex, and OpenAI's tool scan, use this tool set. Other OAuth clients and API
  keys keep the full set.
- On `/mcp/chatgpt`, for every caller. It uses the same sign-in as `/mcp`:
  unauthenticated requests point to the `/mcp` protected resource metadata, and
  an access token issued for `https://mcp.mrscraper.com/mcp` works on both
  endpoints.

## Interactive widgets

`webSearch` carries a self-contained search results widget that lists the
results with their titles, links, and descriptions. `status`
carries an account widget with the plan, token usage, and a usage meter. Hosts
without MCP Apps support display the normal JSON tool response.

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

| Variable                         | Default                          | Purpose                                                          |
| -------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `TRANSPORT`                      | `stdio`                          | Selects `stdio` or `http`.                                       |
| `HOST`                           | `127.0.0.1`                      | HTTP bind address; the Docker image uses `0.0.0.0`.              |
| `PORT`                           | `8000`                           | HTTP listen port.                                                |
| `MRSCRAPER_API_KEY`              | -                                | Primary stdio credential.                                        |
| `MRSCRAPER_API_TOKEN`            | -                                | Alternative stdio credential (also used by the Python SDK).      |
| `MRSCRAPER_HTTP_AUTH`            | `1`                              | Enables HTTP bearer verification.                                |
| `MRSCRAPER_OAUTH`                | `1`                              | Accepts OAuth 2.1 access tokens alongside API keys.              |
| `MRSCRAPER_MCP_PUBLIC_URL`       | `https://mcp.mrscraper.com`      | Public origin; `<origin>/mcp` is the required token audience.    |
| `MRSCRAPER_OAUTH_ISSUER`         | `https://api.app.mrscraper.com`  | Authorization server issuer.                                     |
| `MRSCRAPER_OAUTH_JWKS_URL`       | `<issuer>/.well-known/jwks.json` | Key set used to verify access tokens.                            |
| `MRSCRAPER_ALLOWED_ORIGINS`      | -                                | Comma-separated browser origins allowed to call the HTTP server. |
| `MRSCRAPER_API_BASE_URL`         | MrScraper platform API           | Platform endpoint override for development and testing.          |
| `MRSCRAPER_FETCH_BASE_URL`       | MrScraper Web Unblocker          | Scraper API and web search endpoint override.                    |
| `MRSCRAPER_LOG_HTTP_PAYLOAD`     | off                              | Enables trusted-environment request-body diagnostics.            |
| `MRSCRAPER_LOG_HTTP_PAYLOAD_MAX` | `8192`                           | Maximum diagnostic payload length.                               |

## Troubleshooting

- **Connection error:** Confirm the server URL ends in `/mcp` and reload the
  MCP client after configuration changes.
- **401 Unauthorized:** For OAuth, reconnect the server so your client runs the
  sign-in flow again. For an API key, confirm the bearer key for HTTP or the
  environment key for stdio.
- **403 insufficient_scope:** The token lacks a scope the tool needs. Reconnect
  and approve the additional permission. The page tools need `scrape:write`;
  `webSearch` needs `scrape:read`; `status` needs `account:read`.
- **Signing in succeeds but tools fail:** Confirm the server URL is exactly
  `https://mcp.mrscraper.com/mcp`; the token audience is bound to it.
- **403 Forbidden Origin:** Add the exact browser origin to
  `MRSCRAPER_ALLOWED_ORIGINS`.
- **Tool input error:** Compare the call with the tool's parameter table and
  its defaults. Unknown arguments, including the 0.4 names such as `region`
  or `geo_code`, are rejected.
- **Upstream timeout:** Page tools already wait up to the 300-second maximum
  by default. For slow pages, keep `waitUntil` at `domcontentloaded` instead of
  `networkidle0`, or set `blockResources: true`.
- **New tools are missing:** Start a new client session and inspect
  `tools/list` for exactly the seven tools.

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

`npm run test:e2e` calls every tool once against the live MrScraper service
using the manual runner. Use `-- --url URL --query QUERY` to customize the
targets, or `-- --target http://127.0.0.1:8000/mcp` to use HTTP.

## MCP Registry

The hosted server's MCP Registry manifest is defined in
[`server.json`](server.json). It describes the Streamable HTTP endpoint and
links to this repository and the setup documentation.

[`.github/workflows/publish-mcp-registry.yml`](.github/workflows/publish-mcp-registry.yml)
publishes `server.json` as `io.github.mrscraper-com/mrscraper-mcp`. Run it from
the Actions tab (**Publish to MCP Registry** → **Run workflow**) or push a
`v*` tag that matches the version in `server.json`. It authenticates with
GitHub OIDC, which grants this repository the `io.github.mrscraper-com/*`
namespace; an interactive `mcp-publisher login github` works only for
organization owners. The workflow fails if `server.json` and `package.json`
have different versions.

See the [official registry publishing guide](https://modelcontextprotocol.io/registry/github-actions)
for details. Registry versions are immutable, so use a new version in
`server.json` when publishing changed metadata. Publishing this manifest
registers the hosted server; it does not publish a new npm package.

## License

MIT. See [LICENSE](./LICENSE).
