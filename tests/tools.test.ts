import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOOL_NAMES, VERSION } from "../src/config.js";
import { createMrscraperServer } from "../src/server.js";
import {
  TOOL_DESCRIPTIONS,
  fetchInputSchema,
  fetchTool,
  rerunTool,
  resultsInputSchema,
  resultsTool,
  scrapeInputSchema,
  scrapeTool,
  statusTool,
} from "../src/tools.js";

function mockFetch(
  implementation: (url: URL, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) =>
    implementation(new URL(String(input)), init || {}),
  ) as unknown as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

describe("tool behavior", () => {
  it("accepts only absolute HTTP(S) fetch URLs", () => {
    expect(() =>
      fetchInputSchema.parse({ url: "ftp://example.com/file" }),
    ).toThrow();
    expect(fetchInputSchema.parse({ url: "https://example.com" }).url).toBe(
      "https://example.com",
    );
  });

  it("fetches once and preserves the API response envelope", async () => {
    const requests: URL[] = [];
    const fetchFn = mockFetch((url) => {
      requests.push(url);
      return new Response("<html><body>ok</body></html>", {
        headers: { "content-type": "text/html" },
      });
    });
    const output = await fetchTool(
      "test",
      fetchInputSchema.parse({
        url: "https://target.example",
        browser_rendering: true,
        geo_code: "ID",
      }),
      { fetchFn },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("browserRendering")).toBe("true");
    expect(requests[0]?.searchParams.get("geoCode")).toBe("ID");
    expect(output).toMatchObject({
      status_code: 200,
      data: "<html><body>ok</body></html>",
    });
    expect(output).not.toHaveProperty("format");
    expect(output).not.toHaveProperty("unblocker");
  });

  it("requires browser rendering when a fetch selector is supplied", async () => {
    await expect(
      fetchTool(
        "test",
        fetchInputSchema.parse({
          url: "https://target.example",
          wait_for_selector: ".ready",
        }),
      ),
    ).rejects.toThrow("wait_for_selector requires browser_rendering");
  });

  it("embeds best-effort schema guidance and a listing page limit", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body));
      return Response.json({ data: { id: "scraper-1" } });
    });
    await scrapeTool(
      "test",
      {
        url: "https://target.example/listings",
        prompt: "Extract each product",
        schema_prompt: {
          type: "array",
          items: {
            type: "object",
            properties: { price: { type: "number" } },
          },
        },
        agent: "listing",
        max_pages: 3,
      },
      { fetchFn },
    );
    expect(body).toMatchObject({ agent: "listing", maxPages: 3 });
    expect(body.message).toContain("Best-effort output guidance");
    expect(body.message).toContain("does not validate this schema");
    expect(body.message).toContain('"price"');
  });

  it("requires a prompt for general and listing scrape agents", async () => {
    await expect(
      scrapeTool(
        "test",
        scrapeInputSchema.parse({ url: "https://target.example" }),
      ),
    ).rejects.toThrow("prompt is required");
  });

  it("sends only explicitly supplied map controls", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body));
      return Response.json({ data: { id: "map-1" } });
    });
    await scrapeTool(
      "test",
      scrapeInputSchema.parse({
        url: "https://target.example",
        agent: "map",
        max_pages: 3,
      }),
      { fetchFn },
    );
    expect(body).toEqual({
      url: "https://target.example",
      agent: "map",
      maxPages: 3,
    });
  });

  it("enforces the CLI scrape agent option matrix", async () => {
    await expect(
      scrapeTool(
        "test",
        scrapeInputSchema.parse({
          url: "https://target.example",
          prompt: "Extract the title",
          agent: "general",
          max_pages: 2,
        }),
      ),
    ).rejects.toThrow("max_pages is only accepted by listing and map agents");
    await expect(
      scrapeTool(
        "test",
        scrapeInputSchema.parse({
          url: "https://target.example",
          prompt: "Map this site",
          agent: "map",
        }),
      ),
    ).rejects.toThrow("prompt is not accepted by the map agent");
  });

  it("combines account status and normalized domain analytics", async () => {
    const requests: URL[] = [];
    const fetchFn = mockFetch((url) => {
      requests.push(url);
      if (url.pathname.endsWith("/subscription-accounts")) {
        return Response.json({
          data: { tokenLimit: 100, tokenUsage: 10, user: {} },
        });
      }
      return Response.json({ data: { successRate: 80 } });
    });
    const output = await statusTool(
      "test",
      {
        domain: "https://www.example.com/products",
        from: "24h",
        to: "2026-08-10T12:00:00Z",
      },
      { fetchFn, now: () => new Date("2026-08-10T12:00:00Z") },
    );
    expect(output).toMatchObject({
      kind: "mrscraper-cli-status-summary",
      source_endpoints: ["/subscription-accounts", "/analytic/statuses"],
      data: {
        account: { token_remaining: 90 },
        analytics: {
          domain: "www.example.com",
          from: "2026-08-09 12:00:00 UTC",
          to: "2026-08-10 12:00:00 UTC",
          successRate: 80,
        },
      },
    });
    expect(requests[1]?.searchParams.get("domain")).toBe("www.example.com");
  });

  it("returns the account failure envelope instead of composing status", async () => {
    const fetchFn = mockFetch(() =>
      Response.json({ message: "unauthorized" }, { status: 401 }),
    );
    const output = await statusTool(
      "test",
      { from: "24h", to: "now" },
      { fetchFn },
    );
    expect(output).toMatchObject({
      status_code: 401,
      error:
        "Unauthorized or invalid token. Run `mrscraper login` or visit https://app.mrscraper.com.",
      data: { message: "unauthorized" },
    });
    expect(output).not.toHaveProperty("kind");
  });

  it("routes CLI-style bulk manual reruns", async () => {
    let body: Record<string, unknown> = {};
    let path = "";
    const fetchFn = mockFetch((url, init) => {
      path = url.pathname;
      body = JSON.parse(String(init.body));
      return Response.json({ data: { accepted: 3 } });
    });
    await rerunTool(
      "test",
      {
        target: "https://a.example,https://b.example\nhttps://c.example",
        type: "manual",
        bulk: true,
        id: "scraper-1",
      },
      { fetchFn },
    );
    expect(path).toContain("scrapers-manual-rerun/bulk");
    expect(body).toEqual({
      scraperId: "scraper-1",
      urls: ["https://a.example", "https://b.example", "https://c.example"],
    });
  });

  it("rejects AI crawl controls for bulk and manual reruns", async () => {
    await expect(
      rerunTool("test", {
        target: "https://a.example,https://b.example",
        type: "ai",
        bulk: true,
        id: "scraper-1",
        max_pages: 2,
      }),
    ).rejects.toThrow("max_pages is not accepted by bulk rerun endpoints");
    await expect(
      rerunTool("test", {
        target: "https://a.example",
        type: "manual",
        bulk: false,
        scraper_id: "scraper-1",
        limit: 10,
      }),
    ).rejects.toThrow("limit is only accepted by single AI reruns");
  });

  it("applies CLI defaults only to single AI reruns", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body));
      return Response.json({ data: { id: "rerun-1" } });
    });
    await rerunTool(
      "test",
      {
        target: "https://target.example",
        type: "ai",
        bulk: false,
        scraper_id: "scraper-1",
      },
      { fetchFn },
    );
    expect(body).toEqual({
      scraperId: "scraper-1",
      url: "https://target.example",
      maxDepth: 2,
      maxPages: 50,
      limit: 1000,
      includePatterns: "",
      excludePatterns: "",
    });
  });

  it("accepts any results sort field and normalizes sort order", async () => {
    let requestUrl: URL | undefined;
    const fetchFn = mockFetch((url) => {
      requestUrl = url;
      return Response.json({ data: [] });
    });
    const input = resultsInputSchema.parse({
      sort_field: "customBackendField",
      sort_order: "DeSc",
    });
    expect(input.sort_order).toBe("desc");
    await resultsTool("test", input, { fetchFn });
    expect(requestUrl?.searchParams.get("sortField")).toBe(
      "customBackendField",
    );
    expect(requestUrl?.searchParams.get("sortOrder")).toBe("DESC");
  });

  it("turns upstream failures into safe tool errors", async () => {
    const fetchFn = mockFetch(() =>
      Response.json(
        { message: "bad request", token: "secret" },
        { status: 400 },
      ),
    );
    const input = fetchInputSchema.parse({ url: "https://target.example" });
    const server = createMrscraperServer(
      { era: "legacy" },
      { resolveToken: () => "test", fetchFn },
    );
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({ name: "fetch", arguments: input });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status_code: 400,
        error: "HTTP 400",
        data: { message: "bad request", token: "[REDACTED]" },
      });
      expect(JSON.stringify(result.content)).not.toContain("secret");
    } finally {
      await client.close();
    }
  });
});

