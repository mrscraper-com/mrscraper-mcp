import type { JSONValue, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  bulkRerunAiScraperApi,
  bulkRerunManualScraperApi,
  createAiScraperApi,
  fetchContentApi,
  getAllResultsApi,
  getAnalyticStatusesApi,
  getResultByIdApi,
  getSubscriptionAccountApi,
  googleSerpSyncApi,
  parseBulkUrls,
  rerunAiScraperApi,
  rerunManualScraperApi,
  type Agent,
} from "./api.js";
import { MANUAL_RERUN_ACKNOWLEDGMENT_REQUIRED } from "./compliance.js";
import type { ApiResponse } from "./http.js";
import { widgetMeta } from "./widgets/index.js";
import {
  formatApiDate,
  parseStatusDate,
  summarizeSubscriptionAccount,
} from "./status.js";

export interface ToolDependencies {
  fetchFn?: typeof fetch;
  now?: () => Date;
}

const jsonValueSchema = z.json();
const httpUrlSchema = z.url({ protocol: /^https?$/ });
const headersSchema = z
  .record(z.string(), z.string())
  .describe("Safe response headers; credentials and cookies are removed.");
const apiResponseSchema = z
  .object({
    status_code: z
      .number()
      .int()
      .nullable()
      .describe("HTTP status returned by the MrScraper service."),
    data: jsonValueSchema.describe(
      "Sanitized response payload returned by MrScraper.",
    ),
    headers: headersSchema,
    error: z.string().optional().describe("Request failure message, if any."),
  })
  .meta({
    title: "MrScraper API response",
    description: "A credential-safe response envelope from MrScraper.",
  });
export const fetchOutputSchema = apiResponseSchema.meta({
  title: "Fetch response",
  description: "The response envelope returned by the Web Unblocker API.",
});

export const scrapeOutputSchema = apiResponseSchema.meta({
  title: "Scrape response",
  description:
    "The AI scraper response envelope. A successful run contains scraperId for reproducing the saved configuration with rerun.",
});

export const statusOutputSchema = z
  .object({
    kind: z.literal("mrscraper-cli-status-summary").optional(),
    source_endpoints: z.array(z.string()).optional(),
    status_code: z.number().int().nullable(),
    data: jsonValueSchema,
    headers: headersSchema.optional(),
    error: z.string().optional(),
  })
  .meta({
    title: "Status response",
    description:
      "Account identity, subscription usage, and optional domain request-outcome analytics.",
  });

const serpOutputSchema = apiResponseSchema.meta({
  title: "SERP response",
  description: "Parsed Google results or raw result-page HTML.",
});
const rerunOutputSchema = apiResponseSchema.meta({
  title: "Rerun response",
  description: "The MrScraper response for a saved scraper rerun.",
});
const resultsOutputSchema = apiResponseSchema.meta({
  title: "Results response",
  description: "Paginated stored MrScraper results.",
});
const resultOutputSchema = apiResponseSchema.meta({
  title: "Result response",
  description: "One stored MrScraper result.",
});

function isApiFailure(result: Record<string, unknown>): boolean {
  return Boolean(
    result.error ||
    (typeof result.status_code === "number" && result.status_code >= 400),
  );
}

function asStructured(result: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    ...(isApiFailure(result) ? { isError: true } : {}),
  };
}

function buildExtractionMessage(
  prompt: string,
  schemaPrompt?: Record<string, JSONValue> | null,
): string {
  const instruction = prompt.trim();
  if (!instruction) {
    throw new Error("prompt is required for general and listing agents");
  }
  if (schemaPrompt === null || schemaPrompt === undefined) return instruction;
  return `${instruction}\n\nBest-effort output guidance: return JSON matching this JSON Schema. The MrScraper API does not validate this schema:\n${JSON.stringify(schemaPrompt, null, 2)}`;
}

function unwrapApiData(response: ApiResponse): JSONValue {
  const body = response.data;
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "data" in body
  ) {
    return body.data as JSONValue;
  }
  return body;
}

