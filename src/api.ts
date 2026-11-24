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

export interface RequestOptions {
  /** API key used to authenticate the request. */
  token?: string;
  fetchFn?: typeof fetch;
}
export interface PageOptions extends RequestOptions {
  /** Maximum seconds to wait for the scrape before the request times out, from 1 to 330. Increase for slow or complex pages. Defaults to 300. */
  timeout?: number;
  /** Two-letter country code to load the page from, such as us or gb. Defaults to the United States. */
  geoCode?: string;
  /** Waits until a specific CSS selector or text appears on the page before returning it, such as #results. Up to 500 characters. Useful for content that loads asynchronously after the initial page load. */
  waitForSelector?: string;
  /** Serves a cached result of the same request when it is newer than this age, in milliseconds, such as 86400000 for 1 day. Up to 604800000 (7 days). 0, the default, always scrapes fresh. A cached result costs the same tokens as the original scrape. */
  maxAge?: number;
  /** Maximum number of retries for the request. Omit for no limit. */
  maxRetries?: number;
}
export interface LoadingOptions {
  /** Controls whether the page is loaded in a browser. Leave it out to load the page without a browser first and switch to a browser automatically if the request is blocked. Set true to always load the page in a browser, which JavaScript-heavy sites, SPAs, and pages that load content dynamically need. Set false to never use a browser. */
  browserRendering?: boolean;
  /** Opens the site's home page first to warm the session before loading the target URL. Useful for sites that expect a normal browsing session before deeper pages. */
  warmStart?: boolean;
  /** Blocks images, fonts, and stylesheets from loading. Speeds up scraping and reduces bandwidth usage. */
  blockResources?: boolean;
}
export interface HtmlOptions extends PageOptions, LoadingOptions {
  /** Also captures a screenshot of the rendered page as a base64-encoded PNG: full captures the entire scroll height, top captures the first viewport, and <width>x<height> sets the viewport size in pixels with an optional -<zoom> percent, such as 1280x800 or 1920x1080-75. Width and height range from 100 to 3840, zoom from 25 to 300. Setting it forces browser rendering. Leave it out for no screenshot. */
  screenshot?: string;
}
export type MarkdownOptions = PageOptions & LoadingOptions;
export interface ScreenshotOptions extends PageOptions {
  /** Screenshot area: full captures the entire scroll height (the default), top captures the first viewport, and <width>x<height> sets the viewport size in pixels with an optional -<zoom> percent, such as 1280x800 or 1920x1080-75. Width and height range from 100 to 3840, zoom from 25 to 300. The image is a base64-encoded PNG. */
  screenshot?: string;
}
export interface JsonOptions extends PageOptions, LoadingOptions {
  /** Description of the data shape you want back, for example fields like title, price, and rating. The prompt only parses the scraped content; it cannot instruct the scraper itself. To shape the output with a JSON schema, append it to the prompt as a Json Schema: section. Defaults to "Extract all data as complete as possible." */
  prompt?: string;
  /** Returns the raw HTML of the scraped page in the response. On by default; set false to leave it out. */
  html?: boolean;
  /** Captures a screenshot of the rendered page as a base64-encoded image. Useful for verifying what the scraper actually saw. Off by default. */
  screenshot?: boolean;
}
export type BrandOptions = RequestOptions;
export interface WebSearchOptions extends RequestOptions {
  /** Two-letter country code to run the search from. Defaults to the United States. */
  country?: string;
  /** How many results to return, from 10 to 100. The search may return fewer. Defaults to 10. */
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

/** The documented screenshot forms: full, top, or WIDTHxHEIGHT with an optional -ZOOM percent. */
export const SCREENSHOT_AREA_PATTERN =
  /^(full|top|[0-9]{3,4}x[0-9]{3,4}(-[0-9]{2,3})?)$/;
/** Whether value is a documented screenshot area: width and height from 100 to 3840, zoom from 25 to 300. */
export function isScreenshotArea(value: string): boolean {
  if (typeof value !== "string" || !SCREENSHOT_AREA_PATTERN.test(value))
    return false;
  if (value === "full" || value === "top") return true;
  const [size = "", zoom] = value.split("-");
  const [width = 0, height = 0] = size.split("x").map(Number);
  const within = (number: number, min: number, max: number) =>
    number >= min && number <= max;
  return (
    within(width, 100, 3840) &&
    within(height, 100, 3840) &&
    (zoom === undefined || within(Number(zoom), 25, 300))
  );
}
/** The longest cache age maxAge accepts: 7 days in milliseconds. */
export const MAX_AGE_LIMIT = 604_800_000;

type Query = Record<string, string | number | boolean>;

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
function screenshotArea(value: string): string {
  if (!isScreenshotArea(value))
    throw new TypeError(
      "screenshot must be full, top, or WIDTHxHEIGHT with an optional -ZOOM, such as 1280x800 or 1920x1080-75 (width and height 100 to 3840, zoom 25 to 300)",
    );
  return value;
}
// Browser and loading inputs: sent only when the caller sets them, so the API's defaults apply.
function loadingParams(options: LoadingOptions): Query {
  const params: Query = {};
  if (options.browserRendering !== undefined)
    params.browserRendering = boolean(
      "browserRendering",
      options.browserRendering,
    );
  if (options.warmStart !== undefined)
    params.warmStart = boolean("warmStart", options.warmStart);
  if (options.blockResources !== undefined)
    params.blockResources = boolean("blockResources", options.blockResources);
  return params;
}
// Page inputs: the optional ones only when set. Results are always saved to the Result tab,
// and maxAge defaults to 0, which always scrapes fresh.
function pageParams(options: PageOptions): Query {
  const params: Query = {};
  if (options.timeout !== undefined)
    params.timeout = integer("timeout", options.timeout, 1, 330);
  if (options.geoCode !== undefined)
    params.geoCode = country("geoCode", options.geoCode);
  if (options.waitForSelector !== undefined) {
    const selector = text("waitForSelector", options.waitForSelector);
    if ([...selector].length > 500)
      throw new RangeError("waitForSelector must be at most 500 characters");
    params.waitForSelector = selector;
  }
  if (options.maxRetries !== undefined)
    params.maxRetries = integer("maxRetries", options.maxRetries, 0);
  params.maxAge = integer("maxAge", options.maxAge ?? 0, 0, MAX_AGE_LIMIT);
  params.saveResult = true;
  return params;
}
// The HTTP deadline: the scrape timeout (the API's 300 seconds when unset) plus 30 seconds.
function deadline(options: PageOptions): number {
  return (options.timeout ?? 300) + 30;
}
function endpoint(params: Query): string {
  const result = new URL(getApiEndpoints().scraperApiUrl);
  for (const [key, value] of Object.entries(params))
    result.searchParams.set(key, String(value));
  return result.toString();
}
async function get(
  params: Query,
  options: RequestOptions,
  timeout: number,
): Promise<ApiResponse> {
  const token = requireToken(options.token);
  return request("GET", endpoint(params), {
    headers: getAuthHeaders(token),
    timeout,
    fetchFn: options.fetchFn,
  });
}
/** Retrieve the raw HTML of a page. Browser rendering and a screenshot are optional.
 * @param url URL of the page to scrape. Must include the protocol (https://).
 */
export async function scrapeHtml(
  url: string,
  options: HtmlOptions = {},
): Promise<ApiResponse> {
  const params: Query = {
    url: pageUrl(url),
    html: true,
    markdown: false,
    ...loadingParams(options),
    ...pageParams(options),
  };
  if (options.screenshot !== undefined)
    params.screenshot = screenshotArea(options.screenshot);
  return get(params, options, deadline(options));
}
/** Retrieve a page as Markdown. Browser rendering is optional.
 * @param url URL of the page to scrape. Must include the protocol (https://).
 */
export async function scrapeMarkdown(
  url: string,
  options: MarkdownOptions = {},
): Promise<ApiResponse> {
  const params: Query = {
    url: pageUrl(url),
    markdown: true,
    html: false,
    screenshot: false,
    ...loadingParams(options),
    ...pageParams(options),
  };
  return get(params, options, deadline(options));
}
/** Capture a base64 PNG screenshot of the full page, the top viewport, or a custom viewport size. Browser rendering is always enabled.
 * @param url URL of the page to scrape. Must include the protocol (https://).
 */
export async function getScreenshot(
  url: string,
  options: ScreenshotOptions = {},
): Promise<ApiResponse> {
  const params: Query = {
    url: pageUrl(url),
    screenshot: screenshotArea(options.screenshot ?? "full"),
    browserRendering: true,
    html: false,
    markdown: false,
    ...pageParams(options),
  };
  return get(params, options, deadline(options));
}
/** Extract structured JSON from a page using a natural-language prompt. Append Json Schema: and a JSON schema to shape the output.
 * @param url URL of the page to scrape. Must include the protocol (https://).
 */
export async function scrapeJson(
  url: string,
  options: JsonOptions = {},
): Promise<ApiResponse> {
  const params: Query = {
    url: pageUrl(url),
    agent: "general",
    html: boolean("html", options.html ?? true),
    screenshot: boolean("screenshot", options.screenshot ?? false),
    ...loadingParams(options),
    ...pageParams(options),
  };
  if (options.prompt !== undefined) {
    text("prompt", options.prompt);
    params.prompt = options.prompt;
  }
  const token = requireToken(options.token);
  const timeout = deadline(options);
  const getUrl = endpoint(params);
  if (getUrl.length <= 8000)
    return request("GET", getUrl, {
      headers: getAuthHeaders(token),
      timeout,
      fetchFn: options.fetchFn,
    });
  // The API refuses a request URL over about 8 KB with 414, so a long prompt goes in a
  // POST body with url and agent, and the other settings stay in the query.
  const { url: target, prompt, agent, ...query } = params;
  return request("POST", endpoint(query), {
    params: undefined,
    json: { url: target, ...(prompt === undefined ? {} : { prompt }), agent },
    headers: getAuthHeaders(token),
    timeout,
    fetchFn: options.fetchFn,
  });
}
/** Extract a website's colors, typography, logos, and social links as JSON.
 * @param url URL of the page to scrape. Must include the protocol (https://).
 */
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
/** Search the web and return ranked results with titles, URLs, descriptions, and sources.
 * @param query The search query, from 1 to 1000 characters.
 */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {},
): Promise<ApiResponse> {
  const value = text("query", query);
  if ([...value].length > 1000)
    throw new RangeError("query must be 1 to 1000 characters");
  const params: Query = { action: "websearch", query: value };
  if (options.country !== undefined)
    params.country = country("country", options.country);
  if (options.numResults !== undefined)
    params.numResults = integer("numResults", options.numResults, 10, 100);
  return get(params, options, 120);
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
