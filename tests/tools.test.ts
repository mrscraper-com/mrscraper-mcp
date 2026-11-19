import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_JSON_PROMPT } from "../src/api.js";
import { TOOL_NAMES, type ToolSurface } from "../src/config.js";
import { createMrscraperServer } from "../src/server.js";
import {
  getScreenshotInputSchema,
  scrapeHtmlInputSchema,
  scrapeJsonInputSchema,
  webSearchInputSchema,
} from "../src/tools.js";

interface UpstreamRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

function upstream(body: unknown = { ok: true }, init?: ResponseInit) {
  const requests: UpstreamRequest[] = [];
  const fetchFn = vi.fn(
    async (input: URL | RequestInfo, request?: RequestInit) => {
      requests.push({
        method: request?.method ?? "GET",
        url: new URL(String(input)),
        headers: (request?.headers ?? {}) as Record<string, string>,
        body: request?.body,
      });
      return Response.json(body, init);
    },
  ) as unknown as typeof fetch;
  return { fetchFn, requests };
}

async function withClient<T>(
  fetchFn: typeof fetch,
  surface: ToolSurface,
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const server = createMrscraperServer(
    { era: "legacy" },
    { resolveToken: () => "test-token", fetchFn, surface },
  );
  const client = new Client({ name: "tools-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await use(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function callTool(
  name: string,
  args: Record<string, unknown>,
  fetchFn: typeof fetch,
  surface: ToolSurface = "default",
) {
  return withClient(fetchFn, surface, (client) =>
    client.callTool({ name, arguments: args }),
  );
}

const url = "https://example.com";
const PAGE_DEFAULTS = {
  url,
  super: "false",
  waitUntil: "domcontentloaded",
  timeout: "300",
  geoCode: "us",
  proxyCountry: "us",
  saveResult: "false",
};
const LOADING_DEFAULTS = { blockResources: "false", returnCookie: "false" };

describe("tool listing", () => {
  it.each(["default", "chatgpt"] as const)(
    "lists the seven tools with read-only hints on %s",
    async (surface) => {
      const { tools } = await withClient(
        upstream().fetchFn,
        surface,
        (client) => client.listTools(),
      );
      expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: tool.name !== "status",
        });
        expect(tool.inputSchema.properties ?? {}).not.toHaveProperty("token");
      }
    },
  );

  it("hides advanced page options from ChatGPT", async () => {
    const { tools } = await withClient(
      upstream().fetchFn,
      "chatgpt",
      (client) => client.listTools(),
    );
    const options = Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        Object.keys(tool.inputSchema.properties ?? {}).sort(),
      ]),
    );
    expect(options.scrapeMarkdown).toEqual([
      "browserRendering",
      "geoCode",
      "html",
      "timeout",
      "url",
      "waitForSelector",
      "waitUntil",
    ]);
    expect(options.scrapeJson).toEqual([
      "browserRendering",
      "geoCode",
      "html",
      "prompt",
      "screenshot",
      "timeout",
      "url",
      "waitUntil",
    ]);
    expect(options.webSearch).toEqual(["country", "numResults", "query"]);
  });
});

