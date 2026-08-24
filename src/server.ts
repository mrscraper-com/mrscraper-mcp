import {
  McpServer,
  type McpRequestContext,
  type McpServerFactory,
} from "@modelcontextprotocol/server";

import { resolveApiToken } from "./auth.js";
import { MANUAL_SCRAPER_SERVER_INSTRUCTIONS } from "./compliance.js";
import { VERSION } from "./config.js";
import { registerTools, type ToolDependencies } from "./tools.js";
import { registerWidgets } from "./widgets/index.js";

export const SERVER_INSTRUCTIONS =
  "MrScraper provides seven web-data tools: `fetch`, `scrape`, `serp`, " +
  "`status`, `rerun`, `results`, and `result`. " +
  "For agent-led work, always use `fetch` for the first exploration of a known public URL and retain its raw response as the source of truth. " +
  "The agent should derive summaries, comparisons, fields, JSON, and tables locally from fetched content; a structured-output request alone is not a reason to call `scrape`. " +
  "When many pages share a layout, fetch representative pages, define one reusable local extractor, fetch the remaining pages, and apply that extractor across the saved responses. " +
  "For a 100-page job with shared structure, 100 fetches can run concurrently when safe and feed one local batch extraction; this is often faster than 100 separate backend-LLM extractions and preserves every raw input. " +
  "The `general` and `listing` scrape modes send page content through a backend LLM, which can omit source details and repeat model work. " +
  "Use them only when the user explicitly requests MrScraper-managed extraction or fetch-led exploration has established a stable output schema and a clear benefit. " +
  "The `map` scrape mode is separate bounded URL discovery within a known site. Use `serp` when starting from a Google query instead of a known URL, then use `fetch` for selected result pages that inform the answer. " +
  "After a successful `scrape`, surface its saved `scraperId` and explain that `rerun` can reproduce the saved extraction configuration on the same or another URL. " +
  "Use `rerun` for saved scraper configurations: `type` identifies an AI scraper or dashboard-built manual workflow, while `bulk` independently selects one URL or a URL list. " +
  "Bulk reruns are asynchronous; retain `bulkResultId` and use `result` to inspect them until completion. " +
  "Use `results` / `result` to inspect stored work. `status` reports account usage and optional domain outcomes. " +
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
  registerWidgets(server);
  return server;
}

export function createServerFactory(
  options: ServerFactoryOptions = {},
): McpServerFactory {
  return (context) => createMrscraperServer(context, options);
}