describe("MCP surface", () => {
  it("advertises version 0.1.0 and the exact CLI command names", async () => {
    const server = createMrscraperServer(
      { era: "legacy" },
      { resolveToken: () => "test" },
    );
    const client = new Client({ name: "surface-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      expect(client.getServerVersion()?.version).toBe(VERSION);
      expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
      const expectedParameters: Record<string, string[]> = {
        fetch: [
          "url",
          "browser_rendering",
          "geo_code",
          "wait_for_selector",
          "home_page",
          "block_resources",
          "max_retries",
          "token_cap",
          "timeout",
        ],
        scrape: [
          "url",
          "prompt",
          "schema_prompt",
          "agent",
          "proxy_country",
          "max_pages",
          "max_depth",
          "limit",
          "include_patterns",
          "exclude_patterns",
        ],
        serp: [
          "query_or_url",
          "region",
          "language",
          "page",
          "format",
          "render_js",
          "raw",
          "client_timeout",
        ],
        status: ["domain", "from", "to", "action", "api_token_name"],
        rerun: [
          "target",
          "type",
          "bulk",
          "scraper_id",
          "id",
          "max_depth",
          "max_pages",
          "limit",
          "include_patterns",
          "exclude_patterns",
        ],
        results: [
          "sort_field",
          "sort_order",
          "page_size",
          "page",
          "search",
          "date_range_column",
          "start_at",
          "end_at",
        ],
        result: ["result_id"],
      };
      for (const tool of tools) {
        expect(Object.keys(tool.inputSchema.properties || {}).sort()).toEqual(
          expectedParameters[tool.name]!.sort(),
        );
      }
      const status = tools.find((tool) => tool.name === "status")!;
      expect(status.inputSchema.properties).toHaveProperty("from");
      expect(status.inputSchema.properties).not.toHaveProperty("from_");
    } finally {
      await client.close();
    }
  });

  it("publishes useful output schemas, limits, descriptions, and annotations", async () => {
    const server = createMrscraperServer(
      { era: "legacy" },
      { resolveToken: () => "test" },
    );
    const client = new Client({ name: "schema-test", version: "1" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        const expectedDescription =
          TOOL_DESCRIPTIONS[tool.name as keyof typeof TOOL_DESCRIPTIONS];
        expect(
          expectedDescription,
          `${tool.name} has no tool description`,
        ).toBeDefined();
        expect(tool.description).toBe(expectedDescription);
        expect(tool.description).toMatch(/^Use this (?:when|to|only)/);
        expect(tool.outputSchema).not.toEqual({
          type: "object",
          additionalProperties: true,
        });
        const properties = (tool.inputSchema.properties || {}) as Record<
          string,
          { description?: string }
        >;
        expect(
          Object.entries(properties)
            .filter(
              ([, schema]) => (schema.description?.trim().length || 0) < 40,
            )
            .map(([name]) => name),
          `${tool.name} has parameters without useful descriptions`,
        ).toEqual([]);
      }
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      expect(byName.fetch!.outputSchema?.title).toBe("Fetch response");
      expect(byName.status!.outputSchema?.title).toBe("Status response");
      expect(
        (
          byName.fetch!.inputSchema.properties!.max_retries as Record<
            string,
            unknown
          >
        ).minimum,
      ).toBe(0);
      expect(
        (
          byName.result!.inputSchema.properties!.result_id as Record<
            string,
            unknown
          >
        ).minLength,
      ).toBe(1);
      for (const name of ["fetch", "serp", "status", "results", "result"]) {
        expect(byName[name]!.annotations).toMatchObject({
          readOnlyHint: true,
          openWorldHint: false,
          destructiveHint: false,
        });
      }
      for (const name of ["scrape", "rerun"]) {
        expect(byName[name]!.annotations).toMatchObject({
          readOnlyHint: false,
          openWorldHint: false,
          destructiveHint: false,
        });
      }
    } finally {
      await client.close();
    }
  });
});
