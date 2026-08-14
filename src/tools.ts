import type { JSONValue, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  bulkRerunAiScraperApi,
  bulkRerunManualScraperApi,
  createAiScraperApi,
  fetchWithUnblockerApi,
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
import { formatFetchResult, type FetchFormat } from "./content.js";
import type { ApiResponse } from "./http.js";
import { sanitizeResponseData } from "./http.js";
import {
  formatApiDate,
  parseStatusDate,
  summarizeSubscriptionAccount,
} from "./status.js";

export const DEFAULT_GENERAL_PROMPT = "Get all data as complete as possible";

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
      .describe("HTTP status returned by the MrScraper service."),
    data: jsonValueSchema.describe(
      "Sanitized response payload returned by MrScraper.",
    ),
    headers: headersSchema,
  })
  .meta({
    title: "MrScraper API response",
    description: "A credential-safe response envelope from MrScraper.",
  });
const unblockerSchema = z.object({
  requested: z.enum(["auto", "always", "never"]),
  browser_rendering: z.boolean(),
  escalated: z.boolean(),
  attempts: z.number().int().min(1),
});

export const fetchOutputSchema = apiResponseSchema
  .extend({
    format: z.enum(["markdown", "html", "json"]),
    url: z.string(),
    unblocker: unblockerSchema,
  })
  .meta({
    title: "Fetch response",
    description: "Formatted page content and unblocker execution metadata.",
  });

export const scrapeOutputSchema = apiResponseSchema
  .extend({
    format: z.enum(["markdown", "html", "json"]).optional(),
    url: z.string().optional(),
    unblocker: unblockerSchema.optional(),
  })
  .meta({
    title: "Scrape response",
    description:
      "A structured extraction response, or a fetch-compatible response when no AI extraction arguments are supplied.",
  });

