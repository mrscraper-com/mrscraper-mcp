import { normalizeBearerToken } from "./auth.js";
import { getApiEndpoints } from "./config.js";
import { request, type ApiResponse } from "./http.js";
import { isOAuthAccessToken } from "./oauth.js";
export function getAuthHeaders(token: string): Record<string, string> {
  const apiToken = normalizeBearerToken(token);
  if (!apiToken) throw new Error("API token is required");
  return {
    "User-Agent": "node",
    "Accept-Language": "*",
    "Sec-Fetch-Mode": "cors",
    Authorization: `Bearer ${apiToken}`,
    ...(!isOAuthAccessToken(apiToken) ? { "x-api-token": apiToken } : {}),
  };
}

export type WaitUntil =
  "domcontentloaded" | "load" | "networkidle0" | "networkidle2";
export interface PageOptions {
  token?: string;
  fetchFn?: typeof fetch;
  timeout?: number;
  geoCode?: string;
  proxyCountry?: string;
  super?: boolean;
  waitUntil?: WaitUntil;
  proxy?: string;
  maxRetries?: number;
  saveResult?: boolean;
}
export interface LoadingOptions {
  blockResources?: boolean;
  waitForSelector?: string;
  returnCookie?: boolean;
}
export interface HtmlOptions extends PageOptions, LoadingOptions {
  browserRendering?: boolean;
}
export interface MarkdownOptions extends HtmlOptions {
  html?: boolean;
}
export interface ScreenshotOptions extends PageOptions, LoadingOptions {
  screenshot?: "full" | "top";
  html?: boolean;
  markdown?: boolean;
}
export interface JsonOptions extends PageOptions {
  prompt?: string;
  browserRendering?: boolean;
  html?: boolean;
  screenshot?: boolean;
}
export interface BrandOptions {
  token?: string;
  fetchFn?: typeof fetch;
}
export interface WebSearchOptions {
  token?: string;
  fetchFn?: typeof fetch;
  country?: string;
  numResults?: number;
}
export interface WebSearchResult {
  rank: number;
  title: string;
  url: string;
  description: string;
  source: string;
}
export interface WebSearchResponse {
  success: boolean;
  message: string;
  data: WebSearchResult[];
}
export type PageData =
  | string
  | {
      html?: string;
      markdown?: string;
      screenshot?: string;
      [key: string]: unknown;
    };
export const DEFAULT_JSON_PROMPT = "Extract all data as complete as possible.";

function requireToken(token?: string): string {
  const normalized = normalizeBearerToken(token || "");
  if (!normalized) throw new Error("API token is required");
  return normalized;
}

