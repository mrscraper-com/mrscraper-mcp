import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOOL_NAMES, VERSION } from "../src/config.js";
import { createMrscraperServer } from "../src/server.js";
import {
  fetchInputSchema,
  rerunTool,
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

  it("uses the promptless scrape HTML compatibility path", async () => {
    let requestUrl: URL | undefined;
    const fetchFn = mockFetch((url) => {
      requestUrl = url;
      return new Response("<html><body>ok</body></html>", {
        headers: { "content-type": "text/html" },
      });
    });
    const output = await scrapeTool(
      "test",
      {
        url: "https://target.example",
        max_depth: 2,
        limit: 1000,
        include_patterns: "",
        exclude_patterns: "",
      },
      { fetchFn },
    );
    expect(output.format).toBe("html");
    expect(requestUrl?.searchParams.get("geoCode")).toBe("US");
    expect(requestUrl?.searchParams.get("timeout")).toBe("120");
  });

  it("embeds a JSON Schema and listing page limit", async () => {
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
        schema: {
          type: "array",
          items: {
            type: "object",
            properties: { price: { type: "number" } },
          },
        },
        agent: "listing",
        max_pages: 3,
        max_depth: 2,
        limit: 1000,
        include_patterns: "",
        exclude_patterns: "",
      },
      { fetchFn },
    );
    expect(body).toMatchObject({ agent: "listing", maxPages: 3 });
    expect(body.message).toContain("Return JSON matching this JSON Schema");
    expect(body.message).toContain('"price"');
  });

  it("rejects fetch-only options in AI scrape mode", async () => {
    await expect(
      scrapeTool("test", {
        url: "https://target.example",
        prompt: "Extract title",
        format: "markdown",
        max_depth: 2,
        limit: 1000,
        include_patterns: "",
        exclude_patterns: "",
      }),
    ).rejects.toThrow("fetch-only options: format");
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
        max_depth: 2,
        max_pages: 50,
        limit: 1000,
        include_patterns: "",
        exclude_patterns: "",
      },
      { fetchFn },
    );
    expect(path).toContain("scrapers-manual-rerun/bulk");
    expect(body).toEqual({
      scraperId: "scraper-1",
      urls: ["https://a.example", "https://b.example", "https://c.example"],
    });
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
      expect(JSON.stringify(result.content)).toContain("HTTP 400");
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
            .filter(([, schema]) => !schema.description?.trim())
            .map(([name]) => name),
          `${tool.name} has parameters without descriptions`,
        ).toEqual([]);
      }
      const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
      expect(byName.fetch!.outputSchema?.title).toBe("Fetch response");
      expect(byName.status!.outputSchema?.title).toBe("Status response");
      expect(
        (
          byName.fetch!.inputSchema.properties!.retries as Record<
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
          destructiveHint: false,
        });
      }
    } finally {
      await client.close();
    }
  });
});
