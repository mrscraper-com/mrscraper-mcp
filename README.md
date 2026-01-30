# MrScraper MCP

A simple MCP (Model Context Protocol) server built with FastMCP.

## Features

- Web scraping via MrScraper API
- JavaScript rendering support
- Geolocation-based scraping (country-specific content)
- Configurable timeout and resource blocking
- Built with FastMCP (latest version)
- Easy to extend with additional tools

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

Run the server with stdio transport (default for MCP):

```bash
python server.py
```

Or use the FastMCP CLI:

```bash
fastmcp run server.py:mcp
```

For HTTP transport:

```bash
fastmcp run server.py:mcp --transport http --port 8000
```

### Available Tools

#### `scrape_url`

Scrapes a web page using the MrScraper API with advanced features like JavaScript rendering, geolocation-based access, and resource management.

**Parameters:**
- `url` (str, required): The target URL to scrape (e.g., 'https://www.example.com/page')
- `token` (str, required): Your MrScraper API token for authentication
- `timeout` (int, optional): Maximum time in seconds to wait for the page to load (default: 120)
- `geo_code` (str, optional): ISO country code for geolocation-based scraping (default: 'ID' for Indonesia)
  - Examples: 'US', 'GB', 'ID', 'SG', etc.
- `block_resources` (bool, optional): Whether to block loading of images, CSS, fonts, and other resources to speed up scraping (default: False)

**Returns:**
- Dictionary containing:
  - `status_code`: HTTP status code of the response
  - `data`: The scraped HTML content or JSON response
  - `headers`: Response headers from the API
  - `error`: Error message if the request failed (if applicable)

**Example:**

Using the FastMCP client:

```python
import asyncio
from fastmcp import Client

async def main():
    async with Client("http://localhost:8000/mcp") as client:
        result = await client.call_tool(
            "scrape_url",
            {
                "url": "https://www.takapedia.com/id-id/magic-chess-go-go",
                "token": "atk_your_token_here",
                "geo_code": "ID",
                "timeout": 120,
                "block_resources": False
            }
        )
        print(result)

asyncio.run(main())
```

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

### Environment Variables

- `PORT`: Port to run the server on (default: 8000)
- `HOST`: Host to bind to (default: 0.0.0.0)
- `TRANSPORT`: Transport type - "http" for remote access, "stdio" for local MCP clients (default: "http" in Docker)

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

5. **Connect to the remote server:**
   ```python
   from fastmcp import Client
   
   async with Client("http://your-server.com:8000/mcp") as client:
       result = await client.call_tool("scrape_url", {...})
   ```

### Reverse Proxy Setup (Optional)

For production, consider using a reverse proxy like Nginx:

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
3. Configure in Claude Desktop: **Settings** → **Connectors** → Add connector with your ngrok URL
4. Test connection

## Development

This is a base repository that can be extended with additional tools, resources, and prompts as needed.

## License

CC