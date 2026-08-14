# MrScraper MCP

An MCP server for the [MrScraper](https://mrscraper.com) service. Its public
data tools follow the current `@mrscraper/cli` command contract:

```text
fetch  scrape  serp  status  rerun  results  result
```

The MCP owns connector authentication and transport. CLI machine-management
commands such as `login`, `logout`, `init`, and `setup skills` are intentionally
not MCP tools because they modify the machine running the CLI rather than query
the MrScraper service.

## Tool contract

| Tool | Purpose |
| --- | --- |
| `fetch` | Return a known page as Markdown, HTML, or a clean document object, with adaptive unblocking. |
| `scrape` | Extract requested structured data with a prompt, JSON Schema, and `general`, `listing`, or `map` mode. |
| `serp` | Return Google results from a plain query or Google search URL. |
| `status` | Return subscription/quota information and optional domain outcome analytics. |
| `rerun` | Rerun an existing AI or manual scraper for one or many URLs. |
| `results` | List stored runs with pagination, sorting, search, and date filters. |
| `result` | Retrieve one stored run by result ID. |

The API payloads, defaults, validation, response redaction, environment
overrides, and v2 SERP endpoint follow `@mrscraper/cli`.

Successful tool calls publish command-specific MCP output schemas. Input
validation and upstream MrScraper failures are returned as MCP tool errors
(`isError=true`), which is the protocol equivalent of the CLI's nonzero exit.

Each tool parameter includes a model-facing description in its MCP input
schema, together with its type, default, allowed values, and enforceable limits
where applicable. The schema returned by `tools/list` is the authoritative tool
contract; this README provides selection guidance, examples, and operational
context for people using or deploying the server.

MCP-specific behavior:

- `scrape.schema` accepts the JSON Schema object directly. A server cannot read
  a schema filepath located on the MCP client's machine.
- The CLI's `scrape --output <path>` is not exposed. MCP returns the extraction
  response to its client rather than writing into the server's filesystem.

Use `fetch` for page content and `scrape` for defined fields or records.

Common workflows:

- Known URL: use `fetch` to read the page or `scrape` to extract specific data.
- Unknown URL: use `serp` to find candidates, then `fetch` or `scrape` the
  relevant pages.
- Saved scraper: use `rerun`, find the stored run with `results`, then retrieve
  its complete record with `result`.

## MCP endpoint

When `TRANSPORT=http`, the process exposes one Streamable HTTP MCP endpoint at
`/mcp`. It provides exactly the seven canonical tools listed above. `/mcp` is
the common path convention for MCP servers, although clients ultimately use
the full server URL and the MCP protocol does not require a particular path.

HTTP is stateless, so replicas do not require sticky sessions. Requests that
include an `Origin` header are rejected unless the origin is a trusted local
origin or appears in `MRSCRAPER_ALLOWED_ORIGINS`. Service-to-service MCP clients
normally omit `Origin`.

The same tool surface is available over stdio. Kubernetes-style liveness and
readiness checks are available at `/health` and `/ready`; readiness confirms
that all seven tools are registered and intentionally does not call an upstream
service that requires a user's credential. Probe responses include the service
name and version, which is also advertised through MCP `serverInfo`.

## Quick start

Python 3.11 or newer is required.

### Install

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e .
```

Installation creates the `mrscraper-mcp` executable.

### Connect over stdio

The default transport is stdio. Add this configuration to an MCP client that
uses the common `mcpServers` format:

```json
{
  "mcpServers": {
    "mrscraper": {
      "command": "mrscraper-mcp",
      "env": {
        "MRSCRAPER_API_KEY": "YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

If a desktop client cannot find the executable, replace `mrscraper-mcp` with
its absolute path, such as `/absolute/path/to/.venv/bin/mrscraper-mcp`.

### Connect over Streamable HTTP

Start the local HTTP server:

```bash
TRANSPORT=http mrscraper-mcp
# Endpoint: http://127.0.0.1:8000/mcp
```

Then configure the MCP client. Replace the URL when connecting to a deployed
server:

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

### Other development entry points

From a source checkout, `python server.py` is another development entry point
for both modes.

The ASGI application can also be run directly:

```bash
uvicorn mrscraper_mcp.app:app --host 127.0.0.1 --port 8000
```

`fastmcp run server.py:mcp` runs the same canonical FastMCP application.

## Authentication

For HTTP connectors, send the MrScraper API key as a Bearer header. The server
verifies it before processing MCP requests and uses that same caller-provided
key for MrScraper API calls. Tool schemas never expose token arguments.

Credential behavior depends on the transport mode:

| Mode | Accepted credential |
| --- | --- |
| HTTP | `Authorization: Bearer <MrScraper API key>` is required and verified before MCP requests run. |
| stdio | `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`. |

Environment credentials are stdio-only. They are never used to authorize an
HTTP tool call, so every HTTP client uses its own MrScraper API key.

The server removes credential-bearing response headers and recursively redacts
API tokens, cookies, signed query parameters, and generated curl credentials
before returning MrScraper data.

## Tool behavior

### `fetch`

Markdown is the default. Set `format` to `html` or `json` for raw HTML or the
clean page-document representation.

`unblock="auto"` first makes the less expensive non-rendered request and
retries with browser rendering when it detects a challenge or retryable block.
Use `always` for known dynamic/blocked pages or `never` to forbid rendering.
The remaining controls match the CLI:

- `geo`
- `wait_for` CSS selector
- `homepage`
- `block_resources`
- `retries`
- `token_cap`
- `timeout`

Example arguments:

```json
{
  "url": "https://example.com",
  "format": "markdown",
  "unblock": "auto"
}
```

### `scrape`

Pass `prompt`, `schema`, or both. Modes are:

- `general` for one page or normal extraction;
- `listing` for repeated records and bounded pagination; and
- `map` for URL discovery within one known site.

`listing` sends `max_pages` to the API. `map` supports `max_depth`,
`max_pages`, `limit`, `include_patterns`, and `exclude_patterns`, and does not
accept a schema. Structured scraping accepts `proxy_country`; fetch-only
browser controls are rejected in AI mode.

Example arguments for structured extraction:

```json
{
  "url": "https://example.com/product",
  "prompt": "Extract the product name and price",
  "schema": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "price": { "type": "string" }
    },
    "required": ["name", "price"]
  }
}
```

### `serp`

`query_or_url` accepts either a search phrase or a Google search URL. Google
URL parameters such as `q`, `gl`, `hl`, and `start` are normalized into the v2
SERP payload. Optional arguments are `region`, `language`, `page`, `format`,
`render_js`, `raw`, and `timeout`. Setting `raw=true` requests HTML output.

Example arguments:

```json
{
  "query_or_url": "best coffee shops in Jakarta",
  "region": "id",
  "language": "en",
  "page": 1
}
```

### `status`

Without a domain, `status` returns subscription, quota, token use, rate-limit,
renewal, and account fields. With a domain it also returns stored MrScraper
request outcomes for the requested interval.

The JSON property `from` and `to` accept ISO 8601 timestamps, `now`, or
durations such as `30m`, `24h`, and `7d`. Domain outcomes are not traffic, SEO,
audience, or market analytics.

Example arguments for the last seven days of domain outcomes:

```json
{
  "domain": "example.com",
  "from": "7d",
  "to": "now"
}
```

### `rerun`, `results`, and `result`

A single `rerun` requires `scraper_id`. A bulk rerun requires `bulk=true` and
`id`; `target` can be an array or a comma/newline-separated string. `type` is
`ai` or `manual`.

`results` supports the same fields as the CLI: `sort_field`, `sort_order`,
`page_size`, `page`, `search`, `date_range_column`, `start_at`, and `end_at`.
Pass a result UUID to `result.result_id` for the full row.

Example single AI rerun:

```json
{
  "target": "https://example.com/product",
  "type": "ai",
  "scraper_id": "YOUR_SCRAPER_UUID"
}
```

Example result listing:

```json
{
  "sort_field": "updatedAt",
  "sort_order": "DESC",
  "page_size": 10,
  "page": 1
}
```

Example single-result lookup:

```json
{
  "result_id": "YOUR_RESULT_UUID"
}
```

## Client example

```python
from fastmcp import Client
from fastmcp.client.auth import BearerAuth

async with Client(
    "http://localhost:8000/mcp",
    auth=BearerAuth("YOUR_MRSCRAPER_API_KEY"),
) as client:
    response = await client.call_tool(
        "fetch",
        {
            "url": "https://example.com",
            "format": "markdown",
            "unblock": "auto",
        },
    )
```

## Environment variables

- `PORT`: HTTP port, default `8000`.
- `HOST`: HTTP bind address, default `127.0.0.1`. Docker overrides this to
  `0.0.0.0` so published container ports are reachable.
- `TRANSPORT`: `stdio` or `http`. Any other value fails at startup.
- `MRSCRAPER_API_KEY`: preferred stdio credential. It is never used by HTTP
  tool calls.
- `MRSCRAPER_API_TOKEN`: alternate stdio credential environment variable.
- `MRSCRAPER_HTTP_AUTH`: HTTP Bearer verification is enabled by default. Keep
  it enabled for deployments. Setting it to `0` skips boundary verification
  for isolated protocol debugging, but each HTTP tool call must still provide
  its own `Authorization` or `x-api-token` header.
- `MRSCRAPER_ALLOWED_ORIGINS`: comma-separated browser origins allowed to send
  Origin-bearing requests. Leave empty for service-to-service clients.
- `MRSCRAPER_API_BASE_URL`: platform API override for development/tests.
- `MRSCRAPER_FETCH_BASE_URL`: Web Unblocker override.
- `MRSCRAPER_SYNC_BASE_URL`: sync/SERP API override.

## Docker

```bash
docker build -f docker/Dockerfile -t mrscraper-mcp .
docker run --rm \
  -p 8000:8000 \
  -e TRANSPORT=http \
  mrscraper-mcp
```

For stdio credentials inside a trusted container, add
`-e MRSCRAPER_API_KEY`. HTTP clients should normally supply their own Bearer
header instead. The image sets `HOST=0.0.0.0`; protect published deployments
with network controls and HTTP authentication.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `All connection attempts failed` | No server is listening at the configured URL. Start it with `TRANSPORT=http mrscraper-mcp` and verify the host, port, and `/mcp` path. |
| `401 Unauthorized` | HTTP requires `Authorization: Bearer <MrScraper API key>`. A key in the server environment is intentionally ignored for HTTP requests. |
| `403 Forbidden Origin` | Add the client's exact browser origin to `MRSCRAPER_ALLOWED_ORIGINS`. Service-to-service clients normally send no `Origin` header. |
| `Unsupported TRANSPORT` | Set `TRANSPORT` to exactly `stdio` or `http`. |
| Upstream request timeout | The MCP connection succeeded, but MrScraper or the target page did not finish in time. Retry, increase the tool's `timeout` where available, and call `status` to confirm authentication independently. |

## Development

Install the development dependencies and run the local checks:

```bash
pip install -e '.[dev]'
ruff format --check .
ruff check .
pytest -q
```

Canonical behavior lives in:

- `mrscraper_mcp/api.py` for service requests;
- `mrscraper_mcp/content.py` for fetch formatting;
- `mrscraper_mcp/status.py` for account/date handling; and
- `mrscraper_mcp/tools/cli.py` for the MCP schemas and routing.

## License

MIT — see [LICENSE](./LICENSE).
