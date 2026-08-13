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

MCP-specific behavior:

- `scrape.schema` accepts the JSON Schema object directly. A server cannot read
  a schema filepath located on the MCP client's machine.
- The CLI's `scrape --output <path>` is not exposed. MCP returns the extraction
  response to its client rather than writing into the server's filesystem.

Use `fetch` for page content and `scrape` for defined fields or records.

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

## Installation and running

Python 3.11 or newer is required.

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e .
```

Installation creates a `mrscraper-mcp` executable. Run it over stdio:

```bash
mrscraper-mcp
```

Run the HTTP endpoint:

```bash
TRANSPORT=http mrscraper-mcp
# Defaults: HOST=127.0.0.1 PORT=8000
```

From a source checkout, `python server.py` is another development entry point
for both modes.

The ASGI application can also be run directly:

```bash
uvicorn mrscraper_mcp.app:app --host 127.0.0.1 --port 8000
```

`fastmcp run server.py:mcp` runs the same canonical FastMCP application.

## Authentication

For HTTP connectors with the default `MRSCRAPER_HTTP_AUTH=1`, send the
MrScraper API key as a Bearer header. Tool schemas never expose token arguments.
For clients that use an `mcpServers` configuration, the connection resembles:

```json
{
  "mcpServers": {
    "mrscraper": {
      "type": "http",
      "url": "https://your-host.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

Credential behavior depends on the transport mode:

| Mode | Accepted credential |
| --- | --- |
| HTTP with `MRSCRAPER_HTTP_AUTH=1` (default) | `Authorization: Bearer <MrScraper API key>` is required and verified before MCP requests run. |
| HTTP with `MRSCRAPER_HTTP_AUTH=0` | Intended only for trusted local debugging. Tools resolve `x-api-token`, then `Authorization`, then `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`. |
| stdio | `MRSCRAPER_API_KEY`, then `MRSCRAPER_API_TOKEN`. |

In particular, `x-api-token` and an environment-only key do not bypass the
default HTTP Bearer middleware. Disable HTTP authentication only on a trusted
local interface when testing those fallback paths.

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

### `scrape`

Pass `prompt`, `schema`, or both. Modes are:

- `general` for one page or normal extraction;
- `listing` for repeated records and bounded pagination; and
- `map` for URL discovery within one known site.

`listing` sends `max_pages` to the API. `map` supports `max_depth`,
`max_pages`, `limit`, `include_patterns`, and `exclude_patterns`, and does not
accept a schema. Structured scraping accepts `proxy_country`; fetch-only
browser controls are rejected in AI mode.

### `serp`

`query_or_url` accepts either a search phrase or a Google search URL. Google
URL parameters such as `q`, `gl`, `hl`, and `start` are normalized into the v2
SERP payload. Optional arguments are `region`, `language`, `page`, `format`,
`render_js`, `raw`, and `timeout`. Setting `raw=true` requests HTML output.

### `status`

Without a domain, `status` returns subscription, quota, token use, rate-limit,
renewal, and account fields. With a domain it also returns stored MrScraper
request outcomes for the requested interval.

The JSON property `from` and `to` accept ISO 8601 timestamps, `now`, or
durations such as `30m`, `24h`, and `7d`. Domain outcomes are not traffic, SEO,
audience, or market analytics.

### `rerun`, `results`, and `result`

A single `rerun` requires `scraper_id`. A bulk rerun requires `bulk=true` and
`id`; `target` can be an array or a comma/newline-separated string. `type` is
`ai` or `manual`.

`results` supports the same fields as the CLI: `sort_field`, `sort_order`,
`page_size`, `page`, `search`, `date_range_column`, `start_at`, and `end_at`.
Pass a result UUID to `result.result_id` for the full row.

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
- `MRSCRAPER_API_KEY`: preferred stdio credential, or a tool credential when
  trusted local HTTP authentication is disabled.
- `MRSCRAPER_API_TOKEN`: alternate credential environment variable.
- `MRSCRAPER_HTTP_AUTH`: set to `0` only for trusted local HTTP debugging.
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

### MCP Inspector

The official MCP Inspector requires Node.js 22.19 or newer and runs without a
global installation. Start the HTTP server, then launch the Inspector against
the Streamable HTTP endpoint:

```bash
TRANSPORT=http mrscraper-mcp

npx @modelcontextprotocol/inspector \
  --server-url http://127.0.0.1:8000/mcp \
  --transport http \
  --header "Authorization: Bearer YOUR_MRSCRAPER_API_KEY"
```

The web UI can list the seven tools, inspect their input and output schemas,
and call them interactively. For trusted local testing without a connection
header, set `MRSCRAPER_HTTP_AUTH=0` and provide the tool credential through the
local environment instead.

For a repeatable command-line smoke test, `scripts/test_mcp.py` reads
`MRSCRAPER_API_KEY` or `MRSCRAPER_API_TOKEN` from the environment:

```bash
python scripts/test_mcp.py \
  --target http://127.0.0.1:8000/mcp \
  --call-tool fetch \
  --args '{"url":"https://example.com","format":"markdown"}'
```

The Inspector is documented at
<https://modelcontextprotocol.io/docs/tools/inspector>.

## Compliance

Scrape only content you are authorized to access. Review target-site terms and
applicable privacy, copyright, and computer-access laws before collecting or
reusing data. Before invoking a saved manual scraper for login-protected pages,
the calling agent must display the server's compliance warning and obtain the
user's acknowledgment.

## License

MIT — see [LICENSE](./LICENSE).
