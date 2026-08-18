# MrScraper MCP

An MCP server for [MrScraper](https://mrscraper.com), with tools for fetching
pages, extracting structured data, searching Google, checking usage, rerunning
saved scrapers, and reading stored results.

It exposes the same seven data commands as `@mrscraper/cli`:

```text
fetch  scrape  serp  status  rerun  results  result
```

## Copyable agent setup prompt

Paste this into a coding agent to connect the hosted MCP server:

```text
Connect MrScraper MCP to this agent. Detect the MCP client and configure
https://mcp.mrscraper.com/mcp with Streamable HTTP and Authorization: Bearer
<MRSCRAPER_API_KEY>. Do not use OAuth or ~/.mrscraper/auth.json, and never ask
me to paste the key into chat; have me set it through the client's environment
or secret store. Reload the client if needed, then confirm fetch, scrape, serp,
status, rerun, results, and result are available.
```

## Run the server locally

Node.js 20 or newer and a key from
[app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens) are
required. Build this checkout, then start its Streamable HTTP server:

```sh
git clone https://github.com/mrscraper-com/mrscraper-mcp.git
cd mrscraper-mcp
npm ci
npm run build
TRANSPORT=http npm start
```

The MCP endpoint is now available at `http://127.0.0.1:8000/mcp`. Keep that
process running while your agent uses the tools.

## Connect an MCP client

HTTP clients send the API key as an
`Authorization: Bearer <MRSCRAPER_API_KEY>` header. For clients using
`mcpServers` configuration:

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

Use your client's environment-variable or secret-storage syntax when
available. Never put the key in the URL or commit it.

For Codex:

```sh
export MRSCRAPER_API_KEY="YOUR_MRSCRAPER_API_KEY"
codex mcp add mrscraper \
  --url http://127.0.0.1:8000/mcp \
  --bearer-token-env-var MRSCRAPER_API_KEY
```

Launch Codex from an environment containing `MRSCRAPER_API_KEY`. The command
stores only the environment-variable name in Codex's configuration, not the
key itself.

## Run locally over stdio

If your client launches local MCP servers, point it at the build created above.
Replace the example path with the absolute path to this checkout:

```json
{
  "mcpServers": {
    "mrscraper": {
      "command": "node",
      "args": ["/absolute/path/to/mrscraper-mcp/dist/bin.js"],
      "env": {
        "MRSCRAPER_API_KEY": "YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

Local stdio mode reads `MRSCRAPER_API_KEY`, with `MRSCRAPER_API_TOKEN` as a
legacy alias. It does not read CLI credentials or start a browser login.

## Tools

| Tool      | Use it for                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `fetch`   | Read a known page as Markdown, HTML, or a clean document object.                                         |
| `scrape`  | Extract requested fields or records with a prompt, JSON Schema, and `general`, `listing`, or `map` mode. |
| `serp`    | Search Google from a query or Google search URL.                                                         |
| `status`  | Check subscription, quota, usage, and optional domain request outcomes.                                  |
| `rerun`   | Run an existing AI or manual scraper for one or many URLs.                                               |
| `results` | List stored runs with pagination, sorting, search, and date filters.                                     |
| `result`  | Retrieve one stored run by result ID.                                                                    |

Use `fetch` when you need page content and `scrape` when you need defined
fields or records. If you do not know the URL, start with `serp`.

The schema returned by MCP `tools/list` is the authoritative parameter
reference. In particular:

- `fetch` defaults to Markdown and can automatically retry blocked pages with
  browser rendering.
- `scrape.schema` accepts a JSON Schema object, not a filepath on the client.
- `scrape` listing and map modes should use bounded page and depth limits.
- `status` domain analytics report MrScraper request outcomes, not SEO or
  audience analytics.
- Manual scraper reruns require the client to show the server's compliance
  warning and obtain the user's acknowledgment first.

CLI machine-management commands such as `login`, `logout`, `init`, and `setup`
are intentionally not MCP tools.

## Authentication and security

| Mode        | Credential                                                    |
| ----------- | ------------------------------------------------------------- |
| Local HTTP  | `Authorization: Bearer <MrScraper API key>` on every request. |
| Local stdio | `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`.              |

HTTP bearer tokens are validated through the MrScraper API before MCP requests
run. A server-side environment key is intentionally never used to authorize
HTTP tool calls, so each HTTP client uses its own credential. There is no MCP
browser OAuth flow, and tool schemas do not expose token arguments.

The server removes credential-bearing response headers and recursively redacts
API tokens, cookies, signed query parameters, and generated curl credentials
before returning data.

HTTP requests carrying an `Origin` header are accepted only from trusted local
origins or an exact origin in `MRSCRAPER_ALLOWED_ORIGINS`. Service-to-service
MCP clients normally omit `Origin`.

## Docker

```sh
docker build -f docker/Dockerfile -t mrscraper-mcp .
docker run --rm -p 8000:8000 mrscraper-mcp
```

The image listens on `0.0.0.0`; protect published deployments with network
controls and keep HTTP authentication enabled.

## Environment variables

| Variable                    | Default             | Description                                                             |
| --------------------------- | ------------------- | ----------------------------------------------------------------------- |
| `TRANSPORT`                 | `stdio`             | `stdio` or `http`.                                                      |
| `HOST`                      | `127.0.0.1`         | HTTP bind address. The Docker image uses `0.0.0.0`.                     |
| `PORT`                      | `8000`              | HTTP listen port.                                                       |
| `MRSCRAPER_API_KEY`         | —                   | Preferred stdio credential.                                             |
| `MRSCRAPER_API_TOKEN`       | —                   | Legacy stdio credential alias.                                          |
| `MRSCRAPER_HTTP_AUTH`       | `1`                 | HTTP bearer verification. Disable only for isolated protocol debugging. |
| `MRSCRAPER_ALLOWED_ORIGINS` | —                   | Comma-separated browser origins allowed to call the HTTP server.        |
| `MRSCRAPER_API_BASE_URL`    | MrScraper API       | Platform API override for development and tests.                        |
| `MRSCRAPER_FETCH_BASE_URL`  | MrScraper fetch API | Web Unblocker override.                                                 |
| `MRSCRAPER_SYNC_BASE_URL`   | MrScraper sync API  | Synchronous scraper and SERP override.                                  |

Request-body debugging is available through `MRSCRAPER_LOG_HTTP_PAYLOAD` and
`MRSCRAPER_LOG_HTTP_PAYLOAD_MAX`. Enable it only in a trusted environment;
payloads may contain sensitive data.

## Troubleshooting

- **Connection failed:** verify that the server is running and the URL ends in
  `/mcp`.
- **401 Unauthorized:** check `MRSCRAPER_API_KEY` for stdio. For HTTP, send a
  valid bearer token with the client request.
- **403 Forbidden Origin:** add the client's exact browser origin to
  `MRSCRAPER_ALLOWED_ORIGINS`.
- **Unsupported transport:** set `TRANSPORT` to exactly `stdio` or `http`.
- **Upstream timeout:** retry, increase the tool timeout where available, and
  call `status` to check authentication independently.

## Development

```sh
npm ci
npm run format:check
npm run lint
npm test
npm run build
```

Run from a source checkout:

```sh
MRSCRAPER_API_KEY="YOUR_MRSCRAPER_API_KEY" npm start
```

Smoke-test a running HTTP server:

```sh
npm run test:mcp -- \
  --target http://127.0.0.1:8000/mcp \
  --token "$MRSCRAPER_API_KEY"
```

`npm run test:e2e` exercises all seven tools against the real service. It
makes potentially billable calls and creates stored scraper results.

## License

MIT — see [LICENSE](./LICENSE).