export const statusOutputSchema = z
  .object({
    status_code: z.number().int(),
    data: z.object({
      account: z.object({
        subscription_status: jsonValueSchema,
        enterprise: z.boolean(),
        token_usage: z.number(),
        token_limit: z.number(),
        token_remaining: z.number(),
        usage_percent: z.number(),
        rate_limit: z.number(),
        rate_ttl: z.number(),
        auto_renew: z.boolean(),
        ends_at: jsonValueSchema,
        user: z.object({
          name: jsonValueSchema,
          email: jsonValueSchema,
          verified: z.boolean(),
        }),
      }),
      analytics: z.record(z.string(), jsonValueSchema).optional(),
    }),
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

function asStructured(result: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function raiseForApiError<T extends ApiResponse>(result: T): T {
  if (!result.error) return result;

  const error = String(sanitizeResponseData(result.error));
  const status =
    result.status_code === null
      ? "no HTTP response"
      : `HTTP ${result.status_code}`;
  let detail = "";
  if (
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
  ) {
    const data = result.data as Record<string, JSONValue>;
    const candidate = data.message || data.error;
    if (candidate) {
      const sanitized = String(sanitizeResponseData(candidate)).trim();
      if (sanitized && sanitized !== error)
        detail = `: ${sanitized.slice(0, 500)}`;
    }
  }
  throw new Error(
    `MrScraper API request failed (${status}): ${error}${detail}`,
  );
}

function buildExtractionMessage(
  prompt?: string | null,
  schema?: Record<string, JSONValue> | null,
): string {
  const instruction = prompt?.trim() || DEFAULT_GENERAL_PROMPT;
  if (schema === null || schema === undefined) return instruction;
  return `${instruction}\n\nReturn JSON matching this JSON Schema:\n${JSON.stringify(schema, null, 2)}`;
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
  url: httpUrlSchema.describe("Absolute HTTP or HTTPS page URL to retrieve."),
  format: z
    .enum(["markdown", "html", "json"])
    .default("markdown")
    .describe(
      "Readable Markdown, source HTML, or a clean page-document object.",
    ),
  unblock: z
    .enum(["auto", "always", "never"])
    .default("auto")
    .describe(
      "Browser-rendering policy. Auto escalates only after a detected block.",
    ),
  geo: z
    .string()
    .nullable()
    .optional()
    .describe("Optional ISO 3166-1 alpha-2 proxy country code."),
  wait_for: z
    .string()
    .nullable()
    .optional()
    .describe("CSS selector that must appear before capture."),
  homepage: z
    .boolean()
    .default(false)
    .describe("Visit the site home page before loading the target URL."),
  block_resources: z
    .boolean()
    .default(false)
    .describe("Block non-essential resources during browser rendering."),
  retries: z
    .number()
    .int()
    .min(0)
    .default(3)
    .describe("Maximum API retry attempts after escalation."),
  token_cap: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Optional token cap across retries."),
  timeout: z
    .number()
    .int()
    .positive()
    .default(30)
    .describe("Maximum page-load duration in seconds."),
});

export async function fetchTool(
  token: string,
  input: z.infer<typeof fetchInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const response = await fetchWithUnblockerApi({
    token,
    url: input.url,
    unblock: input.unblock,
    timeout: input.timeout,
    geoCode: input.geo ?? null,
    waitForSelector: input.wait_for ?? null,
    homePage: input.homepage,
    blockResources: input.block_resources,
    maxRetries: input.retries,
    tokenCap: input.token_cap ?? null,
    fetchFn: dependencies.fetchFn,
  });
  return raiseForApiError(
    formatFetchResult(response, { format: input.format, url: input.url }),
  );
}

export const scrapeInputSchema = z.object({
  url: httpUrlSchema.describe(
    "Absolute HTTP or HTTPS URL to extract data from.",
  ),
  prompt: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Natural-language extraction instructions; enables AI extraction.",
    ),
  schema: z
    .record(z.string(), jsonValueSchema)
    .nullable()
    .optional()
    .describe("JSON Schema object for the requested structured output."),
  agent: z
    .enum(["general", "listing", "map"])
    .nullable()
    .optional()
    .describe("AI extraction mode."),
  proxy_country: z
    .string()
    .nullable()
    .optional()
    .describe("Proxy country supported by the AI scrape API."),
  max_pages: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Maximum pages for listing or map extraction; defaults to 1 for listing and 50 otherwise.",
    ),
  max_depth: z
    .number()
    .int()
    .positive()
    .default(2)
    .describe("Maximum link depth for the map agent."),
  limit: z
    .number()
    .int()
    .positive()
    .default(1000)
    .describe("Maximum URL results returned by the map agent."),
  include_patterns: z
    .string()
    .default("")
    .describe("Regular expression limiting URLs included by the map agent."),
  exclude_patterns: z
    .string()
    .default("")
    .describe("Regular expression excluding URLs from the map agent."),
  format: z
    .enum(["markdown", "html", "json"])
    .nullable()
    .optional()
    .describe(
      "Page format used only in promptless fetch-compatible mode; defaults to HTML.",
    ),
  unblock: z
    .enum(["auto", "always", "never"])
    .nullable()
    .optional()
    .describe(
      "Browser-rendering policy used only in promptless fetch-compatible mode.",
    ),
  geo_code: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Proxy region used only in promptless fetch-compatible mode; defaults to US.",
    ),
  wait_for: z
    .string()
    .nullable()
    .optional()
    .describe("CSS selector awaited only in promptless fetch-compatible mode."),
  homepage: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Visit the site home page first in promptless fetch-compatible mode.",
    ),
  block_resources: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Block non-essential resources in promptless fetch-compatible mode.",
    ),
  retries: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe(
      "Retry limit used only in promptless fetch-compatible mode; defaults to 3.",
    ),
  token_cap: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Optional retry token cap used only in promptless fetch-compatible mode.",
    ),
  timeout: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Page-load timeout used only in promptless fetch-compatible mode; defaults to 120 seconds.",
    ),
});