function integer(
  name: string,
  value: number,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function text(name: string, value: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}
function pageUrl(value: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(value);
  } catch {
    /* Consistent error below. */
  }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol))
    throw new TypeError("url must be an absolute HTTP or HTTPS URL");
  return value;
}
function country(name: string, value: string): string {
  if (typeof value !== "string" || !/^[a-z]{2}$/i.test(value))
    throw new TypeError(`${name} must be a two-letter country code`);
  return value.toLowerCase();
}
function boolean(name: string, value: boolean): boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`${name} must be a boolean`);
  return value;
}
function pageParams(
  url: string,
  options: PageOptions,
): Record<string, string | number | boolean> {
  const {
    timeout = 300,
    geoCode = "us",
    proxyCountry = "us",
    super: superRouting = false,
    waitUntil = "domcontentloaded",
    proxy,
    maxRetries,
    saveResult = false,
  } = options;
  if (
    !["domcontentloaded", "load", "networkidle0", "networkidle2"].includes(
      waitUntil,
    )
  )
    throw new TypeError("Invalid waitUntil event");
  const params: Record<string, string | number | boolean> = {
    url: pageUrl(url),
    timeout: integer("timeout", timeout, 1, 300),
    geoCode: country("geoCode", geoCode),
    proxyCountry: country("proxyCountry", proxyCountry),
    super: boolean("super", superRouting),
    waitUntil,
    saveResult: boolean("saveResult", saveResult),
  };
  if (proxy !== undefined) params.proxy = text("proxy", proxy);
  if (maxRetries !== undefined)
    params.maxRetries = integer("maxRetries", maxRetries, 0);
  return params;
}
function loadingParams(
  options: LoadingOptions,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    blockResources: boolean("blockResources", options.blockResources ?? false),
    returnCookie: boolean("returnCookie", options.returnCookie ?? false),
  };
  if (options.waitForSelector !== undefined)
    params.waitForSelector = text("waitForSelector", options.waitForSelector);
  return params;
}
function endpoint(params: Record<string, string | number | boolean>): string {
  const result = new URL(getApiEndpoints().scraperApiUrl);
  for (const [key, value] of Object.entries(params))
    result.searchParams.set(key, String(value));
  return result.toString();
}
async function get(
  params: Record<string, string | number | boolean>,
  options: BrandOptions,
  timeout: number,
): Promise<ApiResponse> {
  const token = requireToken(options.token);
  return request("GET", endpoint(params), {
    headers: getAuthHeaders(token),
    timeout,
    fetchFn: options.fetchFn,
  });
}
/** Retrieve raw HTML using the CLI's page and loading defaults. */
export async function scrapeHtml(
  url: string,
  options: HtmlOptions = {},
): Promise<ApiResponse> {
  const params: Record<string, string | number | boolean> = {
    ...pageParams(url, options),
    ...loadingParams(options),
    browserRendering: boolean(
      "browserRendering",
      options.browserRendering ?? false,
    ),
    html: true,
    markdown: false,
    screenshot: false,
  };
  return get(params, options, Number(params.timeout) + 30);
}
/** Retrieve Markdown. html=true also returns HTML and forces browser rendering. */
export async function scrapeMarkdown(
  url: string,
  options: MarkdownOptions = {},
): Promise<ApiResponse> {
  const html = boolean("html", options.html ?? false);
  const browserRendering = boolean(
    "browserRendering",
    options.browserRendering ?? false,
  );
  const params: Record<string, string | number | boolean> = {
    ...pageParams(url, options),
    ...loadingParams(options),
    browserRendering: html || browserRendering,
    html,
    markdown: true,
    screenshot: false,
  };
  return get(params, options, Number(params.timeout) + 30);
}
/** Capture a base64 full-page or top-viewport screenshot with browser rendering enabled. */
export async function getScreenshot(
  url: string,
  options: ScreenshotOptions = {},
): Promise<ApiResponse> {
  const screenshot = options.screenshot ?? "full";
  if (!["full", "top"].includes(screenshot))
    throw new TypeError("screenshot must be full or top");
  const params: Record<string, string | number | boolean> = {
    ...pageParams(url, options),
    ...loadingParams(options),
    browserRendering: true,
    screenshot,
    html: boolean("html", options.html ?? true),
    markdown: boolean("markdown", options.markdown ?? false),
  };
  return get(params, options, Number(params.timeout) + 30);
}
/** Extract JSON with agent=general; prompts over the 8 KB URL limit use POST. */
export async function scrapeJson(
  url: string,
  options: JsonOptions = {},
): Promise<ApiResponse> {
  const prompt = options.prompt ?? DEFAULT_JSON_PROMPT;
  text("prompt", prompt);
  const params: Record<string, string | number | boolean> = {
    ...pageParams(url, options),
    browserRendering: boolean(
      "browserRendering",
      options.browserRendering ?? false,
    ),
    html: boolean("html", options.html ?? false),
    screenshot: boolean("screenshot", options.screenshot ?? false),
    agent: "general",
    prompt,
  };
  const token = requireToken(options.token);
  const timeout = Number(params.timeout) + 30;
  const getUrl = endpoint(params);
  if (getUrl.length <= 8000)
    return request("GET", getUrl, {
      headers: getAuthHeaders(token),
      timeout,
      fetchFn: options.fetchFn,
    });
  const { url: target, prompt: instruction, agent, ...query } = params;
  return request("POST", endpoint(query), {
    params: undefined,
    json: { url: target, prompt: instruction, agent },
    headers: getAuthHeaders(token),
    timeout,
    fetchFn: options.fetchFn,
  });
}
/** Extract a website's brand as JSON (bundle=none). */
export async function scrapeBrand(
  url: string,
  options: BrandOptions = {},
): Promise<ApiResponse> {
  return get(
    { action: "brand-scraping", url: pageUrl(url), bundle: "none" },
    options,
    120,
  );
}
/** Search the web for ranked titles, URLs, descriptions, and sources. */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {},
): Promise<ApiResponse> {
  const value = text("query", query);
  if ([...value].length > 1000)
    throw new RangeError("query must be 1 to 1000 characters");
  return get(
    {
      action: "websearch",
      query: value,
      country: country("country", options.country ?? "us"),
      numResults: integer("numResults", options.numResults ?? 10, 10, 100),
    },
    options,
    120,
  );
}

export async function getSubscriptionAccountApi(
  token: string,
  { fetchFn }: { fetchFn?: typeof fetch } = {},
): Promise<ApiResponse> {
  return request("GET", getApiEndpoints().subscriptionAccounts, {
    sanitizeData: false,
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    fetchFn,
  });
}
