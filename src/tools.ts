import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { getSubscriptionAccountApi, scraperApi, webSearchApi } from "./api.js";
import type { ApiResponse } from "./http.js";
import { summarizeSubscriptionAccount } from "./status.js";
import { widgetMeta } from "./widgets/index.js";

export interface ToolDependencies {
  fetchFn?: typeof fetch;
}

const apiResponseSchema = z.object({
  status_code: z
    .number()
    .int()
    .nullable()
    .describe("Upstream HTTP status, or null for a network failure."),
  data: z.json().describe("Response body as parsed JSON or text."),
  headers: z
    .record(z.string(), z.string())
    .describe("Response headers with credentials and cookies removed."),
  error: z.string().optional().describe("Request failure message, if any."),
});

export const scraperAPIOutputSchema = apiResponseSchema.meta({
  title: "Scraper API response",
  description:
    "Page content as HTML, Markdown, a screenshot, or a combination.",
});
export const webSearchOutputSchema = apiResponseSchema.meta({
  title: "Web search response",
  description:
    "Ranked web search results, each with rank, title, url, description, and source.",
});
export const statusOutputSchema = z
  .object({
    kind: z.literal("mrscraper-cli-status-summary").optional(),
    source_endpoints: z.array(z.string()).optional(),
    status_code: z.number().int().nullable(),
    data: z.json(),
    headers: z.record(z.string(), z.string()).optional(),
    error: z.string().optional(),
  })
  .meta({
    title: "Status response",
    description:
      "Account identity, subscription, token limit, token usage, and remaining tokens.",
  });

export const scraperAPIInputSchema = z.object({
  url: z
    .url({ protocol: /^https?$/ })
    .describe("Required absolute HTTP or HTTPS page URL."),
  html: z.boolean().default(true).describe("Request HTML page content."),
  markdown: z
    .boolean()
    .default(false)
    .describe("Request Markdown page content."),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(120)
    .describe(
      "Page timeout in seconds (1–300); transport allows 30 additional seconds.",
    ),
  geo_code: z
    .string()
    .default("US")
    .describe("Proxy geolocation country code, such as US, ID, or SG."),
  proxy_country: z
    .string()
    .nullable()
    .optional()
    .describe("Compatibility country option sent as proxyCountry."),
  block_resources: z
    .boolean()
    .nullable()
    .optional()
    .default(false)
    .describe("Block images, CSS, and fonts during loading."),
  browser_rendering: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "True forces browser rendering, false disables it; omit or use null for automatic fallback.",
    ),
  super: z
    .boolean()
    .default(false)
    .describe("Use real-device routing independently of browser rendering."),
  use_proxy: z
    .boolean()
    .default(true)
    .describe("Allow the service to use a configured proxy."),
  proxy: z
    .string()
    .nullable()
    .optional()
    .describe("Custom proxy in username:password@host:port form."),
  wait_for_selector: z
    .string()
    .nullable()
    .optional()
    .describe("CSS selector to wait for before returning page content."),
  home_page: z
    .boolean()
    .default(false)
    .describe(
      "Visit the site's root before the target URL; sent as warmStart=true.",
    ),
  screenshot: z
    .boolean()
    .default(false)
    .describe("Capture a screenshot; always enables browser rendering."),
  bypass_proxy: z
    .boolean()
    .default(false)
    .describe("Enable the API's proxy-bypass/resource-blocking behavior."),
  cookie_jar: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Cookie configuration string, such as domain=example.com&country=us&max_used=100&max_age=50m.",
    ),
  headers: z
    .union([z.record(z.string(), z.string()), z.string()])
    .nullable()
    .optional()
    .describe("Target page request headers as an object or JSON string."),
  max_retries: z
    .number()
    .int()
    .min(0)
    .default(3)
    .describe("Maximum Web Unblocker retries; 0 disables retries."),
  token_cap: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe("Optional nonnegative retry-token budget."),
  stream: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Ask the API to stream; the MCP server buffers the response into the normal envelope.",
    ),
  discard_token_secret: z
    .string()
    .default("")
    .describe("Optional value for the x-discard-token-secret upstream header."),
});

export const webSearchInputSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Required search query text. A search results URL also works; its q parameter becomes the query.",
    ),
  region: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "region must be a two-letter country code")
    .nullable()
    .optional()
    .describe(
      "Two-letter country code for the results, for example us or gb. Defaults to us.",
    ),
  num_results: z
    .number()
    .int()
    .min(10)
    .max(100)
    .nullable()
    .optional()
    .describe(
      "Number of results to return, from 10 to 100. Defaults to 10; fewer may come back.",
    ),
  timeout: z
    .number()
    .positive()
    .default(600)
    .describe("Local upstream HTTP deadline in seconds; not sent to the API."),
});

