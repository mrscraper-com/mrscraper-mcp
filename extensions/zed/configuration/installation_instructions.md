Connect Zed's Agent Panel to MrScraper for web page retrieval, Google search, and account usage.

1. Create a [MrScraper API key](https://app.mrscraper.com/api-tokens).
2. Replace `YOUR_MRSCRAPER_API_KEY` below with your key and save the configuration. Use Zed user settings to keep the credential out of your project repository.
3. Enable MrScraper in the Agent Panel's MCP server settings. Confirm that `scraperAPI`, `webSearch`, and `status` are available.

The extension installs `@mrscraper/mcp@0.2.1` automatically using Zed's Node.js runtime. The MCP package requires Node.js 20 or newer. Scraping and search use your MrScraper plan tokens.

See the [MrScraper MCP documentation](https://docs.mrscraper.com/docs/getting-started/mcp-server) for tool options and the extension README for the hosted OAuth connection option.
