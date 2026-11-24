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
  isScreenshotArea,
  MAX_AGE_LIMIT,
  SCREENSHOT_AREA_PATTERN,
} from "./api.js";
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
  .describe("URL of the page to scrape. Must include the protocol (https://).");
const countryCode = z.string().regex(/^[A-Za-z]{2}$/);
// Inputs the caller may leave out are optional without a default, so nothing is sent for them
// and the API's own defaults apply.
const browserRendering = z
  .boolean()
  .optional()
  .describe(
    "Controls whether the page is loaded in a browser. Leave it out to load the page without a browser first and switch to a browser automatically if the request is blocked. Set true to always load the page in a browser, which JavaScript-heavy sites, SPAs, and pages that load content dynamically need. Set false to never use a browser.",
  );
const timeout = z
  .number()
  .int()
  .min(1)
  .max(330)
  .optional()
  .describe(
    "Maximum seconds to wait for the scrape before the request times out, from 1 to 330. Increase for slow or complex pages. Defaults to 300.",
  );
const warmStart = z
  .boolean()
  .optional()
  .describe(
    "Opens the site's home page first to warm the session before loading the target URL. Useful for sites that expect a normal browsing session before deeper pages.",
  );
const blockResources = z
  .boolean()
  .optional()
  .describe(
    "Blocks images, fonts, and stylesheets from loading. Speeds up scraping and reduces bandwidth usage.",
  );
const waitForSelector = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .optional()
  .describe(
    "Waits until a specific CSS selector or text appears on the page before returning it, such as #results. Up to 500 characters. Useful for content that loads asynchronously after the initial page load.",
  );
const geoCode = countryCode
  .optional()
  .describe(
    "Two-letter country code to load the page from, such as us or gb. Defaults to the United States.",
  );
const maxAge = z
  .number()
  .int()
  .min(0)
  .max(MAX_AGE_LIMIT)
  .default(0)
  .describe(
    "Serves a cached result of the same request when it is newer than this age, in milliseconds, such as 86400000 for 1 day. Up to 604800000 (7 days). 0, the default, always scrapes fresh. A cached result costs the same tokens as the original scrape.",
  );
const maxRetries = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe("Maximum number of retries for the request. Omit for no limit.");
const screenshotArea = z
  .string()
  .regex(SCREENSHOT_AREA_PATTERN)
  .refine(
    isScreenshotArea,
    "Width and height must be 100 to 3840 and zoom 25 to 300.",
  );
export const scrapeHtmlInputSchema = z
  .object({
    url,
    browserRendering,
    timeout,
    warmStart,
    blockResources,
    waitForSelector,
    geoCode,
    maxAge,
    maxRetries,
    screenshot: screenshotArea
      .optional()
      .describe(
        "Also captures a screenshot of the rendered page as a base64-encoded PNG: full captures the entire scroll height, top captures the first viewport, and <width>x<height> sets the viewport size in pixels with an optional -<zoom> percent, such as 1280x800 or 1920x1080-75. Width and height range from 100 to 3840, zoom from 25 to 300. Setting it forces browser rendering. Leave it out for no screenshot.",
      ),
  })
  .strict();
export const scrapeMarkdownInputSchema = z
  .object({
    url,
    browserRendering,
    timeout,
    geoCode,
    warmStart,
    blockResources,
    waitForSelector,
    maxAge,
    maxRetries,
  })
  .strict();
export const getScreenshotInputSchema = z
  .object({
    url,
    screenshot: screenshotArea
      .default("full")
      .describe(
        "Screenshot area: full captures the entire scroll height (the default), top captures the first viewport, and <width>x<height> sets the viewport size in pixels with an optional -<zoom> percent, such as 1280x800 or 1920x1080-75. Width and height range from 100 to 3840, zoom from 25 to 300. The image is a base64-encoded PNG.",
      ),
    timeout,
    geoCode,
    waitForSelector,
    maxAge,
    maxRetries,
  })
  .strict();
export const scrapeBrandInputSchema = z.object({ url }).strict();
export const scrapeJsonInputSchema = z
  .object({
    url,
    prompt: z
      .string()
      .min(1)
      .refine((value) => Boolean(value.trim()), "prompt must be non-empty")
      .optional()
      .describe(
        'Description of the data shape you want back, for example fields like title, price, and rating. The prompt only parses the scraped content; it cannot instruct the scraper itself. To shape the output with a JSON schema, append it to the prompt as a Json Schema: section. Defaults to "Extract all data as complete as possible."',
      ),
    html: z
      .boolean()
      .default(true)
      .describe(
        "Returns the raw HTML of the scraped page in the response. On by default; set false to leave it out.",
      ),
    screenshot: z
      .boolean()
      .default(false)
      .describe(
        "Captures a screenshot of the rendered page as a base64-encoded image. Useful for verifying what the scraper actually saw. Off by default.",
      ),
    browserRendering,
    waitForSelector,
    warmStart,
    blockResources,
    timeout,
    geoCode,
    maxAge,
    maxRetries,
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
      .describe("The search query, from 1 to 1000 characters."),
    country: countryCode
      .optional()
      .describe(
        "Two-letter country code to run the search from. Defaults to the United States.",
      ),
    numResults: z
      .number()
      .int()
      .min(10)
      .max(100)
      .optional()
      .describe(
        "How many results to return, from 10 to 100. The search may return fewer. Defaults to 10.",
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
  scrapeHtml:
    "Retrieve the raw HTML of a page. Browser rendering and a screenshot are optional.",
  scrapeMarkdown: "Retrieve a page as Markdown. Browser rendering is optional.",
  getScreenshot:
    "Capture a base64 PNG screenshot of the full page, the top viewport, or a custom viewport size. Browser rendering is always enabled.",
  scrapeBrand:
    "Extract a website's colors, typography, logos, and social links as JSON.",
  scrapeJson:
    "Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.",
  webSearch:
    "Search the web and return ranked results with titles, URLs, descriptions, and sources.",
} as const;

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
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
  server.registerTool(
    "scrapeHtml",
    {
      title: "Scrape HTML",
      description: TOOL_DESCRIPTIONS.scrapeHtml,
      inputSchema: scrapeHtmlInputSchema,
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
  server.registerTool(
    "scrapeMarkdown",
    {
      title: "Scrape Markdown",
      description: TOOL_DESCRIPTIONS.scrapeMarkdown,
      inputSchema: scrapeMarkdownInputSchema,
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
  server.registerTool(
    "getScreenshot",
    {
      title: "Get Screenshot",
      description: TOOL_DESCRIPTIONS.getScreenshot,
      inputSchema: getScreenshotInputSchema,
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
  server.registerTool(
    "scrapeBrand",
    {
      title: "Scrape Brand",
      description: TOOL_DESCRIPTIONS.scrapeBrand,
      inputSchema: scrapeBrandInputSchema,
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
  server.registerTool(
    "scrapeJson",
    {
      title: "Scrape JSON",
      description: TOOL_DESCRIPTIONS.scrapeJson,
      inputSchema: scrapeJsonInputSchema,
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
  server.registerTool(
    "webSearch",
    {
      title: "Web Search",
      description: TOOL_DESCRIPTIONS.webSearch,
      inputSchema: webSearchInputSchema,
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
