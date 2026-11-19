import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  DEFAULT_JSON_PROMPT,
  WAIT_UNTIL_EVENTS,
  getScreenshot,
  getSubscriptionAccountApi,
  scrapeBrand,
  scrapeHtml,
  scrapeJson,
  scrapeMarkdown,
  webSearch,
} from "./api.js";
import type { ToolName, ToolSurface } from "./config.js";
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

const country = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "must be a two-letter country code")
  .toLowerCase()
  .default("us");

const pageOptions = {
  url: z
    .url({ protocol: /^https?$/ })
    .describe("Absolute HTTP or HTTPS page URL."),
  super: z
    .boolean()
    .default(false)
    .describe("Route the request through real devices."),
  waitUntil: z
    .enum(WAIT_UNTIL_EVENTS)
    .default("domcontentloaded")
    .describe("Navigation event that completes page loading."),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(300)
    .describe(
      "Page load timeout in seconds, 1–300; the request allows 30 seconds more.",
    ),
  geoCode: country.describe("Two-letter country code to load the page from."),
  proxyCountry: country.describe(
    "Two-letter country code of the proxy server.",
  ),
  proxy: z
    .string()
    .trim()
    .min(1)
    .nullish()
    .describe("Your own proxy, such as http://user:pass@host:port."),
  maxRetries: z
    .number()
    .int()
    .min(0)
    .nullish()
    .describe("Maximum retries; omit for no limit."),
  saveResult: z
    .boolean()
    .default(false)
    .describe("Save the result to the dashboard Result tab."),
};

const loadingOptions = {
  waitForSelector: z
    .string()
    .trim()
    .min(1)
    .nullish()
    .describe("CSS selector to wait for before returning."),
  blockResources: z
    .boolean()
    .default(false)
    .describe("Block images, fonts, and stylesheets."),
  returnCookie: z
    .boolean()
    .default(false)
    .describe("Include the browser session cookies."),
};

const browserRendering = z
  .boolean()
  .default(false)
  .describe("Render the page in Chromium.");

export const scrapeHtmlInputSchema = z.strictObject({
  ...pageOptions,
  ...loadingOptions,
  browserRendering,
});

export const scrapeMarkdownInputSchema = scrapeHtmlInputSchema.extend({
  html: z
    .boolean()
    .default(false)
    .describe("Also return the page HTML; renders the page in Chromium."),
});

export const getScreenshotInputSchema = z.strictObject({
  ...pageOptions,
  ...loadingOptions,
  screenshot: z
    .enum(["full", "top"])
    .default("full")
    .describe("Capture the full page or the top viewport."),
  html: z.boolean().default(true).describe("Include the page HTML."),
  markdown: z.boolean().default(false).describe("Include the page Markdown."),
});

export const scrapeBrandInputSchema = z.strictObject({ url: pageOptions.url });

export const scrapeJsonInputSchema = z.strictObject({
  ...pageOptions,
  prompt: z
    .string()
    .trim()
    .min(1)
    .default(DEFAULT_JSON_PROMPT)
    .describe(
      "Data to extract; append 'Json Schema:' and a JSON schema to shape it.",
    ),
  browserRendering,
  html: z.boolean().default(false).describe("Also return the page HTML."),
  screenshot: z
    .boolean()
    .default(false)
    .describe("Also return a base64 screenshot."),
});

export const webSearchInputSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => [...value].length <= 1000,
      "query must be 1 to 1000 characters",
    )
    .describe("Search query, 1–1000 characters."),
  country: country.describe("Two-letter country code to search from."),
  numResults: z
    .number()
    .int()
    .min(10)
    .max(100)
    .default(10)
    .describe("Number of results, 10–100; fewer may be returned."),
});

export const statusInputSchema = z.object({});

