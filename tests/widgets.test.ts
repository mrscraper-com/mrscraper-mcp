import type { AddressInfo } from "node:net";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpApp } from "../src/app.js";
import {
  WIDGETS,
  WIDGET_MIME_TYPE,
  widgetHtml,
  widgetMeta,
} from "../src/widgets/index.js";
import {
  asSearchResults,
  columnsOf,
  errorMessage,
  findRecords,
  payload,
  scalarEntries,
} from "../ui/data.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function connect() {
  const { app, handler } = createHttpApp({
    host: "127.0.0.1",
    authEnabled: true,
    validateToken: async (token) => token === "valid-key",
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const port = (server.address() as AddressInfo).port;
  const client = new Client({ name: "widget-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      authProvider: { token: async () => "valid-key" },
    }),
  );
  closers.push(async () => {
    await client.close();
    await handler.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return client;
}

describe("widget resources", () => {
  it("publishes every widget with the MCP Apps media type", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    const uris = resources.map((resource) => resource.uri);
    for (const widget of Object.values(WIDGETS)) {
      expect(uris).toContain(widget.uri);
    }
    expect(
      resources.every((resource) => resource.mimeType === WIDGET_MIME_TYPE),
    ).toBe(true);
  });

  it("serves a self-contained document with no external references", async () => {
    const client = await connect();
    const { contents } = await client.readResource({ uri: WIDGETS.serp.uri });
    const document = contents[0];
    expect(document?.mimeType).toBe(WIDGET_MIME_TYPE);

    const html = String((document as { text?: string } | undefined)?.text);
    expect(html).toContain('<div id="mrscraper-root">');
    expect(html).toContain("<style>");

    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("declares an empty CSP allowlist, since widgets need no network", async () => {
    const client = await connect();
    const { contents } = await client.readResource({ uri: WIDGETS.status.uri });
    expect((contents[0] as { _meta?: unknown })._meta).toMatchObject({
      ui: { csp: { connectDomains: [], resourceDomains: [] } },
    });
  });

  it("never lets a bundle terminate its own script element", () => {
    for (const name of Object.keys(WIDGETS) as Array<keyof typeof WIDGETS>) {
      const html = widgetHtml(name);
      const closing = html.match(/<\/script/gi) ?? [];
      expect(closing).toHaveLength(1);
    }
  });

  it("links tools to widgets under both the MCP Apps and ChatGPT keys", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get("serp")?._meta).toMatchObject({
      ui: { resourceUri: WIDGETS.serp.uri },
      "openai/outputTemplate": WIDGETS.serp.uri,
    });
    expect(byName.get("scrape")?._meta).toMatchObject({
      "openai/outputTemplate": WIDGETS.records.uri,
    });

    expect(
      byName.get("fetch")?._meta?.["openai/outputTemplate"],
    ).toBeUndefined();
  });

  it("gives every tool a title, which both directories require", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.every((tool) => Boolean(tool.title))).toBe(true);
    expect(
      tools.every(
        (tool) =>
          tool.annotations?.readOnlyHint !== undefined ||
          tool.annotations?.destructiveHint !== undefined,
      ),
    ).toBe(true);
  });

  it("names both metadata keys with the same URI", () => {
    const meta = widgetMeta("records", "Working…", "Done.");
    expect(meta.ui).toEqual({ resourceUri: WIDGETS.records.uri });
    expect(meta["openai/outputTemplate"]).toBe(WIDGETS.records.uri);
  });
});

describe("widget shape probing", () => {
  it("unwraps the tool result envelope", () => {
    expect(payload({ status_code: 200, data: { a: 1 } })).toEqual({ a: 1 });
    expect(payload({ a: 1 })).toEqual({ a: 1 });
  });

  it("reports a failed request from either signal", () => {
    expect(errorMessage({ error: "boom" })).toBe("boom");
    expect(errorMessage({ status_code: 429 })).toContain("429");
    expect(errorMessage({ status_code: 200 })).toBeNull();
  });

  it("finds the shallowest array of records", () => {
    const found = findRecords({
      meta: { page: 1 },
      results: [{ title: "a" }, { title: "b" }],
    });
    expect(found).toHaveLength(2);
  });

  it("returns null when there is nothing table-like", () => {
    expect(findRecords({ ok: true })).toBeNull();
    expect(findRecords([1, 2, 3])).toBeNull();
  });

  it("orders columns by how many rows use them", () => {
    const columns = columnsOf([
      { name: "a", price: 1 },
      { name: "b" },
      { name: "c", price: 3 },
    ]);
    expect(columns).toEqual(["name", "price"]);
  });

  it("caps column count so a wide extraction stays readable", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`c${index}`, index]),
    );
    expect(columnsOf([wide])).toHaveLength(8);
  });

  it("recognises search results under any of the usual key names", () => {
    expect(
      asSearchResults([
        { title: "T", link: "https://e.example", snippet: "S" },
      ]),
    ).toEqual([{ title: "T", url: "https://e.example", snippet: "S" }]);
    expect(
      asSearchResults([
        { name: "T", url: "https://e.example", description: "S" },
      ]),
    ).toEqual([{ title: "T", url: "https://e.example", snippet: "S" }]);
  });

  it("declines rows that are not search results", () => {
    expect(asSearchResults([{ sku: "A1", price: 9 }])).toEqual([]);

    expect(
      asSearchResults([
        { title: "T", link: "https://e.example" },
        { title: "U" },
      ]),
    ).toEqual([]);
  });

  it("keeps only scalars when rendering a single record as fields", () => {
    expect(
      scalarEntries({ id: "x", count: 2, ok: true, nested: { a: 1 } }),
    ).toEqual([
      ["id", "x"],
      ["count", 2],
      ["ok", true],
    ]);
  });
});
