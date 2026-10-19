# MrScraper for Zed

Give the Zed Agent access to MrScraper page retrieval, Google search, and account usage through the official [MrScraper MCP server](https://docs.mrscraper.com/docs/getting-started/mcp-server).

| MCP tool     | Capability                                                                 | REST API                                                          |
| ------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `scraperAPI` | Retrieve a URL as HTML, Markdown, a screenshot, or a combination           | `POST https://api.mrscraper.com`                                  |
| `webSearch`  | Search Google using query text or a Google search URL                      | `POST https://sync.scraper.mrscraper.com/api/google/serp/v2/sync` |
| `status`     | Read identity, subscription, token usage, remaining quota, and rate limits | `GET https://api.app.mrscraper.com/api/v1/subscription-accounts`  |

The extension ID and server ID are both `mcp-server-mrscraper`. Extension version `0.1.0` launches the pinned npm package `@mrscraper/mcp@0.2.1` over stdio. The server requires Node.js 20 or newer; the launcher uses Zed's Node runtime.

## Configure the extension

Create an [API key](https://app.mrscraper.com/api-tokens). Open your user settings with `zed: open settings file` and merge this entry:

```json
{
  "context_servers": {
    "mcp-server-mrscraper": {
      "settings": {
        "api_key": "YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

`api_key` must be a nonempty string. The extension passes it to the local server as `MRSCRAPER_API_KEY`; it requires this setting even when your shell has `MRSCRAPER_API_KEY` or `MRSCRAPER_API_TOKEN`. Keep your key in user settings and out of version control.

Open **Settings → AI → MCP Servers**, start or restart MrScraper, and check that the server is active. Enable its tools in your Agent profile. For example, ask: “Use MrScraper to search Google for Zed MCP documentation, then retrieve the most relevant page as Markdown.” See [Zed's MCP setup and usage](https://zed.dev/docs/ai/mcp).

## Tool examples

Example `tools/call` parameters:

```json
{
  "name": "scraperAPI",
  "arguments": {
    "url": "https://example.com",
    "html": false,
    "markdown": true
  }
}
```

```json
{
  "name": "webSearch",
  "arguments": {
    "url": "Zed MCP documentation",
    "raw": false,
    "format": "json",
    "region": "us",
    "language": "en",
    "page": 1
  }
}
```

```json
{
  "name": "status",
  "arguments": {}
}
```

Set `raw=false` for parsed search results; the SDK-compatible default `raw=true` returns HTML. Add `screenshot=true` to `scraperAPI` to capture a screenshot and automatically enable browser rendering. `status` returns an account summary with API keys and billing identifiers excluded. Full arguments and response formats are in the [server README](../../README.md#tool-reference) and [Python SDK](https://github.com/mrscraper-com/sdk-python).

## Hosted connection with OAuth

You can also connect directly to the managed server. Add a remote server in Zed, or merge this into user settings:

```json
{
  "context_servers": {
    "mrscraper": {
      "url": "https://mcp.mrscraper.com/mcp"
    }
  }
}
```

Zed supports [remote MCP OAuth](https://zed.dev/docs/ai/mcp#as-custom-servers). Leave headers unset and complete browser sign-in when prompted. This connection uses the hosted service directly and needs no local extension or Node runtime. Use one connection method to keep a single MrScraper tool list. See [MrScraper's hosted setup](https://docs.mrscraper.com/docs/getting-started/mcp-server#quick-start-with-the-hosted-server).

## Develop and test locally

1. Install Rust through [rustup](https://rustup.rs/) and use a current Zed release. From this directory, run:

   ```sh
   rustup target add wasm32-wasip2
   cargo fmt --check
   cargo test
   cargo build --release --target wasm32-wasip2
   ```

2. Run `zed: install dev extension` and select this `extensions/zed` directory, which contains `extension.toml`. See [Zed's development guide](https://zed.dev/docs/extensions/developing-extensions#developing-an-extension-locally).
3. Configure `api_key` as above, restart the server, and verify that `scraperAPI`, `webSearch`, and `status` are available.
4. In the Agent Panel, run `status`, retrieve `https://example.com` as Markdown, search with `raw=false` and `format="json"`, and request a screenshot. Confirm that each result is readable and that failures show useful errors.
5. Temporarily remove the key or use an empty value and confirm that Zed requests configuration. Restore your key and verify that the server starts again. Record the Zed version, operating system, and results before submitting.

For startup problems, run `zed: open log`. Check the key, Node runtime version, and npm access. Rust checks verify the launcher; a manual Zed session verifies installation and tool use.

See [publishing and registry requirements](docs/publishing.md) before submitting this extension for the [Zed extension directory](https://zed.dev/extensions/).

## License

[MIT](LICENSE).