export async function scrapeTool(
  token: string,
  input: z.infer<typeof scrapeInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const useAi = [
    input.prompt,
    input.schema,
    input.agent,
    input.proxy_country,
  ].some((value) => value !== undefined && value !== null);
  if (!useAi) {
    return fetchTool(
      token,
      {
        url: input.url,
        format: (input.format || "html") as FetchFormat,
        unblock: input.unblock || "auto",
        geo: input.geo_code || "US",
        wait_for: input.wait_for,
        homepage: Boolean(input.homepage),
        block_resources: Boolean(input.block_resources),
        retries: input.retries ?? 3,
        token_cap: input.token_cap,
        timeout: input.timeout ?? 120,
      },
      dependencies,
    );
  }

  const fetchOnly = [
    ["format", input.format],
    ["unblock", input.unblock],
    ["geo_code", input.geo_code],
    ["wait_for", input.wait_for],
    ["homepage", input.homepage],
    ["block_resources", input.block_resources],
    ["retries", input.retries],
    ["token_cap", input.token_cap],
    ["timeout", input.timeout],
  ]
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name]) => name);
  if (fetchOnly.length) {
    throw new Error(
      `The AI scrape API does not support these fetch-only options: ${fetchOnly.join(", ")}. Use fetch for unblocker controls; AI scrape supports proxy_country.`,
    );
  }

  const agent: Agent = input.agent || "general";
  if (agent === "map" && input.schema) {
    throw new Error("schema is not supported by the map agent");
  }
  const response = await createAiScraperApi({
    token,
    url: input.url,
    message: buildExtractionMessage(input.prompt, input.schema),
    agent,
    proxyCountry: input.proxy_country ?? null,
    maxPages: input.max_pages ?? (agent === "listing" ? 1 : 50),
    maxDepth: input.max_depth,
    limit: input.limit,
    includePatterns: input.include_patterns,
    excludePatterns: input.exclude_patterns,
    fetchFn: dependencies.fetchFn,
  });
  return raiseForApiError(response);
}

export const serpInputSchema = z.object({
  query_or_url: z
    .string()
    .min(1)
    .describe("Google query or full Google search URL."),
  region: z
    .string()
    .nullable()
    .optional()
    .describe("Optional Google result country code."),
  language: z
    .string()
    .nullable()
    .optional()
    .describe("Optional Google result language code."),
  page: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("One-based result page."),
  format: z
    .enum(["json", "html"])
    .default("json")
    .describe("Parsed JSON results or raw result-page HTML."),
  render_js: z
    .boolean()
    .default(false)
    .describe("Render dynamic SERP features such as AI Overview."),
  raw: z
    .boolean()
    .default(false)
    .describe("Request raw HTML; takes precedence over format."),
  timeout: z
    .number()
    .int()
    .positive()
    .default(120)
    .describe("Maximum SERP request duration in seconds."),
});

export async function serpTool(
  token: string,
  input: z.infer<typeof serpInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  return raiseForApiError(
    await googleSerpSyncApi({
      token,
      queryOrUrl: input.query_or_url,
      region: input.region ?? null,
      language: input.language ?? null,
      page: input.page ?? null,
      format: input.format,
      renderJs: input.render_js,
      raw: input.raw,
      timeout: input.timeout,
      fetchFn: dependencies.fetchFn,
    }),
  );
}

export const statusInputSchema = z.object({
  domain: z
    .string()
    .nullable()
    .optional()
    .describe("Domain or URL for optional request-outcome analytics."),
  from: z
    .string()
    .default("24h")
    .describe("ISO 8601, now, or a relative duration such as 24h or 7d."),
  to: z
    .string()
    .default("now")
    .describe("Analytics range end as ISO 8601, now, or a relative duration."),
  action: z
    .string()
    .nullable()
    .optional()
    .describe("Optional exact action filter for domain analytics."),
  api_token_name: z
    .string()
    .nullable()
    .optional()
    .describe("Optional API-token-name filter for domain analytics."),
});

