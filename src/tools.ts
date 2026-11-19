import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  scrapeHtml,
  scrapeMarkdown,
  getScreenshot,
  scrapeBrand,
  scrapeJson,
  webSearch,
  getSubscriptionAccountApi,
} from "./api.js";
import { type ToolSurface } from "./config.js";
import { widgetMeta } from "./widgets/index.js";

export interface ToolDependencies {
  fetchFn?: typeof fetch;
}
export const apiResponseSchema = z.object({
  status_code: z
    .number()
    .int()
    .nullable()
    .describe("Upstream HTTP status, or null for a network failure."),
  data: z.json().describe("Parsed response JSON or text."),
  headers: z
    .record(z.string(), z.string())
    .describe("Response headers with credentials removed."),
  error: z.string().optional(),
});
const url = z
  .url({ protocol: /^https?$/ })
  .describe("Absolute HTTP or HTTPS page URL.");
const country = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .default("us");
const page = {
  url,
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(300)
    .describe("Page timeout in seconds; transport adds 30 seconds."),
  geoCode: country.describe("Country to load the page from."),
  proxyCountry: country.describe("Country of the proxy server."),
  super: z.boolean().default(false).describe("Use real-device routing."),
  waitUntil: z
    .enum(["domcontentloaded", "load", "networkidle0", "networkidle2"])
    .default("domcontentloaded"),
  proxy: z.string().trim().min(1).optional().describe("Custom proxy URL."),
  maxRetries: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Retry limit; omit for no limit."),
  saveResult: z
    .boolean()
    .default(false)
    .describe("Save the result to the dashboard."),
};
const loading = {
  blockResources: z
    .boolean()
    .default(false)
    .describe("Block images, fonts, and stylesheets."),
  waitForSelector: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("CSS selector to wait for."),
  returnCookie: z
    .boolean()
    .default(false)
    .describe("Include browser session cookies."),
};
export const scrapeHtmlInputSchema = z
  .object({ ...page, ...loading, browserRendering: z.boolean().default(false) })
  .strict();
export const scrapeMarkdownInputSchema = scrapeHtmlInputSchema.extend({
  html: z
    .boolean()
    .default(false)
    .describe("Also return HTML; enables browser rendering."),
});
export const getScreenshotInputSchema = z
  .object({
    ...page,
    ...loading,
    screenshot: z.enum(["full", "top"]).default("full"),
    html: z.boolean().default(true),
    markdown: z.boolean().default(false),
  })
  .strict();
export const scrapeBrandInputSchema = z.object({ url }).strict();
export const scrapeJsonInputSchema = z
  .object({
    ...page,
    prompt: z
      .string()
      .min(1)
      .refine((value) => Boolean(value.trim()), "prompt must be non-empty")
      .default("Extract all data as complete as possible.")
      .describe(
        "Extraction instruction; append Json Schema: and a schema to shape output.",
      ),
    browserRendering: z.boolean().default(false),
    html: z.boolean().default(false),
    screenshot: z.boolean().default(false),
  })
  .strict();
export const webSearchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => [...value].length <= 1000,
        "query must be 1 to 1000 characters",
      )
      .describe("Search query text."),
    country,
    numResults: z.number().int().min(10).max(100).default(10),
  })
  .strict();
export const statusInputSchema = z.object({}).strict();
export const statusOutputSchema = apiResponseSchema;

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
  return getSubscriptionAccountApi(token, dependencies);
}

