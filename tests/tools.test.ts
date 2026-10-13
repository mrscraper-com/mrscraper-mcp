import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import { TOOL_NAMES } from "../src/config.js";
import { createMrscraperServer } from "../src/server.js";
import {
  scraperAPIInputSchema,
  scraperAPITool,
  webSearchInputSchema,
  webSearchTool,
} from "../src/tools.js";

function mockFetch(
  implementation: (url: URL, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) =>
    implementation(new URL(String(input)), init || {}),
  ) as unknown as typeof fetch;
}

async function connect(fetchFn: typeof fetch) {
  const server = createMrscraperServer(
    { era: "legacy" },
    {
      resolveToken: () => "test-token",
      fetchFn,
    },
  );
  const client = new Client({ name: "tools-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("SDK-compatible tool inputs", () => {
  it.each(["ftp://example.com/file", "relative/path", "not-a-url"])(
    "rejects a non-HTTP page URL: %s",
    (url) => {
      expect(() => scraperAPIInputSchema.parse({ url })).toThrow();
    },
  );

  it.each([
    { timeout: 0 },
    { timeout: 301 },
    { timeout: 1.5 },
    { max_retries: -1 },
    { token_cap: -1 },
    { screenshot: "true" },
  ])("rejects invalid scraperAPI controls: %j", (options) => {
    expect(() =>
      scraperAPIInputSchema.parse({ url: "https://example.com", ...options }),
    ).toThrow();
  });

  it("allows automatic browser fallback with a selector and forces browser loading for screenshots", async () => {
    const requests: URL[] = [];
    const fetchFn = mockFetch((url) => {
      requests.push(url);
      return new Response("<p>Hello</p>");
    });
    await scraperAPITool(
      "test",
      scraperAPIInputSchema.parse({
        url: "https://example.com",
        wait_for_selector: ".ready",
      }),
      { fetchFn },
    );
    await scraperAPITool(
      "test",
      scraperAPIInputSchema.parse({
        url: "https://example.com",
        screenshot: true,
        browser_rendering: false,
      }),
      { fetchFn },
    );
    expect(requests[0]!.searchParams.has("browserRendering")).toBe(false);
    expect(requests[0]!.searchParams.get("waitForSelector")).toBe(".ready");
    expect(requests[1]!.searchParams.get("browserRendering")).toBe("true");
  });

  it("maps snake-case loading options to SDK query fields", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(url.searchParams.get("geoCode")).toBe("ID");
      expect(url.searchParams.get("proxyCountry")).toBe("SG");
      expect(url.searchParams.get("super")).toBe("true");
      expect(url.searchParams.get("useProxy")).toBe("false");
      expect(url.searchParams.get("warmStart")).toBe("true");
      expect(url.searchParams.get("blockResources")).toBe("true");
      expect(url.searchParams.get("bypassProxy")).toBe("true");
      expect(url.searchParams.get("cookieJar")).toBe("domain=example.com");
      expect(JSON.parse(String(init.body))).toEqual({
        url: "https://example.com",
        maxRetries: 0,
        tokenCap: 0,
      });
      return Response.json({ markdown: "Hello" });
    });
    await scraperAPITool(
      "test",
      scraperAPIInputSchema.parse({
        url: "https://example.com",
        geo_code: "ID",
        proxy_country: "SG",
        super: true,
        use_proxy: false,
        home_page: true,
        block_resources: true,
        bypass_proxy: true,
        cookie_jar: "domain=example.com",
        max_retries: 0,
        token_cap: 0,
      }),
      { fetchFn },
    );
  });

  it.each([
    { url: " " },
    { url: "query", page: 0 },
    { url: "query", timeout: 0 },
    { url: "query", format: "xml" },
  ])("rejects invalid webSearch controls: %j", (input) => {
    expect(() => webSearchInputSchema.parse(input)).toThrow();
  });

  it("uses SDK defaults and returns parsed JSON only when requested", async () => {
    const bodies: unknown[] = [];
    const fetchFn = mockFetch((_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ organic_results: [] });
    });
    await webSearchTool("test", webSearchInputSchema.parse({ url: "test" }), {
      fetchFn,
    });
    await webSearchTool(
      "test",
      webSearchInputSchema.parse({
        url: "test",
        raw: false,
        render_js: true,
        timeout: 1.5,
      }),
      { fetchFn },
    );
    expect(bodies).toEqual([
      { query: "test", format: "html", renderJs: false },
      { query: "test", format: "json", renderJs: true },
    ]);
  });
});

describe("MCP tool surface", () => {
  it("exposes exactly two complete tools without API-token arguments", async () => {
    const { client, server } = await connect(
      mockFetch(() => Response.json({ ok: true })),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
      for (const tool of tools) {
        expect(tool.title).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.outputSchema).toBeDefined();
        expect(tool.annotations).toMatchObject({
          title: tool.title,
          readOnlyHint: true,
          openWorldHint: true,
          destructiveHint: false,
        });
        expect(tool.inputSchema.required).toEqual(["url"]);
        expect(tool.inputSchema.properties).not.toHaveProperty("token");
        expect(tool.inputSchema.properties).not.toHaveProperty("api_key");
        for (const property of Object.values(
          tool.inputSchema.properties || {},
        )) {
          expect(
            (property as { description?: string }).description,
          ).toBeTruthy();
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("calls both tools through MCP with the structured response envelope", async () => {
    const fetchFn = mockFetch((url) =>
      url.pathname.includes("/serp/")
        ? Response.json({
            organic_results: [
              { title: "Example", link: "https://example.com" },
            ],
          })
        : new Response("<p>Hello</p>", {
            headers: { "content-type": "text/html" },
          }),
    );
    const { client, server } = await connect(fetchFn);
    try {
      for (const name of TOOL_NAMES) {
        const result = await client.callTool({
          name,
          arguments:
            name === "scraperAPI"
              ? { url: "https://example.com" }
              : { url: "example", raw: false },
        });
        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toMatchObject({
          status_code: 200,
          headers: expect.any(Object),
        });
        expect(result.content).toEqual([
          {
            type: "text",
            text: JSON.stringify(result.structuredContent, null, 2),
          },
        ]);
      }
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it.each(["fetch", "scrape", "serp", "status", "rerun", "results", "result"])(
    "removes the old %s tool",
    async (name) => {
      const fetchFn = mockFetch(() => Response.json({ ok: true }));
      const { client, server } = await connect(fetchFn);
      try {
        await expect(
          client.callTool({ name, arguments: {} }),
        ).rejects.toThrow();
        expect(fetchFn).not.toHaveBeenCalled();
      } finally {
        await client.close();
        await server.close();
      }
    },
  );

  it("reports upstream failures as MCP errors and strips credentials", async () => {
    const { client, server } = await connect(
      mockFetch(() =>
        Response.json(
          {
            latestApiToken: "secret",
            "x-discard-token-secret": "discard-secret",
          },
          {
            status: 429,
            headers: {
              "set-cookie": "secret",
              "x-discard-token-secret": "discard-secret",
            },
          },
        ),
      ),
    );
    try {
      const result = await client.callTool({
        name: "scraperAPI",
        arguments: { url: "https://example.com" },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        status_code: 429,
        error: "HTTP 429",
      });
      const output = result.structuredContent as Record<string, unknown>;
      expect(output.headers).not.toHaveProperty("set-cookie");
      expect(output.headers).not.toHaveProperty("x-discard-token-secret");
      expect(output.data).toMatchObject({
        latestApiToken: "[REDACTED]",
        "x-discard-token-secret": "[REDACTED]",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
