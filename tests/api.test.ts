import { describe, expect, it, vi } from "vitest";

import { scraperApi, searchQuery, webSearchApi } from "../src/api.js";
import { request, sanitizeResponseData } from "../src/http.js";

function mockFetch(
  implementation: (url: URL, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) =>
    implementation(new URL(String(input)), init || {}),
  ) as unknown as typeof fetch;
}

describe("HTTP helpers", () => {
  it("removes sensitive headers and nested credentials", async () => {
    const fetchFn = mockFetch(() =>
      Response.json(
        {
          latestApiToken: "atk_fakefakefakefake",
          curl: "curl 'https://api.example/?token=atk_fakefakefakefake' -H 'x-api-token: atk_fakefakefakefake'",
          tokenUsage: 12,
        },
        {
          headers: {
            "set-cookie": "secret-cookie",
            "x-api-token": "secret-token",
            "x-request-id": "request-1",
            "x-worker-name": "search-worker-1",
          },
        },
      ),
    );
    const result = await request("GET", "https://www.scrapethissite.com/", {
      fetchFn,
    });
    expect(result.headers).not.toHaveProperty("set-cookie");
    expect(result.headers).not.toHaveProperty("x-api-token");
    expect(result.headers).not.toHaveProperty("x-worker-name");
    expect(result.headers["x-request-id"]).toBe("request-1");
    expect(result.data).toMatchObject({
      latestApiToken: "[REDACTED]",
      tokenUsage: 12,
    });
    expect(JSON.stringify(result)).not.toContain("atk_fakefakefakefake");
  });

  it("preserves extracted scraper data while redacting credential metadata", () => {
    const sanitized = sanitizeResponseData({
      data: {
        id: "result-1",
        scraperId: "scraper-1",
        data: { token: "user-requested-value" },
        latestApiToken: "atk_fakefakefakefake",
      },
    });
    expect(sanitized).toEqual({
      data: {
        id: "result-1",
        scraperId: "scraper-1",
        data: { token: "user-requested-value" },
        latestApiToken: "[REDACTED]",
      },
    });
  });

  it("preserves non-JSON response bodies exactly", async () => {
    const html = "<p>Product token: atk_abcdefghijkl</p>";
    const fetchFn = mockFetch(
      () => new Response(html, { headers: { "content-type": "text/html" } }),
    );
    const result = await request("GET", "https://www.scrapethissite.com/", {
      fetchFn,
    });
    expect(result.data).toBe(html);
  });

  it("returns a safe timeout envelope", async () => {
    const fetchFn = vi.fn(
      (_input: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const result = await request("GET", "https://www.scrapethissite.com/", {
      timeout: 0.001,
      fetchFn,
    });
    expect(result).toMatchObject({
      status_code: null,
      data: null,
      headers: {},
    });
    expect(result.error).toContain("timed out");
  });
});

describe("Python SDK request compatibility", () => {
  it("POSTs page options in the query and the URL and retry controls in JSON", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(init.method).toBe("POST");
      expect(url.origin).toBe("https://api.mrscraper.com");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        token: "test-token",
        timeout: "45",
        geoCode: "ID",
        proxyCountry: "SG",
        browserRendering: "true",
        super: "true",
        useProxy: "false",
        proxy: "user:pass@proxy.example:8000",
        html: "true",
        markdown: "true",
        waitForSelector: ".ready",
        warmStart: "true",
        screenshot: "true",
        blockResources: "true",
        bypassProxy: "true",
        cookieJar: "domain=example.com&country=sg",
        headers: '{"accept-language":"en-US"}',
        stream: "true",
      });
      expect(JSON.parse(String(init.body))).toEqual({
        url: "https://example.com/page",
        maxRetries: 4,
        tokenCap: 100,
      });
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer test-token");
      expect(headers.get("x-api-token")).toBe("test-token");
      expect(headers.get("x-discard-token-secret")).toBe("discard-secret");
      expect(headers.get("content-type")).toBe("application/json");
      return Response.json({
        html: "<p>Hello</p>",
        markdown: "Hello",
        screenshot: "image-data",
      });
    });
    const result = await scraperApi({
      token: "test-token",
      url: "https://example.com/page",
      timeout: 45,
      geoCode: "ID",
      proxyCountry: "SG",
      browserRendering: false,
      super: true,
      useProxy: false,
      proxy: "user:pass@proxy.example:8000",
      markdown: true,
      waitForSelector: ".ready",
      homePage: true,
      screenshot: true,
      blockResources: true,
      bypassProxy: true,
      cookieJar: "domain=example.com&country=sg",
      headers: { "accept-language": "en-US" },
      maxRetries: 4,
      tokenCap: 100,
      stream: true,
      discardTokenSecret: "discard-secret",
      fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.data).toMatchObject({
      markdown: "Hello",
      screenshot: "image-data",
    });
  });

  it("keeps automatic browser fallback by omitting unset options", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(Object.fromEntries(url.searchParams)).toEqual({
        token: "test-token",
        timeout: "120",
        geoCode: "US",
        html: "true",
        markdown: "false",
      });
      expect(JSON.parse(String(init.body))).toEqual({
        url: "https://example.com",
        maxRetries: 3,
      });
      return new Response("<p>Hello</p>");
    });
    await scraperApi({
      token: "test-token",
      url: "https://example.com",
      fetchFn,
    });
  });

  it("preserves explicit false browser/stream/output controls and zero retry budgets", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(url.searchParams.get("browserRendering")).toBe("false");
      expect(url.searchParams.get("stream")).toBe("false");
      expect(url.searchParams.get("html")).toBe("false");
      expect(JSON.parse(String(init.body))).toEqual({
        url: "https://example.com",
        maxRetries: 0,
        tokenCap: 0,
      });
      return new Response("Hello");
    });
    await scraperApi({
      token: "test",
      url: "https://example.com",
      browserRendering: false,
      stream: false,
      html: false,
      maxRetries: 0,
      tokenCap: 0,
      fetchFn,
    });
  });

  it("keeps OAuth credentials only in Authorization", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(url.searchParams.has("token")).toBe(false);
      expect(new Headers(init.headers).get("x-api-token")).toBeNull();
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer header.payload.signature",
      );
      return Response.json({ ok: true });
    });
    await scraperApi({
      token: "header.payload.signature",
      url: "https://example.com",
      fetchFn,
    });
    await webSearchApi({
      token: "header.payload.signature",
      query: "example",
      fetchFn,
    });
  });

  it("does not leak the query token when a network error includes the URL", async () => {
    const fetchFn = mockFetch((url) => {
      throw new Error(`Failed to load ${url}`);
    });
    const result = await scraperApi({
      token: "query-secret",
      url: "https://example.com",
      fetchFn,
    });
    expect(result.error).toContain("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("query-secret");
  });

  it("posts the websearch action to the Scraper API host", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(init.method).toBe("POST");
      expect(url.href).toBe("https://api.mrscraper.com/");
      const headers = new Headers(init.headers);
      expect(headers.get("x-api-token")).toBe("atk_testtesttesttest");
      expect(headers.get("authorization")).toBe("Bearer atk_testtesttesttest");
      expect(JSON.parse(String(init.body))).toEqual({
        action: "websearch",
        query: "running shoes",
        country: "id",
        numResults: 30,
      });
      return Response.json({ success: true, data: [], tokenUsage: 1 });
    });
    const result = await webSearchApi({
      token: "atk_testtesttesttest",
      query: "running shoes",
      country: "ID",
      numResults: 30,
      fetchFn,
    });
    expect(result.status_code).toBe(200);
  });

  it("takes the query from text or from the q parameter of a search results URL", () => {
    expect(searchQuery(" site:example.com ")).toBe("site:example.com");
    expect(
      searchQuery("https://search.example/results?q=running+shoes&page=2"),
    ).toBe("running shoes");
    expect(() => searchQuery("https://search.example/results")).toThrow(
      "q parameter",
    );
    expect(() => searchQuery("  ")).toThrow("query is required");
  });
});