function asStructured(result: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    ...(isApiFailure(result) ? { isError: true } : {}),
  };
}
export const TOOL_DESCRIPTIONS = {
  status:
    "Return the raw account status API response without summarizing or adding fields.",
  scrapeHtml:
    "Retrieve raw HTML from a known public page. Supports optional browser rendering, page loading, proxies, and dashboard saving. Consumes API quota.",
  scrapeMarkdown:
    "Retrieve clean Markdown from a known page. html=true also returns HTML and forces browser rendering. Consumes API quota.",
  getScreenshot:
    "Capture a base64 screenshot of a full page or top viewport. Browser rendering is always enabled. Consumes API quota.",
  scrapeBrand:
    "Extract a website brand as JSON with bundle=none. Consumes API quota.",
  scrapeJson:
    "Extract structured JSON with the general agent. Append Json Schema: and a schema to the prompt to shape output. Long prompts use POST automatically. Consumes API quota.",
  webSearch:
    "Search the web for query text and return ranked titles, URLs, descriptions, and sources. Country defaults to us; numResults is 10 to 100. Consumes API quota.",
} as const;

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
  _surface: ToolSurface = "default",
): void {
  server.registerTool(
    "status",
    {
      title: "Account Status",
      description: TOOL_DESCRIPTIONS.status,
      inputSchema: statusInputSchema,
      outputSchema: statusOutputSchema,
      annotations: {
        title: "Account Status",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: widgetMeta(
        "status",
        "Checking your account…",
        "Account status loaded.",
      ),
    },
    async (input) =>
      asStructured(await statusTool(getToken(), input, dependencies)),
  );
  const scrapeHtmlSchema = scrapeHtmlInputSchema;
  server.registerTool(
    "scrapeHtml",
    {
      title: "Scrape HTML",
      description: TOOL_DESCRIPTIONS.scrapeHtml,
      inputSchema: scrapeHtmlSchema,
      outputSchema: apiResponseSchema,
      annotations: {
        title: "Scrape HTML",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const { url, ...options } = scrapeHtmlInputSchema.parse(input);
      return asStructured(
        await scrapeHtml(url, {
          ...options,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
  const scrapeMarkdownSchema = scrapeMarkdownInputSchema;
  server.registerTool(
    "scrapeMarkdown",
    {
      title: "Scrape Markdown",
      description: TOOL_DESCRIPTIONS.scrapeMarkdown,
      inputSchema: scrapeMarkdownSchema,
      outputSchema: apiResponseSchema,
      annotations: {
        title: "Scrape Markdown",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const { url, ...options } = scrapeMarkdownInputSchema.parse(input);
      return asStructured(
        await scrapeMarkdown(url, {
          ...options,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
  const getScreenshotSchema = getScreenshotInputSchema;
  server.registerTool(
    "getScreenshot",
    {
      title: "Get Screenshot",
      description: TOOL_DESCRIPTIONS.getScreenshot,
      inputSchema: getScreenshotSchema,
      outputSchema: apiResponseSchema,
      annotations: {
        title: "Get Screenshot",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const { url, ...options } = getScreenshotInputSchema.parse(input);
      return asStructured(
        await getScreenshot(url, {
          ...options,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
  const scrapeBrandSchema = scrapeBrandInputSchema;
  server.registerTool(
    "scrapeBrand",
    {
      title: "Scrape Brand",
      description: TOOL_DESCRIPTIONS.scrapeBrand,
      inputSchema: scrapeBrandSchema,
      outputSchema: apiResponseSchema,
      annotations: {
        title: "Scrape Brand",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const { url, ...options } = scrapeBrandInputSchema.parse(input);
      return asStructured(
        await scrapeBrand(url, {
          ...options,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
  const scrapeJsonSchema = scrapeJsonInputSchema;
  server.registerTool(
    "scrapeJson",
    {
      title: "Scrape JSON",
      description: TOOL_DESCRIPTIONS.scrapeJson,
      inputSchema: scrapeJsonSchema,
      outputSchema: apiResponseSchema,
      annotations: {
        title: "Scrape JSON",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const { url, ...options } = scrapeJsonInputSchema.parse(input);
      return asStructured(
        await scrapeJson(url, {
          ...options,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
  const webSearchSchema = webSearchInputSchema;
  server.registerTool(
    "webSearch",
    {
      title: "Web Search",
      description: TOOL_DESCRIPTIONS.webSearch,
      inputSchema: webSearchSchema,
      outputSchema: apiResponseSchema,
      annotations: {
        title: "Web Search",
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: widgetMeta("webSearch", "Searching the web…", "Search complete."),
    },
    async (input) => {
      const { query, ...options } = webSearchInputSchema.parse(input);
      return asStructured(
        await webSearch(query, {
          ...options,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
}