// ChatGPT and Codex get the basic page controls; hidden options keep their defaults.
const CHATGPT_HIDDEN_OPTIONS: Record<string, true> = {
  super: true,
  proxyCountry: true,
  proxy: true,
  maxRetries: true,
  saveResult: true,
  blockResources: true,
  returnCookie: true,
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Mirrors the CLI: HTTP errors, `success: false`, `error` bodies, and failed brand jobs. */
function isApiFailure(result: Record<string, unknown>): boolean {
  const body = asRecord(result.data);
  const job = asRecord(body?.data);
  return Boolean(
    result.error ||
    (typeof result.status_code === "number" && result.status_code >= 400) ||
    body?.success === false ||
    (typeof body?.error === "string" && body.error.length > 0) ||
    (job?.job_id &&
      (job.status === "failed" ||
        (typeof job.error === "string" && job.error.length > 0))),
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
  const body = asRecord(response.data);
  const account = body && "data" in body ? body.data : response.data;
  return {
    kind: "mrscraper-cli-status-summary",
    source_endpoints: ["/subscription-accounts"],
    status_code: response.status_code,
    data: {
      account: summarizeSubscriptionAccount(asRecord(account) ?? {}),
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

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  scrapeHtml:
    "Retrieves the raw HTML of a web page. browserRendering renders the page in Chromium; waitUntil, waitForSelector, and timeout control when loading completes, and geoCode sets the country the page loads from. Returns status_code, data (the HTML), and sanitized headers.",
  scrapeMarkdown:
    "Retrieves a web page as clean Markdown, without navigation, scripts, or ads. html=true also returns the page HTML, rendered in Chromium, as JSON holding both. browserRendering, waitUntil, waitForSelector, timeout, and geoCode control page loading. Returns status_code, data, and sanitized headers.",
  getScreenshot:
    "Captures a base64-encoded screenshot of a web page rendered in Chromium: the entire page with screenshot=full (default) or the top viewport with screenshot=top. The response also holds the page HTML unless html=false, and Markdown when markdown=true. Returns status_code, data, and sanitized headers.",
  scrapeBrand:
    "Extracts a website's brand as JSON: colors, typography, logos, icons, social links, and metadata. Returns status_code, data with the job_id, status, and brand, and sanitized headers.",
  scrapeJson:
    "Extracts structured JSON from a web page using a natural-language prompt and the general agent. Appending 'Json Schema:' and a JSON schema to the prompt shapes the output. html=true and screenshot=true also return the page HTML and a base64 screenshot. Returns status_code, data, and sanitized headers.",
  webSearch:
    "Searches the web for a query and returns ranked results, each with rank, title, url, description, and source. country sets the two-letter country to search from (default us). numResults sets how many results to return, from 10 to 100 (default 10); fewer may come back. Returns status_code, data, and sanitized headers.",
  status:
    "Returns the connected MrScraper account's identity (name, email, and verification state), subscription status, token limit, token usage, remaining tokens, and rate limit. Use it to check the account and remaining quota, for example before a large batch of requests. It takes no input and reports account usage, not the progress of a request.",
};

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
  surface: ToolSurface = "default",
): void {
  const registerWebTool = <S extends z.ZodObject>(
    name: Exclude<ToolName, "status">,
    title: string,
    inputSchema: S,
    call: (
      token: string,
      input: z.output<S>,
      dependencies: ToolDependencies,
    ) => Promise<ApiResponse>,
    meta?: Record<string, unknown>,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description: TOOL_DESCRIPTIONS[name],
        inputSchema:
          surface === "chatgpt"
            ? z.strictObject(
                Object.fromEntries(
                  Object.entries(inputSchema.shape).filter(
                    ([key]) => !Object.hasOwn(CHATGPT_HIDDEN_OPTIONS, key),
                  ),
                ),
              )
            : inputSchema,
        outputSchema: apiResponseSchema,
        annotations: {
          title,
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
        _meta: meta,
      },
      // The full schema also supplies defaults for options hidden from ChatGPT.
      async (input) =>
        asStructured(
          await call(getToken(), inputSchema.parse(input), dependencies),
        ),
    );
  };

  registerWebTool(
    "scrapeHtml",
    "Scrape HTML",
    scrapeHtmlInputSchema,
    scrapeHtml,
  );
  registerWebTool(
    "scrapeMarkdown",
    "Scrape Markdown",
    scrapeMarkdownInputSchema,
    scrapeMarkdown,
  );
  registerWebTool(
    "getScreenshot",
    "Get Screenshot",
    getScreenshotInputSchema,
    getScreenshot,
  );
  registerWebTool(
    "scrapeBrand",
    "Scrape Brand",
    scrapeBrandInputSchema,
    scrapeBrand,
  );
  registerWebTool(
    "scrapeJson",
    "Scrape JSON",
    scrapeJsonInputSchema,
    scrapeJson,
  );
  registerWebTool(
    "webSearch",
    "Web Search",
    webSearchInputSchema,
    webSearch,
    widgetMeta("webSearch", "Searching the web…", "Search complete."),
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