export async function statusTool(
  token: string,
  input: z.infer<typeof statusInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const accountResponse = await getSubscriptionAccountApi(token, dependencies);
  raiseForApiError(accountResponse);
  const account = unwrapApiData(accountResponse);
  const output: Record<string, unknown> = {
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
    .union([z.string(), z.array(z.string())])
    .describe("One URL, or a bulk URL array/delimited string."),
  type: z.enum(["ai", "manual"]).describe("Saved scraper type."),
  bulk: z
    .boolean()
    .default(false)
    .describe("Submit all parsed target URLs through the bulk rerun endpoint."),
  scraper_id: z
    .string()
    .nullable()
    .optional()
    .describe("Saved scraper UUID for a single rerun."),
  id: z
    .string()
    .nullable()
    .optional()
    .describe("Saved scraper UUID for a bulk rerun."),
  max_depth: z
    .number()
    .int()
    .positive()
    .default(2)
    .describe(
      "Maximum crawl depth for a single AI rerun; ignored for manual and bulk reruns.",
    ),
  max_pages: z
    .number()
    .int()
    .positive()
    .default(50)
    .describe(
      "Maximum pages for a single AI rerun; ignored for manual and bulk reruns.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .default(1000)
    .describe(
      "Maximum results for a single AI rerun; ignored for manual and bulk reruns.",
    ),
  include_patterns: z
    .string()
    .default("")
    .describe("URL include regular expression for a single AI rerun."),
  exclude_patterns: z
    .string()
    .default("")
    .describe("URL exclude regular expression for a single AI rerun."),
});

export async function rerunTool(
  token: string,
  input: z.infer<typeof rerunInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  let response: ApiResponse;
  if (input.bulk) {
    if (!input.id) throw new Error("id is required when bulk is true");
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
    const targets = Array.isArray(input.target) ? input.target : [input.target];
    if (targets.length !== 1) {
      throw new Error("A single rerun requires exactly one target URL");
    }
    const url = targets[0]!.trim();
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
            maxDepth: input.max_depth,
            maxPages: input.max_pages,
            limit: input.limit,
            includePatterns: input.include_patterns,
            excludePatterns: input.exclude_patterns,
            fetchFn: dependencies.fetchFn,
          });
  }
  return raiseForApiError(response);
}

const sortFields = [
  "createdAt",
  "updatedAt",
  "id",
  "type",
  "url",
  "status",
  "error",
  "tokenUsage",
  "runtime",
] as const;

export const resultsInputSchema = z.object({
  sort_field: z
    .enum(sortFields)
    .default("updatedAt")
    .describe("Stored-result field used for sorting."),
  sort_order: z
    .enum(["ASC", "DESC"])
    .default("DESC")
    .describe("Result sort direction."),
  page_size: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe("Number of stored results requested per page."),
  page: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe("One-based stored-result page index."),
  search: z
    .string()
    .nullable()
    .optional()
    .describe("Optional free-text result search filter."),
  date_range_column: z
    .string()
    .nullable()
    .optional()
    .describe("Result column to which start_at and end_at apply."),
  start_at: z
    .string()
    .nullable()
    .optional()
    .describe("Optional inclusive ISO 8601 date-range start."),
  end_at: z
    .string()
    .nullable()
    .optional()
    .describe("Optional inclusive ISO 8601 date-range end."),
});

export async function resultsTool(
  token: string,
  input: z.infer<typeof resultsInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  return raiseForApiError(
    await getAllResultsApi({
      token,
      sortField: input.sort_field,
      sortOrder: input.sort_order,
      pageSize: input.page_size,
      page: input.page,
      search: input.search ?? null,
      dateRangeColumn: input.date_range_column ?? null,
      startAt: input.start_at ?? null,
      endAt: input.end_at ?? null,
      fetchFn: dependencies.fetchFn,
    }),
  );
}

export const resultInputSchema = z.object({
  result_id: z.string().min(1).describe("UUID of the stored MrScraper result."),
});

export async function resultTool(
  token: string,
  input: z.infer<typeof resultInputSchema>,
  dependencies: ToolDependencies = {},
): Promise<Record<string, unknown>> {
  const resultId = input.result_id.trim();
  if (!resultId) throw new Error("result_id must not be empty");
  return raiseForApiError(
    await getResultByIdApi(token, resultId, dependencies),
  );
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

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
): void {
  server.registerTool(
    "fetch",
    {
      description:
        "Fetch a known URL as Markdown, HTML, or a clean page-document object. Auto unblock starts without browser rendering and escalates after a detected challenge.",
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
      description:
        "Extract structured data from a URL using a prompt, JSON Schema, or both. General handles a page, listing handles repeated records, and map discovers site URLs.",
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
      description:
        "Return Google results for a query or full Google search URL as parsed JSON or raw HTML.",
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
      description:
        "Return subscription and quota status, plus optional MrScraper request-outcome analytics for a domain.",
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
      description:
        "Rerun a saved AI or manual scraper for one URL or a bulk URL list. Manual reruns require the compliance acknowledgment described in server instructions.",
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
      description:
        "List stored scrape results with pagination, sorting, search, and date filters.",
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
      description: "Return one stored scrape result by its result UUID.",
      inputSchema: resultInputSchema,
      outputSchema: resultOutputSchema,
      annotations: readAnnotations,
    },
    async (input) =>
      asStructured(await resultTool(getToken(), input, dependencies)),
  );
}
