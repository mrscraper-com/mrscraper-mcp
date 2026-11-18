import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { TOOL_NAMES, type ToolSurface } from "../src/config.js";
import { createMrscraperServer } from "../src/server.js";
import {
  scrapeHtmlInputSchema,
  scrapeJsonInputSchema,
  getScreenshotInputSchema,
  webSearchInputSchema,
} from "../src/tools.js";

async function connect(
  fetchFn: typeof fetch,
  surface: ToolSurface = "default",
) {
  const server = createMrscraperServer(
    { era: "legacy" },
    { resolveToken: () => "test-token", fetchFn, surface },
  );
  const client = new Client({ name: "tools-test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return { client, server };
}
const fake = () =>
  vi.fn(async () =>
    Response.json({
      data: {
        tokenLimit: 100,
        tokenUsage: 20,
        user: { name: "User" },
        latestApiToken: "secret",
      },
    }),
  ) as unknown as typeof fetch;

describe("MCP seven-service surface", () => {
  it.each(["default", "chatgpt"] as const)(
    "lists seven tools with accurate hints on %s",
    async (surface) => {
      const { client, server } = await connect(fake(), surface);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(TOOL_NAMES);
        for (const tool of tools) {
          expect(tool.annotations).toMatchObject({
            readOnlyHint: tool.name === "account",
            destructiveHint: false,
            openWorldHint: tool.name !== "account",
          });
          expect(tool.inputSchema.properties).not.toHaveProperty("token");
          expect(tool.outputSchema).toBeDefined();
        }
        const html = tools.find((t) => t.name === "scrapeHtml")!;
        if (surface === "chatgpt")
          expect(html.inputSchema.properties).not.toHaveProperty("saveResult");
        else expect(html.inputSchema.properties).toHaveProperty("saveResult");
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
  it.each(TOOL_NAMES)("calls %s with structured content", async (name) => {
    const { client, server } = await connect(fake());
    try {
      const result = await client.callTool({
        name,
        arguments:
          name === "account"
            ? {}
            : name === "webSearch"
              ? { query: "web scraping" }
              : { url: "https://example.com" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ status_code: 200 });
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify(result.structuredContent, null, 2),
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('"secret"');
      if (name === "account")
        expect(result.structuredContent).toMatchObject({
          data: { account: { token_remaining: 80, user: { name: "User" } } },
        });
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("flags HTTP errors and strips credentials", async () => {
    const fetchFn = vi.fn(async () =>
      Response.json(
        { message: "Limit reached" },
        {
          status: 429,
          headers: { "set-cookie": "secret", "x-api-token": "secret" },
        },
      ),
    ) as unknown as typeof fetch;
    const { client, server } = await connect(fetchFn);
    try {
      const result = await client.callTool({
        name: "scrapeHtml",
        arguments: { url: "https://example.com" },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status_code: 429,
        headers: {},
      });
      expect(JSON.stringify(result)).not.toContain("secret");
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("rejects unsupported options before calling upstream", async () => {
    const fetchFn = fake();
    const { client, server } = await connect(fetchFn);
    try {
      const result = await client.callTool({
        name: "scrapeJson",
        arguments: { url: "https://example.com", returnCookie: true },
      });
      expect(result.isError).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("input validation", () => {
  it.each([
    { url: "file:///tmp/a" },
    { url: "https://example.com", timeout: 301 },
    { url: "https://example.com", maxRetries: -1 },
    { url: "https://example.com", geoCode: "usa" },
    { url: "https://example.com", waitUntil: "networkidle" },
  ])("rejects invalid page input %j", (input) =>
    expect(() => scrapeHtmlInputSchema.parse(input)).toThrow(),
  );
  it("rejects invalid screenshot and JSON controls", () => {
    expect(() =>
      getScreenshotInputSchema.parse({
        url: "https://example.com",
        screenshot: true,
      }),
    ).toThrow();
    expect(() =>
      scrapeJsonInputSchema.parse({ url: "https://example.com", prompt: " " }),
    ).toThrow();
    expect(() =>
      scrapeJsonInputSchema.parse({
        url: "https://example.com",
        blockResources: true,
      }),
    ).toThrow();
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
});

it("counts Unicode query characters like the CLI", () => {
  expect(() =>
    webSearchInputSchema.parse({ query: "😀".repeat(1000) }),
  ).not.toThrow();
  expect(() =>
    webSearchInputSchema.parse({ query: "😀".repeat(1001) }),
  ).toThrow();
});