describe("upstream requests", () => {
  it.each([
    [
      "scrapeHtml",
      { url },
      {
        ...PAGE_DEFAULTS,
        ...LOADING_DEFAULTS,
        browserRendering: "false",
        html: "true",
        markdown: "false",
        screenshot: "false",
      },
    ],
    [
      "scrapeMarkdown",
      { url },
      {
        ...PAGE_DEFAULTS,
        ...LOADING_DEFAULTS,
        browserRendering: "false",
        html: "false",
        markdown: "true",
        screenshot: "false",
      },
    ],
    [
      "getScreenshot",
      { url },
      {
        ...PAGE_DEFAULTS,
        ...LOADING_DEFAULTS,
        browserRendering: "true",
        screenshot: "full",
        html: "true",
        markdown: "false",
      },
    ],
    [
      "scrapeJson",
      { url },
      {
        ...PAGE_DEFAULTS,
        browserRendering: "false",
        html: "false",
        screenshot: "false",
        prompt: DEFAULT_JSON_PROMPT,
        agent: "general",
      },
    ],
    ["scrapeBrand", { url }, { action: "brand-scraping", url, bundle: "none" }],
    [
      "webSearch",
      { query: "web scraping" },
      {
        action: "websearch",
        query: "web scraping",
        country: "us",
        numResults: "10",
      },
    ],
  ] as const)(
    "%s sends exactly the CLI's GET query",
    async (name, args, query) => {
      for (const surface of ["default", "chatgpt"] as const) {
        const { fetchFn, requests } = upstream();
        const result = await callTool(name, args, fetchFn, surface);
        expect(result.isError).not.toBe(true);
        expect(requests).toHaveLength(1);
        expect(requests[0]!.method).toBe("GET");
        expect(requests[0]!.body).toBeUndefined();
        expect(requests[0]!.url.origin + requests[0]!.url.pathname).toBe(
          "https://api.mrscraper.com/",
        );
        expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual(
          query,
        );
        expect(requests[0]!.headers).toMatchObject({
          Authorization: "Bearer test-token",
          "x-api-token": "test-token",
        });
      }
    },
  );

  it("passes options through and keeps forced values", async () => {
    const { fetchFn, requests } = upstream();
    await callTool(
      "scrapeMarkdown",
      { url, html: true, browserRendering: false },
      fetchFn,
    );
    await callTool(
      "getScreenshot",
      {
        url,
        screenshot: "top",
        html: false,
        markdown: true,
        super: true,
        geoCode: "ID",
        maxRetries: 0,
        proxy: "http://user:pass@proxy.example:8080",
        waitForSelector: "#main",
        saveResult: true,
      },
      fetchFn,
    );
    await callTool(
      "webSearch",
      { query: "  running shoes  ", country: "GB", numResults: 20 },
      fetchFn,
    );
    const [markdown, screenshot, search] = requests.map(({ url }) =>
      Object.fromEntries(url.searchParams),
    );
    expect(markdown).toMatchObject({
      html: "true",
      markdown: "true",
      browserRendering: "true",
    });
    expect(screenshot).toMatchObject({
      screenshot: "top",
      html: "false",
      markdown: "true",
      browserRendering: "true",
      super: "true",
      geoCode: "id",
      maxRetries: "0",
      proxy: "http://user:pass@proxy.example:8080",
      waitForSelector: "#main",
      saveResult: "true",
    });
    expect(search).toEqual({
      action: "websearch",
      query: "running shoes",
      country: "gb",
      numResults: "20",
    });
  });

  it("treats null optional options as omitted", async () => {
    const { fetchFn, requests } = upstream();
    await callTool(
      "scrapeHtml",
      { url, proxy: null, maxRetries: null, waitForSelector: null },
      fetchFn,
    );
    for (const key of ["proxy", "maxRetries", "waitForSelector"]) {
      expect(requests[0]!.url.searchParams.has(key)).toBe(false);
    }
  });

  it.each([
    ["scrapeHtml", { url, tokenCap: 100 }],
    ["scrapeHtml", { url, record: true }],
    ["scrapeHtml", { url, action: "brand-scraping" }],
    ["scrapeHtml", { url, markdown: true }],
    ["scrapeMarkdown", { url, screenshot: "full" }],
    ["getScreenshot", { url, browserRendering: false }],
    ["scrapeJson", { url, waitForSelector: "#main" }],
    ["scrapeJson", { url, blockResources: true }],
    ["scrapeJson", { url, returnCookie: true }],
    ["scrapeBrand", { url, bundle: "full" }],
    ["webSearch", { query: "shoes", timeout: 30 }],
  ])("%s rejects %j without calling upstream", async (name, args) => {
    const { fetchFn, requests } = upstream();
    const result = await callTool(name, args, fetchFn);
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });

  it("rejects options hidden from ChatGPT", async () => {
    const { fetchFn, requests } = upstream();
    const result = await callTool(
      "scrapeHtml",
      { url, proxy: "http://proxy.example" },
      fetchFn,
      "chatgpt",
    );
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });
});

