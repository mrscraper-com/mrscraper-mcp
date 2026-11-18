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
  "MrScraper provides seven services: `account` checks account usage; `scrapeHtml` retrieves HTML; " +
  "`scrapeMarkdown` retrieves Markdown; `getScreenshot` captures full-page or top-viewport screenshots; " +
  "`scrapeBrand` extracts brand data; `scrapeJson` extracts structured JSON; `webSearch` returns ranked web results. " +
  "Scraping and search consume quota and require scrape:write. Tools authenticate through the MCP connection and do not accept tokens as arguments.";

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
