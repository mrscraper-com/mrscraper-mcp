import {
  McpServer,
  type McpRequestContext,
  type McpServerFactory,
} from "@modelcontextprotocol/server";

import { resolveApiToken } from "./auth.js";
import { VERSION, type ToolSurface } from "./config.js";
import { registerTools, type ToolDependencies } from "./tools.js";
import { registerWidgets } from "./widgets/index.js";

export const SERVER_INSTRUCTIONS =
  "MrScraper provides seven services. `status`: Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields. `scrapeHtml`: Retrieve the raw HTML of a page. Browser rendering is optional. `scrapeMarkdown`: Retrieve a page as Markdown. Including HTML also enables browser rendering and returns both outputs as JSON. `getScreenshot`: Capture a base64 screenshot of the full page or top viewport. Browser rendering is always enabled. `scrapeBrand`: Extract a website's colors, typography, logos, and social links as JSON. `scrapeJson`: Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output. `webSearch`: Search the web and return ranked results with titles, URLs, descriptions, and sources. Scraping and search consume quota and require scrape:write. Tools authenticate through the MCP connection and do not accept tokens as arguments.";

export interface ServerFactoryOptions extends ToolDependencies {
  resolveToken?: (context: McpRequestContext) => string;
  surface?: ToolSurface;
}

export function createMrscraperServer(
  context: McpRequestContext,
  options: ServerFactoryOptions = {},
): McpServer {
  const server = new McpServer(
    { name: "MrScraper MCP Server", version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(
    server,
    () => (options.resolveToken || resolveApiToken)(context),
    options,
    options.surface,
  );
  registerWidgets(server);
  return server;
}

export function createServerFactory(
  options: ServerFactoryOptions = {},
): McpServerFactory {
  return (context) => createMrscraperServer(context, options);
}
