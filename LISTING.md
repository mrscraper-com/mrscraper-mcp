<p align="center">
  <img src="https://raw.githubusercontent.com/mrscraper-com/mrscraper-mcp/main/assets/mrscraper-banner.jpeg" alt="MrScraper" width="100%">
</p>

<h1 align="center">MrScraper MCP Server</h1>

<p align="center">
  <b>The official Model Context Protocol (MCP) server for MrScraper: give your AI assistant live web data. Read any public page as Markdown, HTML, or a screenshot, search the web, and check your plan usage, through a hosted endpoint with browser sign-in or a local server you run yourself.</b>
</p>

<!-- Line 1 · Project -->
<p align="center">
  <a href="https://github.com/mrscraper-com/mrscraper-mcp"><img src="https://img.shields.io/badge/Official-MrScraper-1BD0EF?labelColor=0B1220" alt="Official MrScraper server"></a>
  <a href="https://www.npmjs.com/package/@mrscraper/mcp"><img src="https://img.shields.io/npm/v/%40mrscraper%2Fmcp?label=npm&color=1BD0EF&labelColor=0B1220" alt="npm version"></a>
  <a href="https://github.com/mrscraper-com/mrscraper-mcp/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mrscraper-com/mrscraper-mcp?label=License&color=1BD0EF&labelColor=0B1220" alt="License: MIT"></a>
  <a href="https://mcp.mrscraper.com/health"><img src="https://img.shields.io/badge/Hosted-mcp.mrscraper.com-2EBC4F?labelColor=0B1220" alt="Hosted at mcp.mrscraper.com"></a>
</p>

<!-- Line 2 · Protocol & access -->
<p align="center">
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/Model_Context_Protocol-compatible-000000?logo=modelcontextprotocol&logoColor=white" alt="Model Context Protocol compatible"></a>
  <a href="https://registry.modelcontextprotocol.io/v0/servers?search=io.github.mrscraper-com/mrscraper-mcp"><img src="https://img.shields.io/badge/MCP_Registry-io.github.mrscraper--com%2Fmrscraper--mcp-000000?logo=modelcontextprotocol&logoColor=white" alt="MCP Registry: io.github.mrscraper-com/mrscraper-mcp"></a>
  <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server#authentication"><img src="https://img.shields.io/badge/Auth-OAuth_2.1_%7C_API_key-2EBC4F" alt="Auth: OAuth 2.1 or API key"></a>
  <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server#quick-start-with-the-hosted-server"><img src="https://img.shields.io/badge/Transport-Streamable_HTTP_%7C_stdio-2EBC4F" alt="Transport: Streamable HTTP or stdio"></a>
</p>

<!-- Line 3 · Tools -->
<p align="center">
  <a href="#tools"><img src="https://img.shields.io/badge/scraperAPI-HTML_·_Markdown_·_Screenshot-1BD0EF?labelColor=0B1220" alt="scraperAPI: HTML, Markdown, screenshot"></a>
  <a href="#tools"><img src="https://img.shields.io/badge/webSearch-parsed_results-1BD0EF?labelColor=0B1220" alt="webSearch: parsed results"></a>
  <a href="#tools"><img src="https://img.shields.io/badge/status-plan_usage-1BD0EF?labelColor=0B1220" alt="status: plan usage"></a>
</p>

<p align="center">
  <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server"><b>Documentation</b></a> ·
  <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server#tool-reference"><b>Tool reference</b></a> ·
  <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server#security-behavior"><b>Security</b></a> ·
  <a href="mailto:support@mrscraper.com"><b>Support</b></a>
</p>

---

MrScraper MCP connects AI assistants and agents to MrScraper's web data service. Once connected, your assistant can retrieve any public web page, discover pages through web search, and check how many tokens your plan has left, without you copying pages into the chat.

With MrScraper MCP, you can:

- **Read a page.** Fetch a public page as Markdown, HTML, or a screenshot, or all three at once.
- **Read pages that need a browser.** Browser rendering starts automatically when a page needs it; you can also wait for an element to appear and load the page from a chosen country.
- **Search the web.** Get parsed results (rank, title, link, snippet) for a query, then fetch the pages you need.
- **Research and compare.** Combine search and page reads to compare pricing pages, product pages, or documentation across sites, with the source pages kept for reference.
- **Check your usage.** Ask how many tokens your plan has left.

## One-click setup

Pick your AI client. Each client signs you in to MrScraper in your browser the first time you use a tool, so there is no API key to paste.

