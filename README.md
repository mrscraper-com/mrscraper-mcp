# MrScraper MCP Server

Seven services for account status, HTML, Markdown, screenshots, brand data, structured JSON, and web search.

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

ChatGPT and Codex use the same seven services with reduced page options, on
`/mcp` and on `https://mcp.mrscraper.com/mcp/chatgpt` (see
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

| Scope          | Grants                           |
| -------------- | -------------------------------- |
| `scrape:write` | All six scraping/search services |
| `account:read` | `status`                         |

A tool called without its scope is refused with `403 insufficient_scope`, and
your client will offer to grant the missing permission.

`scrapeHtml` submits a scraping job to the backend with `GET /`, which requires
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

## Services

| CLI command       | MCP tool         | Purpose                                       | Required OAuth scope |
| ----------------- | ---------------- | --------------------------------------------- | -------------------- |
| `status`          | `status`         | Account, subscription, quota, and rate limits | `account:read`       |
| `scrape-html`     | `scrapeHtml`     | Raw page HTML                                 | `scrape:write`       |
| `scrape-markdown` | `scrapeMarkdown` | Clean Markdown; optional HTML                 | `scrape:write`       |
| `get-screenshot`  | `getScreenshot`  | Full-page or top-viewport base64 screenshot   | `scrape:write`       |
| `scrape-brand`    | `scrapeBrand`    | Brand data as JSON                            | `scrape:write`       |
| `scrape-json`     | `scrapeJson`     | Structured extraction using a prompt          | `scrape:write`       |
| `web-search`      | `webSearch`      | Ranked web search results                     | `scrape:write`       |

MCP tool and argument names use camelCase consistently, mapping the CLI's kebab-case names without changing their meaning. Single-word names such as `status` and `super` stay unchanged. camelCase is supported by the [MCP tool naming guidelines](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#tool-names).

## Permission behavior

All six scraping/search tools require `scrape:write` and advertise `destructiveHint: false` and `openWorldHint: true`. `scrapeBrand` and `webSearch` advertise `readOnlyHint: true`. HTML, Markdown, screenshot, and JSON tools advertise `readOnlyHint: false` on every client surface because they accept `saveResult: true`, which persists results in the dashboard. Quota consumption alone does not make a tool non-read-only. `status` requires `account:read` and advertises `readOnlyHint: true` and `openWorldHint: false`. The legacy `scrape:read` scope remains advertised for compatibility; it does not authorize any of the six scraping/search tools.

OAuth scopes are enforced by the HTTP middleware. MCP annotations describe tool behavior to clients and do not grant access; see the [MCP tool annotation specification](https://modelcontextprotocol.io/specification/latest/schema#toolannotations). The use of HTTP GET does not determine the tool's permission scope. Existing OAuth connections with only `scrape:read` must reconnect and approve `scrape:write` to use scraping/search. API-key connections continue to use the key's upstream permissions.

## Tool examples

```json
{"name":"status","arguments":{}}
{"name":"scrapeHtml","arguments":{"url":"https://example.com"}}
{"name":"scrapeMarkdown","arguments":{"url":"https://example.com","html":true}}
{"name":"getScreenshot","arguments":{"url":"https://example.com","screenshot":"top"}}
{"name":"scrapeBrand","arguments":{"url":"https://example.com"}}
{"name":"scrapeJson","arguments":{"url":"https://example.com","prompt":"Extract titles and prices"}}
{"name":"webSearch","arguments":{"query":"web scraping","country":"id","numResults":20}}
```

Tools authenticate through the connection and never accept tokens as input. Options follow the API keys, including `super`. Unsupported input fields are rejected. Successful tool results contain text content and `structuredContent` with `status_code`, `data`, and sanitized headers. `status` preserves the complete API response body in `data`, with no unwrapping, account-field redaction, or calculated values. HTTP/network failures set `isError: true`. Screenshot JSON preserves base64 image data. Search returns ranked titles, URLs, descriptions, and sources.

## Shared page parameters

These fields apply to HTML, Markdown, screenshots, and JSON extraction.
Authentication comes from the MCP connection, so no tool takes `token` as input.
Booleans and numbers must use JSON types rather than strings.

| CLI option        | MCP argument   | JSON type   | Default              | Meaning                                                              |
| ----------------- | -------------- | ----------- | -------------------- | -------------------------------------------------------------------- |
| URL argument      | `url`          | string      | required             | Absolute HTTP or HTTPS page URL.                                     |
| `--timeout`       | `timeout`      | integer     | `300`                | Page deadline in seconds, 1–300; HTTP transport adds 30 seconds.     |
| `--geo-code`      | `geoCode`      | string      | `"us"`               | Two-letter country to load the page from; sent in lowercase.         |
| `--proxy-country` | `proxyCountry` | string      | `"us"`               | Two-letter proxy server country; sent in lowercase.                  |
| `--super`         | `super`        | boolean     | `false`              | Use real-device routing.                                             |
| `--wait-until`    | `waitUntil`    | string enum | `"domcontentloaded"` | Also accepts `"load"`, `"networkidle0"`, or `"networkidle2"`.        |
| `--proxy`         | `proxy`        | string      | omitted              | Custom proxy URL.                                                    |
| `--max-retries`   | `maxRetries`   | integer     | omitted              | Nonnegative retry limit; omission means no limit. Zero is preserved. |
| `--save-result`   | `saveResult`   | boolean     | `false`              | Save the result in the dashboard.                                    |

HTML, Markdown, and screenshots also accept these loading controls. JSON
extraction does not accept them. Omit optional fields instead of sending `null`.

| CLI option            | MCP argument      | JSON type | Default | Meaning                               |
| --------------------- | ----------------- | --------- | ------- | ------------------------------------- |
| `--block-resources`   | `blockResources`  | boolean   | `false` | Block images, fonts, and stylesheets. |
| `--wait-for-selector` | `waitForSelector` | string    | omitted | CSS selector to wait for.             |
| `--return-cookie`     | `returnCookie`    | boolean   | `false` | Include browser session cookies.      |

## Service usage

The examples below show MCP `tools/call` parameter objects. Use `example.com`
as a sample target and replace it for your use case. All six scraping and
search tools consume account quota.

### Status

```json
{ "name": "status", "arguments": {} }
```

Status takes no service arguments and uses a fixed 600-second HTTP deadline.
The complete API body is preserved in `structuredContent.data` without
unwrapping, redacting account fields, or calculating fields. When the API
wraps account details in `data`, those details are in
`structuredContent.data.data`. Response headers are filtered for credentials.

### Scrape HTML

```json
{
  "name": "scrapeHtml",
  "arguments": {
    "url": "https://example.com",
    "browserRendering": true,
    "waitForSelector": ".content",
    "waitUntil": "networkidle2",
    "timeout": 120,
    "maxRetries": 0,
    "saveResult": false
  }
}
```

`browserRendering` is a boolean, default `false`. HTML always sends
`html=true`, `markdown=false`, and `screenshot=false`. The default body is
HTML text; some page controls can make the API return JSON instead.

### Scrape Markdown

```json
{
  "name": "scrapeMarkdown",
  "arguments": {
    "url": "https://example.com",
    "html": true,
    "browserRendering": false
  }
}
```

`html` and `browserRendering` are booleans, both default `false`. Setting
`html: true` forces browser rendering and returns both outputs as JSON.
Otherwise, the default body is Markdown text. The request always sends
`markdown=true` and `screenshot=false`.

### Get screenshot

```json
{
  "name": "getScreenshot",
  "arguments": {
    "url": "https://example.com",
    "screenshot": "top",
    "html": false,
    "markdown": true
  }
}
```

| Argument     | JSON type                      | Default  | Meaning                      |
| ------------ | ------------------------------ | -------- | ---------------------------- |
| `screenshot` | string enum: `"full"`, `"top"` | `"full"` | Entire page or top viewport. |
| `html`       | boolean                        | `true`   | Include page HTML.           |
| `markdown`   | boolean                        | `false`  | Include Markdown.            |

Browser rendering is always enabled; there is no `browserRendering` argument.
The returned screenshot JSON retains its base64 image and other API fields.
The API can still include HTML when `html: false` is requested.

### Scrape brand

```json
{ "name": "scrapeBrand", "arguments": { "url": "https://example.com" } }
```

Only `url` is accepted. The request sends `action=brand-scraping&bundle=none`
and uses a fixed 120-second HTTP deadline. Brand data is typically in
`structuredContent.data.data.brand`.

### Scrape JSON

```json
{
  "name": "scrapeJson",
  "arguments": {
    "url": "https://example.com",
    "prompt": "Extract the page title. Json Schema: {\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\"}}}",
    "browserRendering": true,
    "html": false,
    "screenshot": false,
    "timeout": 180
  }
}
```

| Argument           | JSON type | Default                                       | Meaning                                                                              |
| ------------------ | --------- | --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `prompt`           | string    | `"Extract all data as complete as possible."` | Nonempty extraction instruction. Append `Json Schema:` and a schema to shape output. |
| `browserRendering` | boolean   | `false`                                       | Enable browser rendering.                                                            |
| `html`             | boolean   | `false`                                       | Include page HTML.                                                                   |
| `screenshot`       | boolean   | `false`                                       | Include a base64 screenshot.                                                         |

JSON extraction uses the `general` agent. Long prompts use the POST fallback
described below. Loading and cookie controls are unavailable.

### Web search

```json
{
  "name": "webSearch",
  "arguments": {
    "query": "site:example.com documentation",
    "country": "id",
    "numResults": 20
  }
}
```

| Argument     | JSON type | Default  | Meaning                                                |
| ------------ | --------- | -------- | ------------------------------------------------------ |
| `query`      | string    | required | Trimmed query text, 1–1,000 characters.                |
| `country`    | string    | `"us"`   | Two-letter country code, sent in lowercase.            |
| `numResults` | integer   | `10`     | Requested result count, 10–100; fewer may be returned. |

Search uses a fixed 120-second HTTP deadline and has no `timeout` argument.
Results retain ranked titles, URLs, descriptions, and sources in the API's
original response structure.

## HTTP contract

The CLI repository is the source of truth for service behavior. These are seven services, using two API hosts:

| Service    | Request                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| Status     | `GET https://api.app.mrscraper.com/api/v1/subscription-accounts`                                     |
| HTML       | `GET https://api.mrscraper.com?url=…&html=true&markdown=false&screenshot=false`                      |
| Markdown   | `GET https://api.mrscraper.com?url=…&html=false&markdown=true&screenshot=false`                      |
| Screenshot | `GET https://api.mrscraper.com?url=…&browserRendering=true&screenshot=full&html=true&markdown=false` |
| Brand      | `GET https://api.mrscraper.com?action=brand-scraping&url=…&bundle=none`                              |
| JSON       | `GET https://api.mrscraper.com?url=…&agent=general&prompt=…&html=false&screenshot=false`             |
| Web search | `GET https://api.mrscraper.com?action=websearch&query=…&country=us&numResults=10`                    |

JSON uses GET until the encoded URL exceeds 8,000 characters. It then uses POST with `{ "url", "prompt", "agent": "general" }` in the JSON body and page controls in the query. Append `Json Schema:` and a JSON schema to the prompt to shape the extraction.

Authentication uses headers. Credentials are never placed in the query string. Page requests allow 30 seconds beyond the page timeout for HTTP transport; brand and search use a fixed 120 seconds. Status uses a fixed 600-second deadline with no service arguments. Brand returns JSON synchronously with `bundle=none`.

## Migration from 0.4.x

`status` keeps its name and now returns the raw API response body instead of an account summary. Replace `scraperAPI` with `scrapeHtml`, `scrapeMarkdown`, or `getScreenshot`; use the latter two for combined outputs. Brand and JSON extraction are now separate tools. Search uses `query`, `country`, and `numResults` instead of `url`, `region`, and `num_results`. Page options follow the API keys, including `super`, matching the CLI's `--super` option. Removed header and token-budget controls are outside the CLI's seven-service contract. Refresh the connected client's tool list after upgrading.

## Manual testing

Build the server and set a token before making live calls. Each manual invocation calls one service and returns nonzero on failure. Calls consume quota.

```bash
npm ci
npm run build
export MRSCRAPER_API_TOKEN="YOUR_TOKEN"
npm run test:manual -- status
npm run test:manual -- scrapeHtml --url https://example.com
npm run test:manual -- scrapeMarkdown --args '{"url":"https://example.com","html":true}'
npm run test:manual -- getScreenshot --args '{"url":"https://example.com","screenshot":"top"}'
npm run test:manual -- scrapeBrand --url https://mrscraper.com
npm run test:manual -- scrapeJson --args '{"url":"https://example.com","prompt":"Extract titles and prices"}'
npm run test:manual -- webSearch --query "web scraping"
npm run test:e2e                       # attempts all seven services
```

Add `--target http://127.0.0.1:8000/mcp` (or your hosted URL) to test an HTTP server. Without a target, the manual runner starts the local stdio build. Use `--args` for any service-specific input.

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

The server filters credential-bearing response headers. For scraping and search, parsed JSON credential
metadata and credentials embedded in generated curl commands are redacted.
Status preserves the raw response body, including every account field returned by the API.
Page content remains available in `data`.

Browser-origin requests are accepted from trusted local origins, from
`claude.ai` and `chatgpt.com`, and from exact origins configured through
`MRSCRAPER_ALLOWED_ORIGINS`. Service-to-service MCP clients typically connect
without an `Origin` header. The discovery documents are served ahead of origin
checks, since any client must be able to read them before it has credentials.

### ChatGPT and Codex endpoint

All clients receive the same seven services, parameters, and defaults as the
CLI. HTML, Markdown, screenshot, and JSON tools expose all page controls,
including `super`, proxy settings, and `saveResult`. Unsupported arguments
are rejected. Authentication remains specific to the MCP connection.

The server accepts the following client routes:

- On `/mcp`, when the access token's `client_id` starts with
  `https://chatgpt.com/oauth/`. ChatGPT and Codex sign in with Client ID
  Metadata Documents at that address, so the MrScraper plugin in ChatGPT and
  Codex, and OpenAI's tool scan, receive the same full tool set as other OAuth clients and API
  keys.
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
  and approve the additional permission. For `scrapeHtml`, the token must include
  `scrape:write`; for `webSearch`, it must include `scrape:write`.
- **Signing in succeeds but tools fail:** Confirm the server URL is exactly
  `https://mcp.mrscraper.com/mcp`; the token audience is bound to it.
- **403 Forbidden Origin:** Add the exact browser origin to
  `MRSCRAPER_ALLOWED_ORIGINS`.
- **Tool input error:** Compare the call with the tool's parameter table and
  its defaults.
- **Upstream timeout:** Increase the page tool's `timeout` (up to 300 seconds)
  when the target requires a longer request window. Brand and search use a fixed 120-second timeout.
- **New tools are missing:** Start a new client session and inspect
  `tools/list` for all seven services listed above.

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

`npm run test:e2e` runs all seven tools sequentially against the live MrScraper
service using the manual runner. Use `-- --url URL --query QUERY` to customize
the targets, or `-- --target http://127.0.0.1:8000/mcp` to use HTTP.

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