describe("results", () => {
  it("returns the envelope as structured content and JSON text", async () => {
    const result = await callTool(
      "webSearch",
      { query: "web scraping" },
      upstream({ success: true, data: [] }).fetchFn,
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      status_code: 200,
      data: { success: true, data: [] },
    });
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent, null, 2) },
    ]);
  });

  it.each([
    ["an HTTP error", "scrapeHtml", { message: "Limit reached" }, 429],
    ["success: false", "scrapeJson", { success: false, data: null }, 200],
    ["a page error", "getScreenshot", { html: null, error: "Timeout" }, 200],
    [
      "a failed brand job",
      "scrapeBrand",
      { data: { job_id: "job-1", status: "failed" } },
      200,
    ],
  ])("flags %s as isError", async (_case, name, body, status) => {
    const result = await callTool(
      name,
      { url },
      upstream(body, {
        status,
        headers: { "set-cookie": "secret", "x-api-token": "secret" },
      }).fetchFn,
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status_code: status });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not flag a successful page with a null error", async () => {
    const result = await callTool(
      "getScreenshot",
      { url },
      upstream({ screenshot: "base64", html: "<p></p>", error: null }).fetchFn,
    );
    expect(result.isError).not.toBe(true);
  });

  it("drops the HTML the API returns for a screenshot taken with html=false", async () => {
    const fetchFn = upstream({ screenshot: "base64", html: "<p></p>" }).fetchFn;
    const without = await callTool(
      "getScreenshot",
      { url, html: false },
      fetchFn,
    );
    const withHtml = await callTool("getScreenshot", { url }, fetchFn);
    expect(without.structuredContent).toMatchObject({
      data: { screenshot: "base64", html: null },
    });
    expect(withHtml.structuredContent).toMatchObject({
      data: { screenshot: "base64", html: "<p></p>" },
    });
  });

  it("summarizes the account without credentials", async () => {
    const result = await callTool(
      "status",
      {},
      upstream({
        data: {
          tokenLimit: 100,
          tokenUsage: 20,
          user: { name: "User" },
          latestApiToken: "secret",
        },
      }).fetchFn,
    );
    expect(result.structuredContent).toMatchObject({
      data: { account: { token_remaining: 80, user: { name: "User" } } },
    });
    expect(JSON.stringify(result)).not.toContain('"secret"');
  });
});

describe("input validation", () => {
  it.each([
    { url: "file:///tmp/a" },
    { url, timeout: 301 },
    { url, timeout: 0 },
    { url, maxRetries: -1 },
    { url, geoCode: "usa" },
    { url, waitUntil: "networkidle" },
    { url, superMode: true },
  ])("rejects invalid page input %j", (input) =>
    expect(() => scrapeHtmlInputSchema.parse(input)).toThrow(),
  );

  it("rejects invalid screenshot and JSON controls", () => {
    expect(() =>
      getScreenshotInputSchema.parse({ url, screenshot: true }),
    ).toThrow();
    expect(() => scrapeJsonInputSchema.parse({ url, prompt: " " })).toThrow();
  });

  it.each([
    { query: " " },
    { query: "a".repeat(1001) },
    { query: "ok", country: "usa" },
    { query: "ok", numResults: 9 },
    { query: "ok", numResults: 101 },
    { query: "ok", numResults: 10.5 },
  ])("rejects invalid search input %j", (input) =>
    expect(() => webSearchInputSchema.parse(input)).toThrow(),
  );

  it("counts query length in Unicode characters like the CLI", () => {
    expect(() =>
      webSearchInputSchema.parse({ query: "😀".repeat(1000) }),
    ).not.toThrow();
    expect(() =>
      webSearchInputSchema.parse({ query: "😀".repeat(1001) }),
    ).toThrow();
  });
});
