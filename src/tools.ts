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
import type { ApiResponse } from "./http.js";
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
    description: "Account usage and optional domain request-outcome analytics.",
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
      "Execute page JavaScript in a browser. Enable this for client-rendered content or before using wait_for_selector.",
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
      "Visit the site's root page before the target URL, which can help establish cookies or session state.",
    ),
  block_resources: z
    .boolean()
    .default(false)
    .describe(
      "Ask Web Unblocker to block nonessential page resources during loading when only page content is needed.",
    ),
  max_retries: z
    .number()
    .int()
    .min(0)
    .default(3)
    .describe(
      "Maximum Web Unblocker retry count. Use 0 to disable retries; the default is 3.",
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
      "Render the Google results page with JavaScript when dynamic features such as AI Overview are needed.",
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
  scraper_id: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Required saved scraper UUID when bulk=false. Use the scraperId returned by scrape for an AI scraper, or a dashboard workflow's UUID for manual.",
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
      "Maximum crawl depth for a single AI rerun; defaults to 2 when omitted.",
    ),
  max_pages: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum pages for a single AI rerun; defaults to 50 when omitted.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum results for a single AI rerun; defaults to 1000 when omitted.",
    ),
  include_patterns: z
    .string()
    .nullable()
    .optional()
    .describe(
      "URL include regular expression for a single AI rerun; defaults to an empty string.",
    ),
  exclude_patterns: z
    .string()
    .nullable()
    .optional()
    .describe(
      "URL exclude regular expression for a single AI rerun; defaults to an empty string.",
    ),
});

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
            maxDepth: input.max_depth ?? 2,
            maxPages: input.max_pages ?? 50,
            limit: input.limit ?? 1000,
            includePatterns: input.include_patterns ?? "",
            excludePatterns: input.exclude_patterns ?? "",
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
});

export async function resultTool(
  token: string,
  input: z.infer<typeof resultInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const resultId = input.result_id.trim();
  if (!resultId) throw new Error("result_id must not be empty");
  return getResultByIdApi(token, resultId, dependencies);
}

const readAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
  destructiveHint: false,
};
const writeAnnotations = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: false,
};

export const TOOL_DESCRIPTIONS = {
  fetch:
    "Use this when you already know one page URL and need its page response through Web Unblocker, including pages that reject ordinary HTTP requests. Use scrape instead for AI-extracted fields or records, and serp when you first need to discover URLs with Google. The url argument is required. Enable browser_rendering for JavaScript-driven content; wait_for_selector then waits for a CSS selector. geo_code changes proxy location, while home_page, block_resources, max_retries, token_cap, and timeout tune loading and retry behavior.",
  scrape:
    "Use this when you know a starting URL and need AI-extracted fields, repeated listing records, or a map of site URLs. Choose agent=general for defined fields on a page, agent=listing for repeated records across pages, or agent=map for URL discovery. The general and listing modes require prompt and optionally accept schema_prompt guidance and proxy_country; max_pages applies to listing and map, while max_depth, limit, include_patterns, and exclude_patterns are map-only. A successful run creates a saved scraper and returns scraperId, which rerun can reuse on the same or another URL. Use fetch instead when the page response itself is sufficient.",
  serp: "Use this when the task starts with a Google query or Google search URL and you need to discover relevant result pages before fetching or extracting them. The query_or_url argument is required; region, language, and page control localization and pagination. format=json returns parsed results, format=html returns result-page HTML, render_js includes dynamic features, and client_timeout only controls how long this MCP request waits. raw is a deprecated alias for format=html. Follow useful result URLs with fetch or scrape.",
  status:
    "Use this to check the current MrScraper account's subscription and usage before or after web-data work. With no arguments it returns the account summary. Supply domain only when request-outcome analytics are also needed; from and to select that analytics window, while action and api_token_name narrow those domain outcomes. This tool reports account and request health, not scrape-job progress; use result for a known asynchronous result ID.",
  rerun:
    "Use this only when you already have a saved scraper UUID and want to apply that configuration to the same or new target URLs. Set type=ai for a scraper created by scrape; type=manual selects a dashboard-built step workflow and requires the conversation's compliance acknowledgment. For one URL, leave bulk=false and pass target with scraper_id. A single AI rerun also accepts max_depth, max_pages, limit, include_patterns, and exclude_patterns; manual and bulk reruns reject those controls. For multiple URLs, set bulk=true, pass comma- or newline-separated target URLs and id; bulk jobs are asynchronous, so retain bulkResultId and inspect it with result until completion. Use scrape to create a new AI configuration.",
  results:
    "Use this to browse or locate stored scrape results when you do not yet know the exact result UUID. sort_field and sort_order control ordering; page_size and page control pagination; search narrows the list; and date_range_column with start_at or end_at applies a date window. This returns a result list rather than one complete record. Once an ID is known, use result for that record.",
  result:
    "Use this when you already know the exact stored result UUID and need the complete record or current job state. Pass that UUID as result_id; this may also be the bulkResultId returned by an asynchronous bulk rerun. Call result again as needed until an asynchronous job completes. Use results first when the UUID is unknown.",
} as const;

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
): void {
  server.registerTool(
    "fetch",
    {
      description: TOOL_DESCRIPTIONS.fetch,
      inputSchema: fetchInputSchema,
      outputSchema: fetchOutputSchema,
      annotations: readAnnotations,
    },
    async (input) =>
      asStructured(await fetchTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "scrape",
    {
      description: TOOL_DESCRIPTIONS.scrape,
      inputSchema: scrapeInputSchema,
      outputSchema: scrapeOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) =>
      asStructured(await scrapeTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "serp",
    {
      description: TOOL_DESCRIPTIONS.serp,
      inputSchema: serpInputSchema,
      outputSchema: serpOutputSchema,
      annotations: readAnnotations,
    },
    async (input) =>
      asStructured(await serpTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "status",
    {
      description: TOOL_DESCRIPTIONS.status,
      inputSchema: statusInputSchema,
      outputSchema: statusOutputSchema,
      annotations: readAnnotations,
    },
    async (input) =>
      asStructured(await statusTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "rerun",
    {
      description: TOOL_DESCRIPTIONS.rerun,
      inputSchema: rerunInputSchema,
      outputSchema: rerunOutputSchema,
      annotations: writeAnnotations,
    },
    async (input) =>
      asStructured(await rerunTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "results",
    {
      description: TOOL_DESCRIPTIONS.results,
      inputSchema: resultsInputSchema,
      outputSchema: resultsOutputSchema,
      annotations: readAnnotations,
    },
    async (input) =>
      asStructured(await resultsTool(getToken(), input, dependencies)),
  );
  server.registerTool(
    "result",
    {
      description: TOOL_DESCRIPTIONS.result,
      inputSchema: resultInputSchema,
      outputSchema: resultOutputSchema,
      annotations: readAnnotations,
    },
    async (input) =>
      asStructured(await resultTool(getToken(), input, dependencies)),
  );
}