<table align="center">
  <tr>
    <td align="center" width="200">
      <a href="https://cursor.com/en/install-mcp?name=MrScraper&config=eyJ1cmwiOiJodHRwczovL21jcC5tcnNjcmFwZXIuY29tL21jcCJ9">
        <img src="https://img.shields.io/badge/Cursor-000000?style=for-the-badge&logo=cursor&logoColor=white" alt="Add to Cursor"><br>
        <b>Add to Cursor</b>
      </a>
      <br><sub>One-click install.</sub>
    </td>
    <td align="center" width="200">
      <a href="https://vscode.dev/redirect/mcp/install?name=MrScraper&config=%7B%22url%22%3A%22https%3A%2F%2Fmcp.mrscraper.com%2Fmcp%22%2C%22type%22%3A%22http%22%7D">
        <img src="https://img.shields.io/badge/VS_Code-0098FF?style=for-the-badge" alt="Add to VS Code"><br>
        <b>Add to VS Code</b>
      </a>
      <br><sub>One-click install.</sub>
    </td>
    <td align="center" width="200">
      <a href="https://plugins.jetbrains.com/plugin/34889-mrscraper-mcp">
        <img src="https://img.shields.io/badge/JetBrains-000000?style=for-the-badge&logo=jetbrains&logoColor=white" alt="Get the JetBrains plugin"><br>
        <b>Get the JetBrains plugin</b>
      </a>
      <br><sub>For JetBrains AI agents.</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="200">
      <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server#claude-and-claude-desktop">
        <img src="https://img.shields.io/badge/Claude-D97757?style=for-the-badge&logo=claude&logoColor=white" alt="Add to Claude"><br>
        <b>Add to Claude</b>
      </a>
      <br><sub>As a custom connector.</sub>
    </td>
    <td align="center" width="200">
      <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server#claude-code">
        <img src="https://img.shields.io/badge/Claude_Code-D97757?style=for-the-badge&logo=claude&logoColor=white" alt="Add to Claude Code"><br>
        <b>Add to Claude Code</b>
      </a>
      <br><sub>One command.</sub>
    </td>
    <td align="center" width="200">
      <a href="https://docs.mrscraper.com/docs/getting-started/mcp-server#codex">
        <img src="https://img.shields.io/badge/Codex-000000?style=for-the-badge" alt="Add to Codex"><br>
        <b>Add to Codex</b>
      </a>
      <br><sub>One command.</sub>
    </td>
  </tr>
</table>

### Let your agent do the setup

Most AI coding agents can configure the server themselves. Paste this prompt into your agent:

```text
Connect MrScraper MCP to this agent. Detect the current MCP client and configure a Streamable HTTP server named mrscraper at https://mcp.mrscraper.com/mcp with no credential. The server uses OAuth 2.1, so the client will open a browser to sign in. If the client cannot do OAuth, fall back to a MrScraper API key from https://app.mrscraper.com/api-tokens stored through the client's environment-variable or secret-storage mechanism and sent as Authorization: Bearer <key>. Reload the MCP client when required, then list the tools and confirm that scraperAPI, webSearch, and status are the only available tools.
```

## Tools

| Tool         | What it does                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scraperAPI` | Retrieves a known URL as HTML, Markdown, a screenshot, or a combination. Options include browser rendering, waiting for a CSS selector, country, timeout, and retry limits. |
| `webSearch`  | Runs a web search from query text or a complete search results URL and returns parsed JSON or the result page HTML. Options include region, language, and page.             |
| `status`     | Returns the account's plan, token limit, token usage, remaining tokens, and rate limit.                                                                                     |

The web tools are read-only. Hosts that support MCP Apps also show a search results widget and an account usage meter.

## Connect manually

Endpoint (Streamable HTTP):

```text
https://mcp.mrscraper.com/mcp
```

Add the URL to your MCP client with no credential. The client opens your browser, you sign in to MrScraper and approve access, and the client stores the tokens. Use the URL exactly as shown, including `/mcp`.

Claude Code:

```bash
claude mcp add --transport http --scope user mrscraper https://mcp.mrscraper.com/mcp
```

Codex:

```bash
codex mcp add mrscraper --url https://mcp.mrscraper.com/mcp
```

Clients configured by file:

```json
{
  "mcpServers": {
    "mrscraper": {
      "url": "https://mcp.mrscraper.com/mcp"
    }
  }
}
```

### Permissions you approve

| Scope          | Allows       |
| -------------- | ------------ |
| `scrape:read`  | `webSearch`  |
| `scrape:write` | `scraperAPI` |
| `account:read` | `status`     |

You can disconnect a client at any time under Connected applications in your MrScraper account.

### Use an API key instead

Clients without OAuth can send a MrScraper API key, created at [app.mrscraper.com/api-tokens](https://app.mrscraper.com/api-tokens), as a bearer token:

```json
{
  "mcpServers": {
    "mrscraper": {
      "url": "https://mcp.mrscraper.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MRSCRAPER_API_KEY"
      }
    }
  }
}
```

An API key carries your full account access. Keep it in your client's secret or environment-variable storage, never in a shared project file.

## Run it locally

The same server is open source and published on npm as [`@mrscraper/mcp`](https://www.npmjs.com/package/@mrscraper/mcp). Local setups use a MrScraper API key instead of browser sign-in.

```bash
# stdio, for clients that start a local process; reads the key from MRSCRAPER_API_KEY
MRSCRAPER_API_KEY=YOUR_MRSCRAPER_API_KEY npx -y @mrscraper/mcp@latest

# local Streamable HTTP service; clients send the key as a bearer token
TRANSPORT=http npx -y @mrscraper/mcp@latest
```

## Plugins

MrScraper is also packaged as a plugin with the MCP server and skills for [Claude Code](https://github.com/mrscraper-com/mrscraper-claude-plugin) and [JetBrains IDEs](https://plugins.jetbrains.com/plugin/34889-mrscraper-mcp).

## Data and usage

- A MrScraper account is required. Each call uses tokens from your plan; see [mrscraper.com/pricing](https://mrscraper.com/pricing).
- MrScraper receives the URLs and tool inputs you send, including search queries, and returns the results to your client.
- Retrieve only content you are allowed to access, and follow each site's terms and MrScraper's [Acceptable Use Policy](https://mrscraper.com/acceptable-use-policy).

## Links

- Documentation: https://docs.mrscraper.com/docs/getting-started/mcp-server
- Source: https://github.com/mrscraper-com/mrscraper-mcp
- Official MCP Registry: `io.github.mrscraper-com/mrscraper-mcp`
- Privacy policy: https://mrscraper.com/privacy-policy
- Terms of use: https://mrscraper.com/terms-of-use
- Support: support@mrscraper.com
