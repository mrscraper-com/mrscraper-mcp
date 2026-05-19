# MrScraper MCP

An MCP (Model Context Protocol) server built with FastMCP that wraps the [MrScraper](https://mrscraper.com) API—scraping, results APIs, and Google SERP extraction.

## Features

- **Web scraping** via MrScraper API (AI scrapers, manual scrapers, unblocker HTML fetch)
- **Google SERP** via MrScraper SERP API
- **MrScraper platform** statistics and results
- **Two MCP surfaces over HTTP**: a general-purpose server (`/mcp`) and a **ChatGPT App SDK** profile (`/chatgpt`)

### HTTP: which URL to use

When `TRANSPORT=http`, Starlette mounts **two** MCP apps:

| Mount path | Use case |
|------------|----------|
| `/mcp` | Default connector URL: synchronous tools (same surface as stdio). |
| `/chatgpt` | ChatGPT Apps / OpenAI Apps SDK: tools ending in `_job`, plus `get_scrape_job`, `list_scrape_jobs`, and sync-style helpers tuned for the host (see below). |

Example base URLs: `http://localhost:8000/mcp`, `http://localhost:8000/chatgpt`.

## Installation

```bash
pip install -e .
```

Or install dependencies directly:

```bash
pip install fastmcp httpx
```

## Usage

### Running the Server

**stdio (default)** — single MCP instance (`mcp`), same tools as HTTP `/mcp`:

```bash
python server.py
```

**HTTP with both `/mcp` and `/chatgpt`** — use the Starlette app (recommended for ChatGPT Apps):

```bash
TRANSPORT=http python server.py
# Optional: PORT=8000 HOST=0.0.0.0
```

You can also run the ASGI app directly:

```bash
uvicorn mrscraper_mcp.app:app --host 0.0.0.0 --port 8000
```

The FastMCP CLI targets **`server.py:mcp` only**, so it exposes the default tool surface—not the separate ChatGPT MCP mounted at `/chatgpt`. Use it for quick checks on the main connector:

```bash
fastmcp run server.py:mcp --transport http --port 8000
```

### Available Tools

Tool registration depends on **which MCP instance** you connect to.

**Default MCP** (`stdio`, or HTTP `…/mcp`) — synchronous API-style tools:

- `google_serp_sync` — Google SERP via the sync API (bearer token, full Google search URL; optional `raw`, `session_cookie`, `timeout`)
- `fetch_html`
- `create_ai_scraper`, `rerun_ai_scraper`, `bulk_rerun_ai_scraper`
- `rerun_manual_scraper`, `bulk_rerun_manual_scraper`
- `get_all_results`, `get_result_by_id`

There are **no** `*_job` tools and **no** `get_scrape_job` / `list_scrape_jobs` on this surface.

**ChatGPT MCP** (HTTP only: `…/chatgpt`) — tuned for the ChatGPT / OpenAI Apps SDK:

- Job tools (return immediately with a `jobId`): `fetch_html_job`, `google_serp_sync_job`, `create_ai_scraper_job`, `rerun_ai_scraper_job`, `rerun_manual_scraper_job`
- Job orchestration: `get_scrape_job`, `list_scrape_jobs`
- Fast, direct JSON tools (same APIs as the main server, different ChatGPT-oriented metadata): `get_all_results`, `get_result_by_id`, `bulk_rerun_ai_scraper`, `bulk_rerun_manual` (same behavior as `bulk_rerun_manual_scraper`)

### Google SERP

SERP calls hit MrScraper’s sync SERP endpoint. Use **`google_serp_sync`** on the default MCP for a single blocking response. In ChatGPT Apps, prefer **`google_serp_sync_job`** plus **`get_scrape_job`**, since hosts often time out long tool calls. Responses can be large (HTML or JSON); avoid dumping full payloads into the model—summarize or store externally.

### ChatGPT App SDK: background jobs

On **`/chatgpt`**, long-running work uses tools whose names end with **`_job`**. Each returns right away with a local **`jobId`** (jobs live in server memory only until the process exits).

1. Start work with a `*_job` tool (for example `create_ai_scraper_job` or `google_serp_sync_job`).
2. Call **`get_scrape_job(job_id=…)`** when you need status; after the user follows up is ideal. Avoid tight polling loops—many jobs finish in seconds but some run closer to a minute. The bundled job-status widget uses progressive backoff between polls.
3. When **`status`** is `succeeded` or `failed`, **`get_scrape_job`** includes the full **`result`** object (the same shape the synchronous tool would return: typically `status_code`, `data`, `headers`, and `error` when applicable).

`get_scrape_job` is intentionally “plain” so repeated status checks do not keep reopening the progress widget.

For local development you can smoke-test SERP via `scripts/test_google_serp.py` (direct implementation or MCP).

## Docker Deployment

### Building the Docker Image

```bash
docker build -t mrscraper-mcp .
```

### Running with Docker

```bash
docker run -d \
  --name mrscraper-mcp \
  -p 8000:8000 \
  -e PORT=8000 \
  -e HOST=0.0.0.0 \
  -e TRANSPORT=http \
  --restart unless-stopped \
  mrscraper-mcp
```

### Using Docker Compose

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the service
docker-compose down
```

### HTTP authentication (Cursor, Claude, etc.)

For remote HTTP connectors, pass your MrScraper API token in MCP **headers**, not in the server URL:

```json
{
  "mcpServers": {
    "mrscraper": {
      "type": "http",
      "url": "https://your-host.example.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MRSCRAPER_API_TOKEN"
      }
    }
  }
}
```

`x-api-token` is also accepted. Tools no longer require a `token` argument when the header (or `MRSCRAPER_API_TOKEN`) is set.

Set `MRSCRAPER_HTTP_AUTH=0` only for local debugging without Bearer auth on `/mcp` and `/chatgpt`.

### Environment Variables

- `PORT`: Port to run the server on (default: 8000)
- `HOST`: Host to bind to (default: 0.0.0.0)
- `TRANSPORT`: `http` runs the full ASGI app (`/mcp` and `/chatgpt`); `stdio` runs the default MCP over stdio (default: `stdio` for local `python server.py`, typically `http` in Docker)
- `MRSCRAPER_API_TOKEN`: API token for stdio transport or as a server-side fallback when tools omit `token`
- `MRSCRAPER_HTTP_AUTH`: When `1` (default), HTTP mounts require `Authorization: Bearer …` (or `x-api-token`)

### Remote Server Deployment

1. **Build the image on your local machine:**
   ```bash
   docker build -t mrscraper-mcp .
   ```

2. **Save the image:**
   ```bash
   docker save mrscraper-mcp | gzip > mrscraper-mcp.tar.gz
   ```

3. **Transfer to remote server:**
   ```bash
   scp mrscraper-mcp.tar.gz user@your-server.com:/path/to/destination/
   ```

4. **On remote server, load and run:**
   ```bash
   docker load < mrscraper-mcp.tar.gz
   docker run -d --name mrscraper-mcp -p 8000:8000 mrscraper-mcp
   ```

   Or use docker-compose:
   ```bash
   # Copy docker-compose.yml to remote server
   docker-compose up -d
   ```

5. **Connect to the remote server** (use `/mcp` for the default toolset, `/chatgpt` for ChatGPT job tools):
   ```python
   from fastmcp import Client
   from fastmcp.client.auth import BearerAuth

   async with Client(
       "http://your-server.com:8000/mcp",
       auth=BearerAuth("YOUR_MRSCRAPER_API_TOKEN"),
   ) as client:
       result = await client.call_tool("fetch_html", {"url": "https://example.com"})
   ```

### Reverse Proxy Setup (Optional)

For production, consider using a reverse proxy like Nginx. Proxy **`/mcp`** and **`/chatgpt`** (and **`/.well-known/openai-apps-challenge`** if you use OpenAI Apps verification) to the same upstream:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /mcp {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    location /chatgpt {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

## Connecting to Claude Desktop

### Local Setup (stdio transport)

To connect this MCP server to Claude Desktop locally, see the detailed setup guide:

**[📖 Claude Desktop Setup Guide](./CLAUDE_SETUP.md)**

Quick steps:
1. Edit Claude Desktop config: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Add the server configuration (see `CLAUDE_SETUP.md` for details)
3. Restart Claude Desktop completely
4. Look for the 🔨 icon in Claude's chat interface

### Remote Setup via ngrok (HTTP transport)

To connect Claude Desktop via ngrok:

**[🚀 Quick ngrok Setup Guide](./NGROK_SETUP.md)**

Quick steps:
1. Start server with HTTP transport: `TRANSPORT=http python server.py`
2. Start ngrok: `ngrok http 8000 --domain=your-domain.ngrok-free.dev`
3. Configure in Claude Desktop: **Settings** → **Connectors** → Add connector with your ngrok base URL plus **`/mcp`** (for example `https://your-domain.ngrok-free.dev/mcp`)
4. Test connection

## Development

Extend tools and widget resources under `mrscraper_mcp/`; register new tools in `mrscraper_mcp/tools/__init__.py` (`register_tools` vs `register_chatgpt_tools`).

## License

MIT — see [LICENSE](./LICENSE)