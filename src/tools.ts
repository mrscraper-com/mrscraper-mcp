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
  url: httpUrlSchema.describe("Absolute HTTP or HTTPS page URL to retrieve."),
  browser_rendering: z
    .boolean()
    .default(false)
    .describe("Send browserRendering=true to execute page JavaScript."),
  geo_code: z
    .string()
    .nullable()
    .optional()
    .describe("Value sent through the API's geoCode query parameter."),
  wait_for_selector: z
    .string()
    .nullable()
    .optional()
    .describe(
      "CSS selector sent through waitForSelector; requires browser_rendering.",
    ),
  home_page: z
    .boolean()
    .default(false)
    .describe("Send homePage=true to visit the site root first."),
  block_resources: z
    .boolean()
    .default(false)
    .describe("Send the API's blockResources value."),
  max_retries: z
    .number()
    .int()
    .min(0)
    .default(3)
    .describe("Value sent through the API's maxRetries query parameter."),
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
    "Absolute HTTP or HTTPS URL to extract data from.",
  ),
  prompt: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Natural-language extraction instructions required by general and listing agents.",
    ),
  schema_prompt: z
    .record(z.string(), jsonValueSchema)
    .nullable()
    .optional()
    .describe(
      "JSON Schema appended to the prompt as best-effort guidance; the API does not validate it.",
    ),
  agent: z
    .enum(["general", "listing", "map"])
    .default("general")
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
      "Maximum pages for listing or map extraction; omit it to use the backend default.",
    ),
  max_depth: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Maximum link depth for the map agent."),
  limit: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Maximum URL results returned by the map agent."),
  include_patterns: z
    .string()
    .nullable()
    .optional()
    .describe("Regular expression limiting URLs included by the map agent."),
  exclude_patterns: z
    .string()
    .nullable()
    .optional()
    .describe("Regular expression excluding URLs from the map agent."),
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
    .describe("One URL, or comma/newline-separated URLs for a bulk rerun."),
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
    .describe("Stored-result field used for sorting."),
  sort_order: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["asc", "desc"]))
    .default("desc")
    .describe("Result sort direction, accepted case-insensitively."),
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
  result_id: z.string().min(1).describe("UUID of the stored MrScraper result."),
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

export function registerTools(
  server: McpServer,
  getToken: () => string,
  dependencies: ToolDependencies = {},
): void {
  server.registerTool(
    "fetch",
    {
      description:
        "Call the Web Unblocker endpoint once for a known URL and return its response envelope. Enable browser_rendering explicitly when page JavaScript is required.",
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
        "Create a saved AI scraper from one starting URL. General and listing require a prompt; map discovers site URLs. Use rerun for dashboard-built manual workflows or multiple independent target URLs.",
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
        "Rerun one saved scraper configuration. Type selects an AI scraper or dashboard-built manual workflow; independently, bulk selects one URL or an asynchronous URL-list job whose bulkResultId can be inspected with result. Manual reruns require the compliance acknowledgment described in server instructions.",
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
