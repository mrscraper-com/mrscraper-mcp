import { normalizeBearerToken } from "./auth.js";
import { getApiEndpoints } from "./config.js";
import { request, type ApiResponse } from "./http.js";
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
  geoCode?: string | null;
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
  geoCode = null,
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
  // GET with every option in the query, as the Python SDK's scraper_api sends it. The API replays a
  // request body to the target page, so a POST carrying {url, maxRetries} reached sites as a POST
  // with that JSON body and failed with 404/405/422 on most of them.
  const response = await request("GET", getApiEndpoints().scraperApiUrl, {
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
      url,
      maxRetries,
      tokenCap,
    }),
    timeout: timeout + 30,
    fetchFn,
  });
  // On GET the API returns the page's HTML alongside Markdown even with html=false (the POST path
  // left it out). Drop it here so a Markdown request does not hand the model megabytes of HTML.
  const { data } = response;
  if (
    !html &&
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof data.html === "string"
  ) {
    return { ...response, data: { ...data, html: null } };
  }
  return response;
}

export interface WebSearchOptions extends FetchDependency {
  token: string;
  query: string;
  country?: string | null;
  numResults?: number | null;
  timeout?: number;
}

/** Returns the query text, or the `q` parameter when given a search results URL. */
export function searchQuery(input: string): string {
  const value = String(input || "").trim();
  if (!value) throw new Error("A web search query is required");
  if (!/^https?:\/\//i.test(value)) return value;
  const query = new URL(value).searchParams.get("q")?.trim();
  if (!query) throw new Error("Search results URL must contain a q parameter");
  return query;
}

export async function webSearchApi({
  token,
  query,
  country = null,
  numResults = null,
  timeout = 600,
  fetchFn,
}: WebSearchOptions): Promise<ApiResponse> {
  return request("POST", getApiEndpoints().scraperApiUrl, {
    headers: getAuthHeaders(token),
    json: compact({
      action: "websearch",
      query: searchQuery(query),
      country: country ? country.toLowerCase() : null,
      numResults,
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
