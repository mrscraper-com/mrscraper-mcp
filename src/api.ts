import { normalizeBearerToken } from "./auth.js";
import { getApiEndpoints } from "./config.js";
import { request, type ApiResponse } from "./http.js";
import { isOAuthAccessToken } from "./oauth.js";

export type SearchFormat = "json" | "html";

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

function compact(
  values: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== null && entry[1] !== undefined,
    ),
  );
}

export interface ScraperApiOptions extends FetchDependency {
  token: string;
  url: string;
  html?: boolean;
  markdown?: boolean;
  timeout?: number;
  geoCode?: string;
  proxyCountry?: string | null;
  blockResources?: boolean | null;
  browserRendering?: boolean | null;
  super?: boolean;
  useProxy?: boolean;
  proxy?: string | null;
  waitForSelector?: string | null;
  homePage?: boolean;
  screenshot?: boolean;
  bypassProxy?: boolean;
  cookieJar?: string | null;
  headers?: Record<string, string> | string | null;
  maxRetries?: number;
  tokenCap?: number | null;
  stream?: boolean | null;
  discardTokenSecret?: string;
}

export async function scraperApi({
  token,
  url,
  html = true,
  markdown = false,
  timeout = 120,
  geoCode = "US",
  proxyCountry = null,
  blockResources = false,
  browserRendering = null,
  super: superMode = false,
  useProxy = true,
  proxy = null,
  waitForSelector = null,
  homePage = false,
  screenshot = false,
  bypassProxy = false,
  cookieJar = null,
  headers = null,
  maxRetries = 3,
  tokenCap = null,
  stream = null,
  discardTokenSecret = "",
  fetchFn,
}: ScraperApiOptions): Promise<ApiResponse> {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
    throw new Error("timeout must be between 1 and 300 seconds");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new Error("max_retries must be a nonnegative integer");
  }
  if (tokenCap !== null && (!Number.isInteger(tokenCap) || tokenCap < 0)) {
    throw new Error("token_cap must be a nonnegative integer");
  }
  const apiToken = normalizeBearerToken(token);
  return request("POST", getApiEndpoints().scraperApiUrl, {
    headers: {
      ...getAuthHeaders(apiToken),
      ...(discardTokenSecret
        ? { "x-discard-token-secret": discardTokenSecret }
        : {}),
    },
    params: compact({
      // Match the SDK's API-key query parameter; OAuth JWTs stay in Authorization.
      token: isOAuthAccessToken(apiToken) ? null : apiToken,
      timeout,
      geoCode,
      proxyCountry,
      browserRendering: screenshot ? true : browserRendering,
      super: superMode ? true : null,
      useProxy: useProxy ? null : false,
      proxy,
      html,
      markdown,
      waitForSelector,
      warmStart: homePage ? true : null,
      screenshot: screenshot ? true : null,
      blockResources: blockResources ? true : null,
      bypassProxy: bypassProxy ? true : null,
      cookieJar,
      headers:
        typeof headers === "object" && headers !== null
          ? JSON.stringify(headers)
          : headers,
      stream,
    }),
    json: compact({ url, maxRetries, tokenCap }),
    timeout: timeout + 30,
    fetchFn,
  });
}

export interface NormalizedSearchInput {
  query: string;
  region: string | null;
  language: string | null;
  page: number | null;
}

export function normalizeSearchInput(input: string): NormalizedSearchInput {
  const value = String(input || "").trim();
  if (!value) throw new Error("A web search query or URL is required");
  if (!/^https?:\/\//i.test(value)) {
    return { query: value, region: null, language: null, page: null };
  }
  const parsed = new URL(value);
  const query = parsed.searchParams.get("q")?.trim();
  if (!query) throw new Error("Search results URL must contain a q parameter");
  const startValue = parsed.searchParams.get("start") || "0";
  const start = /^[+-]?\d+$/.test(startValue.trim()) ? Number(startValue) : 0;
  return {
    query,
    region: parsed.searchParams.get("gl") || null,
    language: parsed.searchParams.get("hl") || null,
    page:
      Number.isFinite(start) && start > 0 ? Math.floor(start / 10) + 1 : null,
  };
}

export interface WebSearchOptions extends FetchDependency {
  token: string;
  url: string;
  raw?: boolean;
  region?: string | null;
  language?: string | null;
  page?: number | null;
  format?: SearchFormat;
  renderJs?: boolean;
  timeout?: number;
}

export async function webSearchApi({
  token,
  url,
  raw = true,
  region = null,
  language = null,
  page = null,
  format = "json",
  renderJs = false,
  timeout = 600,
  fetchFn,
}: WebSearchOptions): Promise<ApiResponse> {
  const normalized = normalizeSearchInput(url);
  return request("POST", getApiEndpoints().webSearchUrl, {
    headers: getAuthHeaders(token),
    json: compact({
      query: normalized.query,
      region: region || normalized.region,
      language: language || normalized.language,
      page: page || normalized.page,
      format: raw ? "html" : format,
      renderJs,
    }),
    timeout,
    fetchFn,
  });
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
