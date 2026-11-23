import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { TOOL_NAMES, type ToolSurface } from "../src/config.js";
import { createMrscraperServer } from "../src/server.js";
import {
  CHATGPT_HIDDEN_INPUTS,
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
const pageToolNames = [
  "scrapeHtml",
  "scrapeMarkdown",
  "getScreenshot",
  "scrapeJson",
] as const;

describe("MCP seven-service surface", () => {
  it.each(["default", "chatgpt"] as const)(
    "lists seven tools with accurate hints on %s",
    async (surface) => {
      const { client, server } = await connect(fake(), surface);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual([
          "status",
          "scrapeHtml",
          "scrapeMarkdown",
          "getScreenshot",
          "scrapeBrand",
          "scrapeJson",
          "webSearch",
        ]);
        for (const tool of tools) {
          const canSave = Object.hasOwn(
            tool.inputSchema.properties ?? {},
            "saveResult",
          );
          expect(tool.annotations).toMatchObject({
            readOnlyHint: !canSave,
            destructiveHint: false,
            openWorldHint: tool.name !== "status",
          });
          expect(tool.inputSchema.properties).not.toHaveProperty("token");
          expect(tool.outputSchema).toBeDefined();
        }
        const search = tools.find((tool) => tool.name === "webSearch")!;
        expect(Object.keys(search.inputSchema.properties ?? {}).sort()).toEqual(
          ["country", "numResults", "query"],
        );
        for (const name of pageToolNames) {
          const properties = tools.find((tool) => tool.name === name)!
            .inputSchema.properties;
          expect(properties).not.toHaveProperty("superMode");
          expect(properties).toHaveProperty("saveResult");
          if (surface === "chatgpt") {
            for (const input of CHATGPT_HIDDEN_INPUTS) {
              expect(properties).not.toHaveProperty(input);
            }
          } else {
            expect(properties).toHaveProperty("super", {
              type: "boolean",
              default: false,
              description: "Whether to route the request through real devices.",
            });
          }
        }
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
  it.each(pageToolNames)("forwards the super API key for %s", async (name) => {
    const fetchFn = fake();
    const { client, server } = await connect(fetchFn);
    try {
      for (const value of [false, true]) {
        const result = await client.callTool({
          name,
          arguments: { url: "https://example.com", super: value },
        });
        expect(result.isError).not.toBe(true);
        const [requestUrl] = vi.mocked(fetchFn).mock.calls.at(-1)!;
        const params = new URL(String(requestUrl)).searchParams;
        expect(params.get("super")).toBe(String(value));
        expect(params.has("superMode")).toBe(false);
      }
      const unsupported = await client.callTool({
        name,
        arguments: { url: "https://example.com", superMode: true },
      });
      expect(unsupported.isError).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it.each(pageToolNames)(
    "supports CLI dashboard saving on the ChatGPT %s tool",
    async (name) => {
      const fetchFn = fake();
      const { client, server } = await connect(fetchFn, "chatgpt");
      try {
        const result = await client.callTool({
          name,
          arguments: { url: "https://example.com", saveResult: true },
        });
        expect(result.isError).not.toBe(true);
        const [url] = vi.mocked(fetchFn).mock.calls[0]!;
        expect(new URL(String(url)).searchParams.get("saveResult")).toBe(
          "true",
        );
      } finally {
        await client.close();
        await server.close();
      }
    },
  );

  it.each(pageToolNames)(
    "keeps the proxy, real-device, retry, cookie, and warm-start inputs off the ChatGPT %s tool",
    async (name) => {
      const values: Record<string, unknown> = {
        proxy: "http://user:pass@proxy.example:8080",
        proxyCountry: "de",
        super: true,
        maxRetries: 2,
        returnCookie: true,
        warmStart: true,
      };
      const full = await connect(fake());
      const { tools } = await full.client.listTools();
      await full.client.close();
      await full.server.close();
      const offeredElsewhere = Object.keys(
        tools.find((tool) => tool.name === name)!.inputSchema.properties ?? {},
      ).filter((input) => Object.hasOwn(values, input));
      expect(offeredElsewhere.length).toBeGreaterThan(0);

      const fetchFn = fake();
      const { client, server } = await connect(fetchFn, "chatgpt");
      try {
        for (const input of offeredElsewhere) {
          const refused = await client.callTool({
            name,
            arguments: { url: "https://example.com", [input]: values[input] },
          });
          expect(refused.isError, input).toBe(true);
        }
        expect(fetchFn).not.toHaveBeenCalled();

        const result = await client.callTool({
          name,
          arguments: { url: "https://example.com" },
        });
        expect(result.isError).not.toBe(true);
        const [url] = vi.mocked(fetchFn).mock.calls[0]!;
        const params = new URL(String(url)).searchParams;
        expect(params.get("super")).toBe("false");
        expect(params.get("proxyCountry")).toBe("us");
        expect(params.has("proxy")).toBe(false);
        expect(params.has("maxRetries")).toBe(false);
      } finally {
        await client.close();
        await server.close();
      }
    },
  );

  it.each(["scrapeHtml", "scrapeMarkdown"])(
    "forwards warmStart for %s",
    async (name) => {
      const fetchFn = fake();
      const { client, server } = await connect(fetchFn);
      try {
        for (const warmStart of [false, true]) {
          const result = await client.callTool({
            name,
            arguments: { url: "https://example.com", warmStart },
          });
          expect(result.isError).not.toBe(true);
          const [url] = vi.mocked(fetchFn).mock.calls.at(-1)!;
          expect(new URL(String(url)).searchParams.get("warmStart")).toBe(
            String(warmStart),
          );
        }
        const invalid = await client.callTool({
          name,
          arguments: { url: "https://example.com", warmStart: "true" },
        });
        expect(invalid.isError).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(2);
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
  it.each(["getScreenshot", "scrapeJson"])(
    "rejects warmStart on %s",
    async (name) => {
      const fetchFn = fake();
      const { client, server } = await connect(fetchFn);
      try {
        const result = await client.callTool({
          name,
          arguments: { url: "https://example.com", warmStart: true },
        });
        expect(result.isError).toBe(true);
        expect(fetchFn).not.toHaveBeenCalled();
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
          name === "status"
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
      if (name === "status") {
        expect(result.structuredContent).toEqual({
          status_code: 200,
          data: {
            data: {
              tokenLimit: 100,
              tokenUsage: 20,
              user: { name: "User" },
              latestApiToken: "secret",
            },
          },
          headers: expect.any(Object),
        });
        expect(result.structuredContent).not.toHaveProperty("kind");
      } else {
        expect(JSON.stringify(result)).not.toContain('"secret"');
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
  it.each([
    { data: [{ tokenUsage: 1 }, { tokenUsage: 2 }], meta: { total: 2 } },
    { data: null, message: "No account" },
    null,
    [],
  ])("preserves the raw status body %j", async (body) => {
    const fetchFn = vi.fn(async () =>
      Response.json(body),
    ) as unknown as typeof fetch;
    const { client, server } = await connect(fetchFn);
    try {
      const result = await client.callTool({ name: "status", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        status_code: 200,
        data: body,
        headers: expect.any(Object),
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
    { query: "ok", timeout: 120 },
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
