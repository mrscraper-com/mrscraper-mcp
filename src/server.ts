import {
  McpServer,
  type McpRequestContext,
  type McpServerFactory,
} from "@modelcontextprotocol/server";

import { resolveApiToken } from "./auth.js";
import { VERSION } from "./config.js";
import { registerTools, type ToolDependencies } from "./tools.js";
import { registerWidgets } from "./widgets/index.js";

export const SERVER_INSTRUCTIONS =
  "MrScraper provides three tools. `scraperAPI` retrieves a known page as HTML, Markdown, or a screenshot. " +
  "`webSearch` searches the web from query text or a search results URL; use raw=false and format=json for parsed results. " +
  "`status` reports the connected account's plan, token usage, and remaining tokens. " +
  "Tools authenticate through the MCP connection and do not accept API tokens as arguments.";

export interface ServerFactoryOptions extends ToolDependencies {
  resolveToken?: (context: McpRequestContext) => string;
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
  );
  registerWidgets(server);
  return server;
}

export function createServerFactory(
  options: ServerFactoryOptions = {},
): McpServerFactory {
  return (context) => createMrscraperServer(context, options);
}
