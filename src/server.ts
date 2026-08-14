import {
  McpServer,
  type McpRequestContext,
  type McpServerFactory,
} from "@modelcontextprotocol/server";

import { resolveApiToken } from "./auth.js";
import { MANUAL_SCRAPER_SERVER_INSTRUCTIONS } from "./compliance.js";
import { VERSION } from "./config.js";
import { registerTools, type ToolDependencies } from "./tools.js";

export const SERVER_INSTRUCTIONS =
  "MrScraper tools use the same data-command names and behavior as @mrscraper/cli: " +
  "`fetch`, `scrape`, `serp`, `status`, `rerun`, `results`, and `result`. " +
  "Use `fetch` for readable page content, `scrape` for requested structured fields, " +
  "and `serp` when starting from a Google query instead of a known URL. " +
  "Use `rerun` for saved AI or manual scraper configurations and `results` / `result` " +
  "to inspect stored work. `status` reports account usage and optional domain outcomes. " +
  "Tools do not accept API tokens as arguments. " +
  MANUAL_SCRAPER_SERVER_INSTRUCTIONS;

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
  return server;
}

export function createServerFactory(
  options: ServerFactoryOptions = {},
): McpServerFactory {
  return (context) => createMrscraperServer(context, options);
}
