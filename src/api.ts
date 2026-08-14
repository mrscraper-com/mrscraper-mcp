import { normalizeBearerToken } from "./auth.js";
import { getApiEndpoints } from "./config.js";
import { request, type ApiResponse } from "./http.js";

export type Agent = "general" | "listing" | "map";
export type UnblockPolicy = "auto" | "always" | "never";
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

const BLOCK_PAGE_PATTERNS = [
  /\bcaptcha\b/i,
  /access denied/i,
  /verify (?:that )?you are (?:a )?human/i,
  /checking (?:if|your) (?:the )?(?:site|browser|connection)/i,
  /unusual traffic/i,
  /cf-chl-/i,
  /cloudflare ray id/i,
  /datadome/i,
  /incapsula/i,
  /perimeterx/i,
];

export function isLikelyBlockedResult(result: ApiResponse): boolean {
  if (result.status_code === null) return true;
  if ([408, 500, 502, 503, 504].includes(result.status_code)) return true;
  if (
    typeof result.data === "string" &&
    [403, 429].includes(result.status_code)
  ) {
    return true;
  }
  const sample = (
    typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data || {})
  ).slice(0, 250_000);
  if (/failed to open url|navigation failed|target.*blocked/i.test(sample)) {
    return true;
  }
  return BLOCK_PAGE_PATTERNS.some((pattern) => pattern.test(sample));
}

export interface FetchWithUnblockerOptions extends FetchDependency {
  token: string;
  url: string;
  unblock?: UnblockPolicy;
  timeout?: number;
  geoCode?: string | null;
  waitForSelector?: string | null;
  homePage?: boolean;
  blockResources?: boolean;
  maxRetries?: number;
  tokenCap?: number | null;
}

export async function fetchWithUnblockerApi({
  token,
  url,
  unblock = "auto",
  timeout = 30,
  geoCode = null,
  waitForSelector = null,
  homePage = false,
  blockResources = false,
  maxRetries = 3,
  tokenCap = null,
  fetchFn,
}: FetchWithUnblockerOptions): Promise<ApiResponse> {
  if (!(["auto", "always", "never"] as const).includes(unblock)) {
    throw new Error("unblock must be auto, always, or never");
  }
  if (unblock === "never" && waitForSelector) {
    throw new Error(
      "wait_for requires browser rendering; use unblock='auto' or 'always'",
    );
  }

  const renderingRequired = unblock === "always" || Boolean(waitForSelector);
  const common = {
    token,
    url,
    timeout,
    geoCode,
    waitForSelector,
    homePage,
    blockResources,
    tokenCap,
    fetchFn,
  };
  const first = await fetchContentApi({
    ...common,
    browserRendering: renderingRequired,
    maxRetries: unblock === "auto" && !renderingRequired ? 0 : maxRetries,
  });
  const shouldEscalate =
    unblock === "auto" && !renderingRequired && isLikelyBlockedResult(first);

  if (!shouldEscalate) {
    return {
      ...first,
      unblocker: {
        requested: unblock,
        browser_rendering: renderingRequired,
        escalated: false,
        attempts: 1,
      },
    };
  }

  const second = await fetchContentApi({
    ...common,
    browserRendering: true,
    maxRetries,
  });
  return {
    ...second,
    unblocker: {
      requested: unblock,
      browser_rendering: true,
      escalated: true,
      attempts: 2,
    },
  };
}

export interface CreateAiScraperOptions extends FetchDependency {
  token: string;
  url: string;
  message: string;
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
  maxDepth = 2,
  maxPages = 50,
  limit = 1_000,
  includePatterns = "",
  excludePatterns = "",
  fetchFn,
}: CreateAiScraperOptions): Promise<ApiResponse> {
  const payload: Record<string, unknown> =
    agent === "general" || agent === "listing"
      ? { url, message, agent, proxyCountry }
      : {
          url,
          agent,
          maxDepth,
          maxPages,
          limit,
          includePatterns,
          excludePatterns,
        };
  if (agent === "listing") payload.maxPages = maxPages;
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

export function parseBulkUrls(raw: string | string[]): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map(String)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return raw
    .split(/[,|\n]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}
