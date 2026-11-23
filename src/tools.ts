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
  .describe("Absolute HTTP or HTTPS URL of the page to process.");
const country = z
  .string()
  .regex(/^[A-Za-z]{2}$/)
  .default("us")
  .describe("Two-letter country code to search from, sent in lowercase.");
const page = {
  url,
  timeout: z
    .number()
    .int()
    .min(1)
    .max(300)
    .default(300)
    .describe(
      "Page load timeout in seconds, from 1 to 300. The HTTP request allows 30 additional seconds.",
    ),
  geoCode: country.describe(
    "Two-letter country code to load the page from, sent in lowercase.",
  ),
  proxyCountry: country.describe(
    "Two-letter country code of the proxy server, sent in lowercase.",
  ),
  super: z
    .boolean()
    .default(false)
    .describe("Whether to route the request through real devices."),
  waitUntil: z
    .enum(["domcontentloaded", "load", "networkidle0", "networkidle2"])
    .default("domcontentloaded")
    .describe(
      "Navigation completion event to wait for: domcontentloaded, load, networkidle0, or networkidle2.",
    ),
  proxy: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Custom proxy URL used to load the page."),
  maxRetries: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Maximum number of retries, as a nonnegative integer. Omit this parameter for no limit.",
    ),
  saveResult: z
    .boolean()
    .default(false)
    .describe("Whether to save the result to the dashboard Result tab."),
};
const loading = {
  blockResources: z
    .boolean()
    .default(false)
    .describe(
      "Whether to block images, fonts, and stylesheets while loading the page.",
    ),
  waitForSelector: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Wait for the page to contain the specified CSS selector before returning the result.",
    ),
  returnCookie: z
    .boolean()
    .default(false)
    .describe("Whether to include browser session cookies in the response."),
};
export const scrapeHtmlInputSchema = z
  .object({
    ...page,
    ...loading,
    warmStart: z
      .boolean()
      .default(false)
      .describe(
        "Whether to enable warm start for more reliable scraping, at the cost of additional latency.",
      ),
    browserRendering: z
      .boolean()
      .default(false)
      .describe(
        "Whether to render the page in a browser before returning the result.",
      ),
  })
  .strict();
export const scrapeMarkdownInputSchema = scrapeHtmlInputSchema.extend({
  html: z
    .boolean()
    .default(false)
    .describe("Whether to include the page HTML in the response."),
});
export const getScreenshotInputSchema = z
  .object({
    ...page,
    ...loading,
    screenshot: z
      .enum(["full", "top"])
      .default("full")
      .describe(
        "Screenshot area to capture: full for the entire page or top for the top viewport.",
      ),
    html: z
      .boolean()
      .default(true)
      .describe("Whether to include the page HTML in the response."),
    markdown: z
      .boolean()
      .default(false)
      .describe("Whether to include the page Markdown in the response."),
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
        "Instructions describing the data to extract. Append Json Schema: and a JSON schema to shape the output.",
      ),
    browserRendering: z
      .boolean()
      .default(false)
      .describe(
        "Whether to render the page in a browser before returning the result.",
      ),
    html: z
      .boolean()
      .default(false)
      .describe("Whether to include the page HTML in the response."),
    screenshot: z
      .boolean()
      .default(false)
      .describe("Whether to include a base64 screenshot in the response."),
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
      .describe(
        "Search query text, trimmed before sending, containing 1 to 1000 characters.",
      ),
    country,
    numResults: z
      .number()
      .int()
      .min(10)
      .max(100)
      .default(10)
      .describe(
        "Number of search results to request, as an integer from 10 to 100. Fewer results may be returned.",
      ),
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
    "Return the raw account status API response without summarizing, redacting body fields, or adding calculated fields.",
  scrapeHtml: "Retrieve the raw HTML of a page. Browser rendering is optional.",
  scrapeMarkdown:
    "Retrieve a page as Markdown. Including HTML also enables browser rendering and returns both outputs as JSON.",
  getScreenshot:
    "Capture a base64 screenshot of the full page or top viewport. Browser rendering is always enabled.",
  scrapeBrand:
    "Extract a website's colors, typography, logos, and social links as JSON.",
  scrapeJson:
    "Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.",
  webSearch:
    "Search the web and return ranked results with titles, URLs, descriptions, and sources.",
} as const;

// ChatGPT and Codex sign-ins get the page tools without the proxy, real-device, retry, cookie
// and warm-start inputs, which OpenAI's review read as getting around site restrictions
// (3 Nov 2026). A call that sets one is rejected. They send no proxy country, and the other
// hidden inputs keep their defaults.
export const CHATGPT_HIDDEN_INPUTS = [
  "proxy",
  "proxyCountry",
  "super",
  "maxRetries",
  "returnCookie",
  "warmStart",
] as const;
export function inputSchemaFor(
  schema: z.ZodObject,
  surface: ToolSurface,
): z.ZodObject {
  if (surface !== "chatgpt") return schema;
  const hidden: Record<string, true> = {};
  for (const name of CHATGPT_HIDDEN_INPUTS) {
    if (Object.hasOwn(schema.shape, name)) hidden[name] = true;
  }
  return schema.omit(hidden);
}

// The ChatGPT surface sends no proxy country; every other client sends the default, us.
function hiddenInputValues(surface: ToolSurface) {
  return surface === "chatgpt" ? { proxyCountry: null } : {};
}
export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
  surface: ToolSurface = "default",
): void {
  const hidden = hiddenInputValues(surface);
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
  const scrapeHtmlSchema = inputSchemaFor(scrapeHtmlInputSchema, surface);
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
          ...hidden,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
  const scrapeMarkdownSchema = inputSchemaFor(
    scrapeMarkdownInputSchema,
    surface,
  );
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
          ...hidden,
          token: getToken(),
          ...dependencies,
        }),
      );
    },
  );
  const getScreenshotSchema = inputSchemaFor(getScreenshotInputSchema, surface);
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
          ...hidden,
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
  const scrapeJsonSchema = inputSchemaFor(scrapeJsonInputSchema, surface);
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
          ...hidden,
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