function normalizeDomain(value: string): string {
  const candidate = value.trim();
  if (!candidate) throw new Error("domain must not be empty");
  try {
    return new URL(
      /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`,
    ).hostname;
  } catch {
    throw new Error(`Invalid domain: ${value}`);
  }
}

export const fetchInputSchema = z.object({
  url: httpUrlSchema.describe(
    "Required absolute HTTP or HTTPS URL of the known page to retrieve through Web Unblocker.",
  ),
  browser_rendering: z
    .boolean()
    .default(false)
    .describe(
      "Loads the page in a browser and runs its JavaScript. Independent of super_mode; some pages fail in a browser but load without one. Required for wait_for_selector.",
    ),
  super_mode: z
    .boolean()
    .default(false)
    .describe(
      "Routes the request through real devices. Independent of browser_rendering; it can load pages that fail with standard routing.",
    ),
  geo_code: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional proxy-routing country code sent as geoCode when the page must be viewed from a specific location.",
    ),
  wait_for_selector: z
    .string()
    .nullable()
    .optional()
    .describe(
      "CSS selector to wait for before returning the page. Requires browser_rendering=true and is useful for content that appears after JavaScript runs.",
    ),
  home_page: z
    .boolean()
    .default(false)
    .describe(
      "Visits the site's root page before the target URL, which can establish cookies or session state.",
    ),
  block_resources: z
    .boolean()
    .default(false)
    .describe(
      "Blocks nonessential page resources during loading, which reduces bandwidth when only page content is needed.",
    ),
  max_retries: z
    .number()
    .int()
    .min(0)
    .default(3)
    .describe(
      "Maximum Web Unblocker retry count; 0 disables retries, and the default is 3.",
    ),
  token_cap: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Optional maximum retry-token budget consumed across this fetch request's attempts.",
    ),
  timeout: z
    .number()
    .int()
    .positive()
    .default(30)
    .describe(
      "API page-load timeout in seconds; the MCP server allows 30 seconds more for transport.",
    ),
});

export async function fetchTool(
  token: string,
  input: z.infer<typeof fetchInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  if (input.wait_for_selector && !input.browser_rendering) {
    throw new Error("wait_for_selector requires browser_rendering");
  }
  return fetchContentApi({
    token,
    url: input.url,
    browserRendering: input.browser_rendering,
    superMode: input.super_mode,
    timeout: input.timeout,
    geoCode: input.geo_code ?? null,
    waitForSelector: input.wait_for_selector ?? null,
    homePage: input.home_page,
    blockResources: input.block_resources,
    maxRetries: input.max_retries,
    tokenCap: input.token_cap ?? null,
    fetchFn: dependencies.fetchFn,
  });
}

export const scrapeInputSchema = z.object({
  url: httpUrlSchema.describe(
    "Required absolute HTTP or HTTPS starting URL for the AI scraper.",
  ),
  prompt: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Natural-language description of the fields or repeated records to extract. Required for general and listing; not accepted by map.",
    ),
  schema_prompt: z
    .record(z.string(), jsonValueSchema)
    .nullable()
    .optional()
    .describe(
      "Optional JSON Schema appended to prompt as best-effort output-shape guidance for general or listing extraction.",
    ),
  agent: z
    .enum(["general", "listing", "map"])
    .default("general")
    .describe(
      "Extraction mode: general for defined page fields, listing for repeated records across pages, or map for discovering site URLs.",
    ),
  mode: z
    .enum(["Cheap", "Super"])
    .nullable()
    .optional()
    .describe(
      "Optional backend execution tier: Cheap or Super. This is separate from agent; omit it to preserve the backend default.",
    ),
  proxy_country: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional proxy country for general or listing extraction when content varies by location; not accepted by map.",
    ),
  max_pages: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum pages processed by listing or map. Not accepted by general; omit it to use the service default.",
    ),
  max_depth: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum link depth followed by the map agent; not accepted by general or listing.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum number of discovered URLs returned by the map agent; not accepted by general or listing.",
    ),
  include_patterns: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Regular expression selecting URLs the map agent may include; not accepted by general or listing.",
    ),
  exclude_patterns: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Regular expression removing matching URLs from map-agent results; not accepted by general or listing.",
    ),
});

export async function scrapeTool(
  token: string,
  input: z.infer<typeof scrapeInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const supplied = (value: unknown) => value !== undefined && value !== null;
  const agent: Agent = input.agent;
  const mapOnlyOptions = [
    ["max_depth", input.max_depth],
    ["limit", input.limit],
    ["include_patterns", input.include_patterns],
    ["exclude_patterns", input.exclude_patterns],
  ] as const;

  if (agent === "map") {
    if (supplied(input.prompt)) {
      throw new Error("prompt is not accepted by the map agent");
    }
    if (supplied(input.schema_prompt)) {
      throw new Error("schema_prompt is not accepted by the map agent");
    }
    if (supplied(input.proxy_country)) {
      throw new Error("proxy_country is not accepted by the map agent");
    }
  } else {
    if (!input.prompt?.trim()) {
      throw new Error("prompt is required for general and listing agents");
    }
    const invalidMapOptions = mapOnlyOptions
      .filter(([, value]) => supplied(value))
      .map(([name]) => name);
    if (invalidMapOptions.length) {
      throw new Error(
        `${invalidMapOptions.join(", ")} ${invalidMapOptions.length === 1 ? "is" : "are"} only accepted by the map agent`,
      );
    }
    if (agent === "general" && supplied(input.max_pages)) {
      throw new Error("max_pages is only accepted by listing and map agents");
    }
  }

  return createAiScraperApi({
    token,
    url: input.url,
    message:
      agent === "map"
        ? undefined
        : buildExtractionMessage(input.prompt!, input.schema_prompt),
    agent,
    mode: input.mode ?? undefined,
    proxyCountry: input.proxy_country ?? null,
    maxPages: input.max_pages ?? undefined,
    maxDepth: input.max_depth ?? undefined,
    limit: input.limit ?? undefined,
    includePatterns: input.include_patterns ?? undefined,
    excludePatterns: input.exclude_patterns ?? undefined,
    fetchFn: dependencies.fetchFn,
  });
}

export const serpInputSchema = z.object({
  query_or_url: z
    .string()
    .min(1)
    .describe(
      "Required Google search query text or complete Google search URL from which to retrieve results.",
    ),
  region: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional country code used to localize the Google results returned by the service.",
    ),
  language: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional language code used to localize the Google results returned by the service.",
    ),
  page: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Optional one-based Google results page number for retrieving later result pages.",
    ),
  format: z
    .enum(["json", "html"])
    .default("json")
    .describe(
      "Response representation: json returns parsed search results; html returns the result page's raw HTML.",
    ),
  render_js: z
    .boolean()
    .default(false)
    .describe(
      "Renders the Google results page with JavaScript so dynamic features such as AI Overview are included.",
    ),
  raw: z
    .boolean()
    .default(false)
    .describe(
      "Deprecated alias for format=html; takes precedence over format.",
    ),
  client_timeout: z
    .number()
    .int()
    .positive()
    .default(120)
    .describe(
      "Local upstream HTTP timeout in seconds; it is not included in the SERP request body.",
    ),
});

export async function serpTool(
  token: string,
  input: z.infer<typeof serpInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  return googleSerpSyncApi({
    token,
    queryOrUrl: input.query_or_url,
    region: input.region ?? null,
    language: input.language ?? null,
    page: input.page ?? null,
    format: input.format,
    renderJs: input.render_js,
    raw: input.raw,
    timeout: input.client_timeout,
    fetchFn: dependencies.fetchFn,
  });
}

export const statusInputSchema = z.object({
  domain: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional hostname or URL. When supplied, status includes request-outcome analytics for its normalized hostname; omit it for account usage only.",
    ),
  from: z
    .string()
    .default("24h")
    .describe(
      "Analytics range start as ISO 8601, now, or a relative duration such as 24h or 7d. Used only when domain is supplied.",
    ),
  to: z
    .string()
    .default("now")
    .describe(
      "Analytics range end as ISO 8601, now, or a relative duration. Used only when domain is supplied.",
    ),
  action: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional exact MrScraper action filter applied to domain analytics; used only when domain is supplied.",
    ),
  api_token_name: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional API token name used to filter domain analytics; used only when domain is supplied.",
    ),
});

export async function statusTool(
  token: string,
  input: z.infer<typeof statusInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const accountResponse = await getSubscriptionAccountApi(token, dependencies);
  if (isApiFailure(accountResponse)) return accountResponse;
  const account = unwrapApiData(accountResponse);
  const output: Record<string, unknown> = {
    kind: "mrscraper-cli-status-summary",
    source_endpoints: ["/subscription-accounts"],
    status_code: accountResponse.status_code,
    data: {
      account: summarizeSubscriptionAccount(
        account && typeof account === "object" && !Array.isArray(account)
          ? (account as Record<string, unknown>)
          : {},
      ),
    },
  };
  if (!input.domain) return output;

  (output.source_endpoints as string[]).push("/analytic/statuses");
  const domain = normalizeDomain(input.domain);
  const now = dependencies.now?.() || new Date();
  const end = parseStatusDate(input.to, now, "now");
  const start = parseStatusDate(input.from, end, "24h");
  if (start >= end) throw new Error("from must be earlier than to");
  const startDate = formatApiDate(start);
  const endDate = formatApiDate(end);
  const analyticsResponse = await getAnalyticStatusesApi({
    token,
    domain,
    startDate,
    endDate,
    action: input.action || "",
    apiTokenName: input.api_token_name || "",
    fetchFn: dependencies.fetchFn,
  });
  const data = output.data as Record<string, unknown>;
  if (analyticsResponse.error) {
    output.error = "Account loaded, but analytics could not be loaded";
    data.analytics = analyticsResponse;
  } else {
    const analytics = unwrapApiData(analyticsResponse);
    data.analytics = {
      domain,
      from: `${startDate} UTC`,
      to: `${endDate} UTC`,
      ...(analytics &&
      typeof analytics === "object" &&
      !Array.isArray(analytics)
        ? analytics
        : { data: analytics }),
    };
  }
  return output;
}

export const rerunInputSchema = z.object({
  target: z
    .string()
    .describe(
      "Target URL for a single rerun, or comma/newline-separated target URLs when bulk=true.",
    ),
  type: z
    .enum(["ai", "manual"])
    .describe(
      "How the saved scraper was created: ai for an AI scraper or manual for a dashboard-built step workflow.",
    ),
  bulk: z
    .boolean()
    .default(false)
    .describe(
      "Independently select target count: false for one URL or true to submit all parsed targets as one asynchronous bulk job.",
    ),
  acknowledged: z
    .boolean()
    .optional()
    .describe(
      "Confirms that the user accepted MrScraper's compliance warning about scraping login-protected pages. Required for type=manual; a manual rerun without it returns the warning and does not run.",
    ),
  scraper_id: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Saved scraper UUID, required when bulk=false: the scraperId that scrape returns for an AI scraper, or a dashboard workflow's UUID for a manual one.",
    ),
  id: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Required saved scraper UUID when bulk=true. This identifies the configuration to run and is not a result ID.",
    ),
  max_depth: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum crawl depth for a single AI rerun; omit it to preserve the saved scraper or backend default.",
    ),
  max_pages: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum pages for a single AI rerun; omit it to preserve the saved scraper or backend default.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum results for a single AI rerun; omit it to preserve the saved scraper or backend default.",
    ),
  include_patterns: z
    .string()
    .nullable()
    .optional()
    .describe(
      "URL include regular expression for a single AI rerun; omit it to preserve the saved scraper or backend default.",
    ),
  exclude_patterns: z
    .string()
    .nullable()
    .optional()
    .describe(
      "URL exclude regular expression for a single AI rerun; omit it to preserve the saved scraper or backend default.",
    ),
  proxy_country: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Proxy country code for a single AI rerun; omit it to preserve the saved scraper or backend default.",
    ),
  max_retry: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe(
      "Maximum retry count for a single AI rerun; omit it to preserve the saved scraper or backend default.",
    ),
  timeout: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Timeout in seconds for a single AI rerun, used by listing reruns; omit it to preserve the backend default.",
    ),
});

function assertManualAcknowledged(
  input: z.infer<typeof rerunInputSchema>,
): void {
  if (input.type === "manual" && input.acknowledged !== true) {
    throw new Error(MANUAL_RERUN_ACKNOWLEDGMENT_REQUIRED);
  }
}

export async function rerunTool(
  token: string,
  input: z.infer<typeof rerunInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const aiOptionEntries = [
    ["max_depth", input.max_depth],
    ["max_pages", input.max_pages],
    ["limit", input.limit],
    ["include_patterns", input.include_patterns],
    ["exclude_patterns", input.exclude_patterns],
    ["proxy_country", input.proxy_country],
    ["max_retry", input.max_retry],
    ["timeout", input.timeout],
  ] as const;
  const explicitAiOptions = aiOptionEntries
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name]) => name);

  let response: ApiResponse;
  if (input.bulk) {
    if (!input.id) throw new Error("id is required when bulk is true");
    if (input.scraper_id !== undefined && input.scraper_id !== null) {
      throw new Error(
        "scraper_id is only accepted for single reruns; use id when bulk is true",
      );
    }
    if (explicitAiOptions.length) {
      throw new Error(
        `${explicitAiOptions.join(", ")} ${explicitAiOptions.length === 1 ? "is" : "are"} not accepted by bulk rerun endpoints`,
      );
    }
    const urls = parseBulkUrls(input.target);
    if (!urls.length) throw new Error("No URLs found in the bulk target");
    assertManualAcknowledged(input);
    response =
      input.type === "ai"
        ? await bulkRerunAiScraperApi({
            token,
            scraperId: input.id,
            urls,
            fetchFn: dependencies.fetchFn,
          })
        : await bulkRerunManualScraperApi({
            token,
            scraperId: input.id,
            urls,
            fetchFn: dependencies.fetchFn,
          });
  } else {
    if (!input.scraper_id) {
      throw new Error("scraper_id is required unless bulk is true");
    }
    if (input.id !== undefined && input.id !== null) {
      throw new Error(
        "id is only accepted when bulk is true; use scraper_id for a single rerun",
      );
    }
    if (input.type === "manual" && explicitAiOptions.length) {
      throw new Error(
        `${explicitAiOptions.join(", ")} ${explicitAiOptions.length === 1 ? "is" : "are"} only accepted by single AI reruns`,
      );
    }
    const url = input.target.trim();
    if (!url) throw new Error("target URL must not be empty");
    assertManualAcknowledged(input);
    response =
      input.type === "manual"
        ? await rerunManualScraperApi({
            token,
            scraperId: input.scraper_id,
            url,
            fetchFn: dependencies.fetchFn,
          })
        : await rerunAiScraperApi({
            token,
            scraperId: input.scraper_id,
            url,
            maxDepth: input.max_depth ?? undefined,
            maxPages: input.max_pages ?? undefined,
            limit: input.limit ?? undefined,
            includePatterns: input.include_patterns ?? undefined,
            excludePatterns: input.exclude_patterns ?? undefined,
            proxyCountry: input.proxy_country ?? undefined,
            maxRetry: input.max_retry ?? undefined,
            timeout: input.timeout ?? undefined,
            fetchFn: dependencies.fetchFn,
          });
  }
  return response;
}

export const resultsInputSchema = z.object({
  sort_field: z
    .string()
    .min(1)
    .default("updatedAt")
    .describe(
      "Stored-result field used as the sort key; defaults to updatedAt.",
    ),
  sort_order: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["asc", "desc"]))
    .default("desc")
    .describe(
      "Sort direction for sort_field: asc or desc, accepted case-insensitively; defaults to desc.",
    ),
  page_size: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe(
      "Positive number of stored result records requested per page; defaults to 10.",
    ),
  page: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe(
      "One-based page number used to move through the stored result list; defaults to 1.",
    ),
  search: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional free-text filter used to narrow the stored result list.",
    ),
  date_range_column: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Stored-result date column to which start_at and end_at are applied.",
    ),
  start_at: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional inclusive ISO 8601 start bound applied to date_range_column.",
    ),
  end_at: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Optional inclusive ISO 8601 end bound applied to date_range_column.",
    ),
  scraper_id: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Optional exact saved scraper UUID filter, sent as filters[scraperId].",
    ),
  status: z
    .enum(["Draft", "Finished", "Running", "Failed", "Cancelled"])
    .nullable()
    .optional()
    .describe(
      "Optional exact result status filter: Draft, Finished, Running, Failed, or Cancelled.",
    ),
  type: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Optional exact result type filter, such as AI, Manual, Rerun-AI, or Bulk-AI.",
    ),
  url: httpUrlSchema
    .nullable()
    .optional()
    .describe(
      "Optional exact stored target URL filter, including its path and query string.",
    ),
});

export async function resultsTool(
  token: string,
  input: z.infer<typeof resultsInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  return getAllResultsApi({
    token,
    sortField: input.sort_field,
    sortOrder: input.sort_order.toUpperCase(),
    pageSize: input.page_size,
    page: input.page,
    search: input.search ?? null,
    dateRangeColumn: input.date_range_column ?? null,
    startAt: input.start_at ?? null,
    endAt: input.end_at ?? null,
    scraperId: input.scraper_id ?? null,
    status: input.status ?? null,
    type: input.type ?? null,
    url: input.url ?? null,
    fetchFn: dependencies.fetchFn,
  });
}

export const resultInputSchema = z.object({
  result_id: z
    .string()
    .min(1)
    .describe(
      "Required UUID of the stored result to retrieve, including a bulkResultId returned by an asynchronous bulk rerun.",
    ),
  include_html: z
    .boolean()
    .default(true)
    .describe(
      "Includes the stored page HTML. false returns a smaller response with the extracted data and job state.",
    ),
});

export async function resultTool(
  token: string,
  input: z.infer<typeof resultInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const resultId = input.result_id.trim();
  if (!resultId) throw new Error("result_id must not be empty");
  return getResultByIdApi(token, resultId, {
    includeHtml: input.include_html,
    fetchFn: dependencies.fetchFn,
  });
}

const readAnnotations = {
  readOnlyHint: true,
  openWorldHint: false,
  destructiveHint: false,
};
const writeAnnotations = {
  readOnlyHint: false,
  openWorldHint: false,
  destructiveHint: false,
};

// Claude's directory reads annotations.title; other clients read title.
function titled(title: string, hints: typeof readAnnotations) {
  return { title, annotations: { title, ...hints } };
}

export const TOOL_DESCRIPTIONS = {
  fetch:
    "Fetches one web page through MrScraper's Web Unblocker and returns its raw response: status code, sanitized headers, and the body as parsed JSON or text. Use it when the page URL is known. browser_rendering loads the page in a browser and runs its JavaScript; super_mode routes the request through real devices. The two options are independent, their four combinations can return different content for the same URL, and browser rendering does not always produce better content. wait_for_selector requires browser_rendering=true. geo_code sets the proxy location; home_page, block_resources, max_retries, token_cap, and timeout control loading, retries, and token spend.",
  scrape:
    "Runs MrScraper's managed extraction on a URL and saves the configuration as a reusable scraper. agent=general extracts the fields described in prompt from one page; agent=listing extracts repeated records and can follow pagination up to max_pages; agent=map discovers URLs within the site, bounded by max_pages, max_depth, limit, include_patterns, and exclude_patterns. general and listing require prompt and send page content to a backend LLM that extracts the requested fields; schema_prompt optionally describes the output shape, and proxy_country sets the proxy location. mode=Cheap or mode=Super selects the backend execution tier, and omitting mode keeps the backend default. A successful run returns the extracted data and the saved scraper's scraperId.",
  serp: "Searches Google through MrScraper and returns parsed results (format=json, the default) or the results page HTML (format=html). Use it when the starting point is a search query rather than a page URL. query_or_url accepts search text or a complete Google search URL; region and language localize results, page selects a later results page, render_js includes JavaScript-rendered features such as AI Overviews, and client_timeout sets how long the request waits. raw is a deprecated alias for format=html.",
  status:
    "Returns the connected MrScraper account's identity (name, email, and verification state), subscription, token limit, and token usage. With domain, it also returns request-outcome analytics for that hostname: from and to set the window, and action and api_token_name filter the outcomes. It reports account and request health, not the progress of a scrape job.",
  rerun:
    "Runs a saved MrScraper scraper again on the same or new URLs and stores the result. type=ai runs a scraper saved by scrape; type=manual runs a step workflow built in the MrScraper dashboard. A manual rerun runs only with acknowledged=true, which confirms the user accepted MrScraper's compliance warning about scraping login-protected pages; without it, the tool returns that warning and does not run. With bulk=false, target is one URL and scraper_id is the saved scraper's UUID; a single AI rerun also accepts max_depth, max_pages, limit, include_patterns, exclude_patterns, proxy_country, max_retry, and timeout, and omitted controls keep the saved scraper's and backend defaults. With bulk=true, target is a comma- or newline-separated URL list and id is the saved scraper's UUID; the job runs asynchronously and returns a bulkResultId. Manual and bulk reruns don't accept the single-AI controls.",
  results:
    "Lists stored MrScraper results with pagination (page and page_size), sorting (sort_field and sort_order), free-text search, a date window (date_range_column with start_at and end_at), and exact filters for scraper_id, status, type, and url. It returns result summaries rather than complete records.",
  result:
    "Returns one stored MrScraper result by its UUID, with the extracted data and the job's current state. result_id also accepts the bulkResultId of an asynchronous bulk rerun, whose state shows the job's progress. include_html, true by default, adds the stored page HTML; false returns a smaller response.",
} as const;

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
): void {
  server.registerTool(
    "fetch",
    {
      ...titled("Fetch Page", readAnnotations),
      description: TOOL_DESCRIPTIONS.fetch,
      inputSchema: fetchInputSchema,
      outputSchema: fetchOutputSchema,
    },
    async (input) =>
      asStructured(await fetchTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "scrape",
    {
      ...titled("Extract Data", writeAnnotations),
      description: TOOL_DESCRIPTIONS.scrape,
      inputSchema: scrapeInputSchema,
      outputSchema: scrapeOutputSchema,
      _meta: widgetMeta("records", "Extracting data…", "Extraction complete."),
    },
    async (input) =>
      asStructured(await scrapeTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "serp",
    {
      ...titled("Google Search", readAnnotations),
      description: TOOL_DESCRIPTIONS.serp,
      inputSchema: serpInputSchema,
      outputSchema: serpOutputSchema,
      _meta: widgetMeta("serp", "Searching Google…", "Search complete."),
    },
    async (input) =>
      asStructured(await serpTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "status",
    {
      ...titled("Account Status", readAnnotations),
      description: TOOL_DESCRIPTIONS.status,
      inputSchema: statusInputSchema,
      outputSchema: statusOutputSchema,
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
    "rerun",
    {
      ...titled("Rerun Saved Scraper", writeAnnotations),
      description: TOOL_DESCRIPTIONS.rerun,
      inputSchema: rerunInputSchema,
      outputSchema: rerunOutputSchema,
    },
    async (input) =>
      asStructured(await rerunTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "results",
    {
      ...titled("List Results", readAnnotations),
      description: TOOL_DESCRIPTIONS.results,
      inputSchema: resultsInputSchema,
      outputSchema: resultsOutputSchema,
      _meta: widgetMeta("records", "Loading results…", "Results loaded."),
    },
    async (input) =>
      asStructured(await resultsTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "result",
    {
      ...titled("Get Result", readAnnotations),
      description: TOOL_DESCRIPTIONS.result,
      inputSchema: resultInputSchema,
      outputSchema: resultOutputSchema,
      _meta: widgetMeta("records", "Loading result…", "Result loaded."),
    },
    async (input) =>
      asStructured(await resultTool(getToken(), input, dependencies)),
  );
}
