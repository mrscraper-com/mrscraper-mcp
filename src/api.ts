import { normalizeBearerToken } from "./auth.js";
import { getApiEndpoints } from "./config.js";
import {
  request,
  withQuery,
  type ApiResponse,
  type QueryParams,
} from "./http.js";
import { isOAuthAccessToken } from "./oauth.js";

interface FetchDependency {
  fetchFn?: typeof fetch;
}

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

export const WAIT_UNTIL_EVENTS = [
  "domcontentloaded",
  "load",
  "networkidle0",
  "networkidle2",
] as const;
export const DEFAULT_JSON_PROMPT = "Extract all data as complete as possible.";

// The Scraper API refuses request URLs over about 8 KB with 414.
const MAX_GET_URL_LENGTH = 8000;
const TRANSPORT_GRACE_SECONDS = 30;
// Brand (bundle=none) and web search answer within seconds.
const BRAND_AND_SEARCH_TIMEOUT_SECONDS = 120;

/**
 * Options shared by the page tools, each sent as the query parameter of the
 * same name. Fields outside these types, such as `tokenCap`, `record`, and
 * `action`, are never sent.
 */
export type PageOptions = {
  url: string;
  super: boolean;
  waitUntil: (typeof WAIT_UNTIL_EVENTS)[number];
  timeout: number;
  geoCode: string;
  proxyCountry: string;
  proxy?: string | null;
  maxRetries?: number | null;
  saveResult: boolean;
};

export type LoadingOptions = {
  waitForSelector?: string | null;
  blockResources: boolean;
  returnCookie: boolean;
};

export type HtmlOptions = PageOptions &
  LoadingOptions & { browserRendering: boolean };

export type MarkdownOptions = HtmlOptions & { html: boolean };

export type ScreenshotOptions = PageOptions &
  LoadingOptions & {
    screenshot: "full" | "top";
    html: boolean;
    markdown: boolean;
  };

export type JsonOptions = PageOptions & {
  prompt: string;
  browserRendering: boolean;
  html: boolean;
  screenshot: boolean;
};

export type WebSearchOptions = {
  query: string;
  country: string;
  numResults: number;
};

function scraperGet(
  token: string,
  params: QueryParams,
  timeout: number,
  { fetchFn }: FetchDependency,
): Promise<ApiResponse> {
  return request("GET", getApiEndpoints().scraperApiUrl, {
    headers: getAuthHeaders(token),
    params,
    timeout,
    fetchFn,
  });
}

function scrapePage(
  token: string,
  params: PageOptions & QueryParams,
  dependencies: FetchDependency,
): Promise<ApiResponse> {
  return scraperGet(
    token,
    params,
    params.timeout + TRANSPORT_GRACE_SECONDS,
    dependencies,
  );
}

/** Retrieves a page as raw HTML. */
export async function scrapeHtml(
  token: string,
  options: HtmlOptions,
  dependencies: FetchDependency = {},
): Promise<ApiResponse> {
  return scrapePage(
    token,
    { ...options, html: true, markdown: false, screenshot: false },
    dependencies,
  );
}

/** Retrieves a page as Markdown; with `html`, as JSON holding both. */
export async function scrapeMarkdown(
  token: string,
  options: MarkdownOptions,
  dependencies: FetchDependency = {},
): Promise<ApiResponse> {
  return scrapePage(
    token,
    {
      ...options,
      // The API fails with HTTP 500 for html+markdown without browser rendering.
      browserRendering: options.html || options.browserRendering,
      markdown: true,
      screenshot: false,
    },
    dependencies,
  );
}

/** Captures a base64 screenshot of the full page or the top viewport in Chromium. */
export async function getScreenshot(
  token: string,
  options: ScreenshotOptions,
  dependencies: FetchDependency = {},
): Promise<ApiResponse> {
  const response = await scrapePage(
    token,
    { ...options, browserRendering: true },
    dependencies,
  );
  // The API returns the page HTML even with html=false; drop it so the model
  // isn't handed HTML it didn't ask for.
  const { data } = response;
  if (
    !options.html &&
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof data.html === "string"
  ) {
    return { ...response, data: { ...data, html: null } };
  }
  return response;
}

/**
 * Extracts structured JSON with the `general` agent. Sent as GET; a prompt too
 * long for the URL is sent with the documented POST body instead.
 */
export async function scrapeJson(
  token: string,
  options: JsonOptions,
  { fetchFn }: FetchDependency = {},
): Promise<ApiResponse> {
  const endpoint = getApiEndpoints().scraperApiUrl;
  const params = { ...options, agent: "general" };
  const init = {
    headers: getAuthHeaders(token),
    timeout: options.timeout + TRANSPORT_GRACE_SECONDS,
    fetchFn,
  };
  const getUrl = withQuery(endpoint, params).href;
  if (getUrl.length <= MAX_GET_URL_LENGTH) {
    return request("GET", getUrl, init);
  }
  const { url, prompt, agent, ...query } = params;
  return request("POST", endpoint, {
    ...init,
    params: query,
    json: { url, prompt, agent },
  });
}

/** Extracts a website's brand as JSON (`bundle=none`). */
export async function scrapeBrand(
  token: string,
  { url }: { url: string },
  dependencies: FetchDependency = {},
): Promise<ApiResponse> {
  return scraperGet(
    token,
    { action: "brand-scraping", url, bundle: "none" },
    BRAND_AND_SEARCH_TIMEOUT_SECONDS,
    dependencies,
  );
}

/** Searches the web and returns ranked results. */
export async function webSearch(
  token: string,
  { query, country, numResults }: WebSearchOptions,
  dependencies: FetchDependency = {},
): Promise<ApiResponse> {
  return scraperGet(
    token,
    { action: "websearch", query, country, numResults },
    BRAND_AND_SEARCH_TIMEOUT_SECONDS,
    dependencies,
  );
}

export async function getSubscriptionAccountApi(
  token: string,
  { fetchFn }: FetchDependency = {},
): Promise<ApiResponse> {
  return request("GET", getApiEndpoints().subscriptionAccounts, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    fetchFn,
  });
}
