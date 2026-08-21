import { normalizeBearerToken } from "./auth.js";
import { getApiEndpoints } from "./config.js";
import { request, type ApiResponse } from "./http.js";
import { isOAuthAccessToken } from "./oauth.js";

export type Agent = "general" | "listing" | "map";
export type SerpFormat = "json" | "html";

interface FetchDependency {
  fetchFn?: typeof fetch;
}

const CLI_FETCH_HEADERS = {
  "User-Agent": "node",
  "Accept-Language": "*",
  "Sec-Fetch-Mode": "cors",
};

export function getAuthHeaders(token: string): Record<string, string> {
  const apiToken = normalizeBearerToken(token);
  if (!apiToken) throw new Error("API token is required");

  if (isOAuthAccessToken(apiToken)) {
    return { ...CLI_FETCH_HEADERS, Authorization: `Bearer ${apiToken}` };
  }
  return {
    ...CLI_FETCH_HEADERS,
    Authorization: `Bearer ${apiToken}`,
    "x-api-token": apiToken,
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

export interface FetchContentOptions extends FetchDependency {
  token: string;
  url: string;
  timeout?: number;
  geoCode?: string | null;
  browserRendering?: boolean;
  waitForSelector?: string | null;
  homePage?: boolean;
  blockResources?: boolean;
  maxRetries?: number;
  tokenCap?: number | null;
}

export async function fetchContentApi({
  token,
  url,
  timeout = 30,
  geoCode = null,
  browserRendering = false,
  waitForSelector = null,
  homePage = false,
  blockResources = false,
  maxRetries = 3,
  tokenCap = null,
  fetchFn,
}: FetchContentOptions): Promise<ApiResponse> {
  return request("GET", getApiEndpoints().fetchHtmlBaseUrl, {
    headers: getAuthHeaders(token),
    params: compact({
      url,
      timeout,
      geoCode,
      browserRendering,
      waitForSelector,
      homePage,
      blockResources,
      maxRetries,
      tokenCap,
    }),
    timeout: timeout + 30,
    fetchFn,
  });
}

export interface CreateAiScraperOptions extends FetchDependency {
  token: string;
  url: string;
  message?: string;
  agent?: Agent;
  proxyCountry?: string | null;
  maxDepth?: number;
  maxPages?: number;
  limit?: number;
  includePatterns?: string;
  excludePatterns?: string;
}

export async function createAiScraperApi({
  token,
  url,
  message,
  agent = "general",
  proxyCountry = null,
  maxDepth,
  maxPages,
  limit,
  includePatterns,
  excludePatterns,
  fetchFn,
}: CreateAiScraperOptions): Promise<ApiResponse> {
  if (!(agent === "general" || agent === "listing" || agent === "map")) {
    throw new Error("agent must be general, listing, or map");
  }
  if ((agent === "general" || agent === "listing") && !message?.trim()) {
    throw new Error(
      "An extraction message is required for general and listing agents",
    );
  }
  if (agent === "map" && proxyCountry !== null && proxyCountry !== undefined) {
    throw new Error("The map agent does not accept proxyCountry");
  }

  const payload: Record<string, unknown> = { url, agent };
  if (agent === "general" || agent === "listing") {
    payload.message = message;
    if (proxyCountry !== null && proxyCountry !== undefined) {
      payload.proxyCountry = proxyCountry;
    }
    if (agent === "listing" && maxPages !== undefined) {
      payload.maxPages = maxPages;
    }
  } else {
    if (message)
      throw new Error("The map agent does not accept an extraction prompt");
    if (maxDepth !== undefined) payload.maxDepth = maxDepth;
    if (maxPages !== undefined) payload.maxPages = maxPages;
    if (limit !== undefined) payload.limit = limit;
    if (includePatterns !== undefined)
      payload.includePatterns = includePatterns;
    if (excludePatterns !== undefined)
      payload.excludePatterns = excludePatterns;
  }
  return request("POST", getApiEndpoints().scrapersAi, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    json: payload,
    fetchFn,
  });
}

export interface RerunAiOptions extends FetchDependency {
  token: string;
  scraperId: string;
  url: string;
  maxDepth?: number;
  maxPages?: number;
  limit?: number;
  includePatterns?: string;
  excludePatterns?: string;
}

export async function rerunAiScraperApi({
  token,
  scraperId,
  url,
  maxDepth = 2,
  maxPages = 50,
  limit = 1_000,
  includePatterns = "",
  excludePatterns = "",
  fetchFn,
}: RerunAiOptions): Promise<ApiResponse> {
  return request("POST", getApiEndpoints().scrapersAiRerun, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    json: {
      scraperId,
      url,
      maxDepth,
      maxPages,
      limit,
      includePatterns,
      excludePatterns,
    },
    fetchFn,
  });
}

interface BulkRerunOptions extends FetchDependency {
  token: string;
  scraperId: string;
  urls: string[];
}

