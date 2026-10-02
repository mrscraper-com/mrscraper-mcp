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
  "MrScraper provides seven web-data tools. `fetch` returns a known page's raw response through Web Unblocker. " +
  "`scrape` runs MrScraper's managed extraction or URL mapping and saves the configuration as a reusable scraper. " +
  "`serp` returns Google search results. `rerun` runs a saved scraper on the same or new URLs. " +
  "`results` lists stored results, `result` returns one stored result or an asynchronous job's state, and `status` reports account usage. " +
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