export async function scraperAPITool(
  token: string,
  input: z.infer<typeof scraperAPIInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  return scraperApi({
    token,
    url: input.url,
    html: input.html,
    markdown: input.markdown,
    timeout: input.timeout,
    geoCode: input.geo_code,
    proxyCountry: input.proxy_country,
    blockResources: input.block_resources,
    browserRendering: input.browser_rendering,
    super: input.super,
    useProxy: input.use_proxy,
    proxy: input.proxy,
    waitForSelector: input.wait_for_selector,
    homePage: input.home_page,
    screenshot: input.screenshot,
    bypassProxy: input.bypass_proxy,
    cookieJar: input.cookie_jar,
    headers: input.headers,
    maxRetries: input.max_retries,
    tokenCap: input.token_cap,
    stream: input.stream,
    discardTokenSecret: input.discard_token_secret,
    fetchFn: dependencies.fetchFn,
  });
}

export async function webSearchTool(
  token: string,
  input: z.infer<typeof webSearchInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  return webSearchApi({
    token,
    query: input.url,
    country: input.region,
    numResults: input.num_results,
    timeout: input.timeout,
    fetchFn: dependencies.fetchFn,
  });
}

export const statusInputSchema = z.object({});

function isApiFailure(result: Record<string, unknown>): boolean {
  return Boolean(
    result.error ||
    (typeof result.status_code === "number" && result.status_code >= 400),
  );
}

export async function statusTool(
  token: string,
  _input: z.infer<typeof statusInputSchema> = {},
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const response: ApiResponse = await getSubscriptionAccountApi(token, {
    fetchFn: dependencies.fetchFn,
  });
  if (isApiFailure(response)) return response;
  const body = response.data;
  const account =
    body && typeof body === "object" && !Array.isArray(body) && "data" in body
      ? body.data
      : body;
  return {
    kind: "mrscraper-cli-status-summary",
    source_endpoints: ["/subscription-accounts"],
    status_code: response.status_code,
    data: {
      account: summarizeSubscriptionAccount(
        account && typeof account === "object" && !Array.isArray(account)
          ? (account as Record<string, unknown>)
          : {},
      ),
    },
  };
}

function asStructured(result: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    ...(isApiFailure(result) ? { isError: true } : {}),
  };
}

const annotations = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
};

export const TOOL_DESCRIPTIONS = {
  scraperAPI:
    "Retrieves a known page through MrScraper's Scraper API as HTML, Markdown, a screenshot, or a combination. Matches the Python SDK's scraper_api options. Omit browser_rendering for automatic browser fallback; screenshot=true always enables it. super enables real-device routing independently. home_page maps to warmStart. Proxy, cookie, target-header, retry, and timeout options control page loading. Returns status_code, data, and sanitized headers.",
  webSearch:
    "Searches the web for query text passed as url and returns ranked results, each with rank, title, url, description, and source. region sets the results' country as a two-letter code (default us). num_results sets how many results to return, from 10 to 100 (default 10). A search results URL also works: its q parameter becomes the query. timeout controls the local request deadline. Returns status_code, data, and sanitized headers.",
  status:
    "Returns the connected MrScraper account's identity (name, email, and verification state), subscription status, token limit, token usage, remaining tokens, and rate limit. Use it to check the account and remaining quota, for example before a large batch of requests. It takes no input and reports account usage, not the progress of a request.",
} as const;

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
): void {
  server.registerTool(
    "scraperAPI",
    {
      title: "Scraper API",
      annotations: { title: "Scraper API", ...annotations },
      description: TOOL_DESCRIPTIONS.scraperAPI,
      inputSchema: scraperAPIInputSchema,
      outputSchema: scraperAPIOutputSchema,
    },
    async (input) =>
      asStructured(await scraperAPITool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "webSearch",
    {
      title: "Web Search",
      annotations: { title: "Web Search", ...annotations },
      description: TOOL_DESCRIPTIONS.webSearch,
      inputSchema: webSearchInputSchema,
      outputSchema: webSearchOutputSchema,
      _meta: widgetMeta("webSearch", "Searching the web…", "Search complete."),
    },
    async (input) =>
      asStructured(await webSearchTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "status",
    {
      title: "Account Status",
      annotations: {
        title: "Account Status",
        readOnlyHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
      description: TOOL_DESCRIPTIONS.status,
      inputSchema: statusInputSchema,
      outputSchema: statusOutputSchema,
      _meta: widgetMeta(
        "status",
        "Checking your account…",
        "Account status loaded.",
      ),
    },
    async (input) =>
      asStructured(await statusTool(getToken(), input, dependencies)),
  );
}