export async function bulkRerunAiScraperApi({
  token,
  scraperId,
  urls,
  fetchFn,
}: BulkRerunOptions): Promise<ApiResponse> {
  return request("POST", getApiEndpoints().scrapersAiRerunBulk, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    json: { scraperId, urls },
    fetchFn,
  });
}

interface ManualRerunOptions extends FetchDependency {
  token: string;
  scraperId: string;
  url: string;
}

export async function rerunManualScraperApi({
  token,
  scraperId,
  url,
  fetchFn,
}: ManualRerunOptions): Promise<ApiResponse> {
  return request("POST", getApiEndpoints().scrapersManualRerun, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    json: { scraperId, url },
    fetchFn,
  });
}

export async function bulkRerunManualScraperApi({
  token,
  scraperId,
  urls,
  fetchFn,
}: BulkRerunOptions): Promise<ApiResponse> {
  return request("POST", getApiEndpoints().scrapersManualRerunBulk, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    json: { scraperId, urls },
    fetchFn,
  });
}

export interface GetResultsOptions extends FetchDependency {
  token: string;
  sortField?: string;
  sortOrder?: string;
  pageSize?: number;
  page?: number;
  search?: string | null;
  dateRangeColumn?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}

export async function getAllResultsApi({
  token,
  sortField = "updatedAt",
  sortOrder = "DESC",
  pageSize = 10,
  page = 1,
  search = null,
  dateRangeColumn = null,
  startAt = null,
  endAt = null,
  fetchFn,
}: GetResultsOptions): Promise<ApiResponse> {
  const params: Record<string, string | number> = {
    sortField,
    sortOrder,
    pageSize,
    page,
  };
  if (search) params.search = search;
  if (dateRangeColumn) params.dateRangeColumn = dateRangeColumn;
  if (startAt) params.startAt = startAt;
  if (endAt) params.endAt = endAt;
  return request("GET", getApiEndpoints().results, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    params,
    fetchFn,
  });
}

export async function getResultByIdApi(
  token: string,
  resultId: string,
  options: FetchDependency = {},
): Promise<ApiResponse> {
  return request("GET", `${getApiEndpoints().results}/${resultId}`, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    fetchFn: options.fetchFn,
  });
}

export async function getSubscriptionAccountApi(
  token: string,
  options: FetchDependency = {},
): Promise<ApiResponse> {
  return request("GET", getApiEndpoints().subscriptionAccounts, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    fetchFn: options.fetchFn,
  });
}

export interface AnalyticStatusesOptions extends FetchDependency {
  token: string;
  domain: string;
  startDate: string;
  endDate: string;
  action?: string;
  apiTokenName?: string;
}

export async function getAnalyticStatusesApi({
  token,
  domain,
  startDate,
  endDate,
  action = "",
  apiTokenName = "",
  fetchFn,
}: AnalyticStatusesOptions): Promise<ApiResponse> {
  return request("GET", getApiEndpoints().analyticStatuses, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    params: { domain, startDate, endDate, action, apiTokenName },
    fetchFn,
  });
}

export interface NormalizedSerpInput {
  query: string;
  region: string | null;
  language: string | null;
  page: number | null;
}

export function normalizeSerpInput(input: string): NormalizedSerpInput {
  const value = String(input || "").trim();
  if (!value) throw new Error("A Google search query or URL is required");

  try {
    const parsed = new URL(value);
    const query = parsed.searchParams.get("q")?.trim();
    if (!query) throw new Error("Google search URL must contain a q parameter");
    const start = Number(parsed.searchParams.get("start") || 0);
    return {
      query,
      region: parsed.searchParams.get("gl"),
      language: parsed.searchParams.get("hl"),
      page:
        Number.isFinite(start) && start > 0 ? Math.floor(start / 10) + 1 : null,
    };
  } catch (error) {
    if (/^https?:\/\//i.test(value)) throw error;
    return { query: value, region: null, language: null, page: null };
  }
}

export interface GoogleSerpOptions extends FetchDependency {
  token: string;
  queryOrUrl: string;
  region?: string | null;
  language?: string | null;
  page?: number | null;
  format?: SerpFormat;
  renderJs?: boolean;
  raw?: boolean;
  timeout?: number;
}

export async function googleSerpSyncApi({
  token,
  queryOrUrl,
  region = null,
  language = null,
  page = null,
  format = "json",
  renderJs = false,
  raw = false,
  timeout = 120,
  fetchFn,
}: GoogleSerpOptions): Promise<ApiResponse> {
  const normalized = normalizeSerpInput(queryOrUrl);
  const resolvedFormat = raw ? "html" : format;
  const payload = compact({
    query: normalized.query,
    region: region || normalized.region,
    language: language || normalized.language,
    page: page || normalized.page,
    format: resolvedFormat,
    renderJs: Boolean(renderJs),
  });
  return request("POST", getApiEndpoints().googleSerpSync, {
    headers: { accept: "application/json", ...getAuthHeaders(token) },
    json: payload,
    timeout,
    fetchFn,
  });
}

export function parseBulkUrls(raw: string): string[] {
  return raw
    .split(/[,\n]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}
