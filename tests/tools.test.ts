import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";
import { TOOL_NAMES } from "../src/config.js";
import { createMrscraperServer } from "../src/server.js";
import {
  scrapeHtmlInputSchema,
  scrapeJsonInputSchema,
  getScreenshotInputSchema,
  webSearchInputSchema,
} from "../src/tools.js";

async function connect(fetchFn: typeof fetch) {
  const server = createMrscraperServer(
    { era: "legacy" },
    { resolveToken: () => "test-token", fetchFn },
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

// The documented inputs per tool, in order, and the ones with a default the server sends.
const inputs: Record<(typeof TOOL_NAMES)[number], string[]> = {
  status: [],
  scrapeHtml: [
    "url",
    "browserRendering",
    "timeout",
    "warmStart",
    "blockResources",
    "waitForSelector",
    "geoCode",
    "maxAge",
    "maxRetries",
    "screenshot",
  ],
  scrapeMarkdown: [
    "url",
    "browserRendering",
    "timeout",
    "geoCode",
    "warmStart",
    "blockResources",
    "waitForSelector",
    "maxAge",
    "maxRetries",
  ],
  getScreenshot: [
    "url",
    "screenshot",
    "timeout",
    "geoCode",
    "waitForSelector",
    "maxAge",
    "maxRetries",
  ],
  scrapeBrand: ["url"],
  scrapeJson: [
    "url",
    "prompt",
    "html",
    "screenshot",
    "browserRendering",
    "waitForSelector",
    "warmStart",
    "blockResources",
    "timeout",
    "geoCode",
    "maxAge",
    "maxRetries",
  ],
  webSearch: ["query", "country", "numResults"],
};
const defaults: Record<string, Record<string, unknown>> = {
  scrapeHtml: { maxAge: 0 },
  scrapeMarkdown: { maxAge: 0 },
  getScreenshot: { screenshot: "full", maxAge: 0 },
  scrapeJson: { html: true, screenshot: false, maxAge: 0 },
};

describe("MCP seven-service surface", () => {
  it("lists the seven tools with the documented inputs and hints", async () => {
    const { client, server } = await connect(fake());
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
      for (const tool of tools) {
        const name = tool.name as (typeof TOOL_NAMES)[number];
        const properties = tool.inputSchema.properties ?? {};
        expect(Object.keys(properties), name).toEqual(inputs[name]);
        const sentByDefault = Object.fromEntries(
          Object.entries(properties).flatMap(([key, field]) =>
            field && typeof field === "object" && "default" in field
              ? [[key, field.default]]
              : [],
          ),
        );
        expect(sentByDefault, name).toEqual(defaults[name] ?? {});
        // The page tools always save the result to the Result tab.
        expect(tool.annotations).toMatchObject({
          readOnlyHint: !(pageToolNames as readonly string[]).includes(name),
          destructiveHint: false,
          openWorldHint: name !== "status",
        });
        expect(tool.outputSchema).toBeDefined();
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
  it.each(pageToolNames)(
    "sends only the fixed values, maxAge and saveResult for a bare %s call",
    async (name) => {
      const fetchFn = fake();
      const { client, server } = await connect(fetchFn);
      try {
        const result = await client.callTool({
          name,
          arguments: { url: "https://example.com" },
        });
        expect(result.isError).not.toBe(true);
        const [url] = vi.mocked(fetchFn).mock.calls[0]!;
        const params = Object.fromEntries(new URL(String(url)).searchParams);
        expect(params).toMatchObject({ maxAge: "0", saveResult: "true" });
        for (const unset of ["timeout", "geoCode", "warmStart", "maxRetries"])
          expect(params, unset).not.toHaveProperty(unset);
        if (name !== "getScreenshot")
          expect(params).not.toHaveProperty("browserRendering");
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
  it.each(pageToolNames)(
    "rejects inputs outside the docs on %s before calling upstream",
    async (name) => {
      const fetchFn = fake();
      const { client, server } = await connect(fetchFn);
      try {
        for (const [input, value] of [
          ["super", true],
          ["proxy", "http://user:pass@proxy.example:8080"],
          ["proxyCountry", "de"],
          ["waitUntil", "load"],
          ["returnCookie", true],
          ["saveResult", false],
          ["tokenCap", 10],
          ["action", "brand-scraping"],
        ] as const) {
          const refused = await client.callTool({
            name,
            arguments: { url: "https://example.com", [input]: value },
          });
          expect(refused.isError, input).toBe(true);
        }
        expect(fetchFn).not.toHaveBeenCalled();
      } finally {
        await client.close();
        await server.close();
      }
    },
  );
  it.each(["scrapeHtml", "scrapeMarkdown", "scrapeJson"])(
    "forwards warmStart and browserRendering false instead of dropping it for %s",
    async (name) => {
      const fetchFn = fake();
      const { client, server } = await connect(fetchFn);
      try {
        for (const value of [false, true]) {
          const result = await client.callTool({
            name,
            arguments: {
              url: "https://example.com",
              warmStart: value,
              browserRendering: value,
            },
          });
          expect(result.isError).not.toBe(true);
          const [url] = vi.mocked(fetchFn).mock.calls.at(-1)!;
          const params = new URL(String(url)).searchParams;
          expect(params.get("warmStart")).toBe(String(value));
          expect(params.get("browserRendering")).toBe(String(value));
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
  it.each(["warmStart", "blockResources", "browserRendering", "html"])(
    "rejects %s on getScreenshot",
    async (input) => {
      const fetchFn = fake();
      const { client, server } = await connect(fetchFn);
      try {
        const result = await client.callTool({
          name: "getScreenshot",
          arguments: { url: "https://example.com", [input]: true },
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
  it("rejects scrapeBrand inputs other than url", async () => {
    const fetchFn = fake();
    const { client, server } = await connect(fetchFn);
    try {
      for (const input of ["geoCode", "timeout", "warmStart"]) {
        const result = await client.callTool({
          name: "scrapeBrand",
          arguments: {
            url: "https://example.com",
            [input]:
              input === "timeout" ? 60 : input === "geoCode" ? "us" : true,
          },
        });
        expect(result.isError, input).toBe(true);
      }
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
    { url: "https://example.com", timeout: 331 },
    { url: "https://example.com", maxRetries: -1 },
    { url: "https://example.com", maxAge: -1 },
    { url: "https://example.com", maxAge: 604800001 },
    { url: "https://example.com", geoCode: "usa" },
    { url: "https://example.com", waitForSelector: "x".repeat(501) },
    { url: "https://example.com", screenshot: "side" },
    { url: "https://example.com", screenshot: true },
  ])("rejects invalid page input %j", (input) =>
    expect(() => scrapeHtmlInputSchema.parse(input)).toThrow(),
  );
  it("rejects invalid screenshot and JSON controls", () => {
    for (const screenshot of [true, "1280x800-301", "99x800"])
      expect(() =>
        getScreenshotInputSchema.parse({
          url: "https://example.com",
          screenshot,
        }),
      ).toThrow();
    expect(
      getScreenshotInputSchema.parse({
        url: "https://example.com",
        screenshot: "1920x1080-75",
      }).screenshot,
    ).toBe("1920x1080-75");
    expect(() =>
      scrapeJsonInputSchema.parse({ url: "https://example.com", prompt: " " }),
    ).toThrow();
    expect(() =>
      scrapeJsonInputSchema.parse({
        url: "https://example.com",
        screenshot: "full",
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
