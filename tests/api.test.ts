import { describe, expect, it, vi } from "vitest";

import {
  scrapeHtml,
  scrapeMarkdown,
  getScreenshot,
  scrapeBrand,
  scrapeJson,
  webSearch,
  getSubscriptionAccountApi,
} from "../src/api.js";
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

describe("CLI service contract", () => {
  it.each([
    [
      "HTML",
      scrapeHtml,
      {
        html: "true",
        markdown: "false",
        screenshot: "false",
        browserRendering: "false",
        warmStart: "false",
        blockResources: "false",
        returnCookie: "false",
      },
    ],
    [
      "Markdown",
      scrapeMarkdown,
      {
        html: "false",
        markdown: "true",
        screenshot: "false",
        browserRendering: "false",
        warmStart: "false",
        blockResources: "false",
        returnCookie: "false",
      },
    ],
    [
      "Screenshot",
      getScreenshot,
      {
        html: "true",
        markdown: "false",
        screenshot: "full",
        browserRendering: "true",
        blockResources: "false",
        returnCookie: "false",
      },
    ],
    [
      "JSON",
      scrapeJson,
      {
        browserRendering: "false",
        html: "false",
        screenshot: "false",
        agent: "general",
        prompt: "Extract all data as complete as possible.",
      },
    ],
  ] as const)("GETs %s with CLI defaults", async (_name, fn, flags) => {
    const fetchFn = mockFetch((url, init) => {
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
      expect(url.origin).toBe("https://api.mrscraper.com");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        url: "https://example.com",
        timeout: "300",
        geoCode: "us",
        proxyCountry: "us",
        super: "false",
        waitUntil: "domcontentloaded",
        saveResult: "false",
        ...flags,
      });
      expect(init.headers).toMatchObject({
        Authorization: "Bearer test",
        "x-api-token": "test",
      });
      return Response.json({ ok: true });
    });
    await fn("https://example.com", { token: "test", fetchFn });
  });
  it("reads status from the CLI platform endpoint", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(init.method).toBe("GET");
      expect(url.href).toBe(
        "https://api.app.mrscraper.com/api/v1/subscription-accounts",
      );
      expect(init.headers).toMatchObject({
        accept: "application/json",
        Authorization: "Bearer test",
        "x-api-token": "test",
      });
      return Response.json({ data: { tokenLimit: 100 } });
    });
    await getSubscriptionAccountApi("test", { fetchFn });
  });
  it("brand and search use only their CLI fields", async () => {
    const seen: Record<string, string>[] = [];
    const fetchFn = mockFetch((url, init) => {
      expect(init.method).toBe("GET");
      expect(url.origin).toBe("https://api.mrscraper.com");
      seen.push(Object.fromEntries(url.searchParams));
      return Response.json({ ok: true });
    });
    await scrapeBrand("https://example.com", { token: "test", fetchFn });
    await webSearch("web scraping", { token: "test", fetchFn });
    await webSearch("  web scraping  ", {
      token: "test",
      fetchFn,
      country: "ID",
      numResults: 20,
    });
    expect(seen).toEqual([
      { url: "https://example.com", action: "brand-scraping", bundle: "none" },
      {
        action: "websearch",
        query: "web scraping",
        country: "us",
        numResults: "10",
      },
      {
        action: "websearch",
        query: "web scraping",
        country: "id",
        numResults: "20",
      },
    ]);
  });
  it("forces Markdown rendering and captures top screenshots", async () => {
    const calls: URL[] = [];
    const fetchFn = mockFetch((url) => {
      calls.push(url);
      return Response.json({
        html: "keep",
        markdown: "# Test",
        screenshot: "base64",
      });
    });
    const md = await scrapeMarkdown("https://example.com", {
      token: "test",
      fetchFn,
      html: true,
      browserRendering: false,
    });
    await getScreenshot("https://example.com", {
      token: "test",
      fetchFn,
      screenshot: "top",
      html: false,
      markdown: true,
      maxRetries: 0,
      saveResult: true,
      returnCookie: true,
    });
    expect(calls[0]!.searchParams.get("browserRendering")).toBe("true");
    expect(md.data).toMatchObject({ html: "keep" });
    expect(Object.fromEntries(calls[1]!.searchParams)).toMatchObject({
      screenshot: "top",
      browserRendering: "true",
      html: "false",
      markdown: "true",
      maxRetries: "0",
      saveResult: "true",
      returnCookie: "true",
    });
  });
  it("JSON defaults and long-prompt POST fallback", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchFn = mockFetch((url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true });
    });
    await scrapeJson("https://example.com", { token: "test", fetchFn });
    const prompt = "é &".repeat(4000);
    await scrapeJson("https://example.com", {
      token: "test",
      fetchFn,
      prompt,
      maxRetries: 0,
    });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toMatchObject({
      agent: "general",
      prompt: "Extract all data as complete as possible.",
      html: "false",
      screenshot: "false",
    });
    expect(calls[1]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      url: "https://example.com",
      agent: "general",
      prompt,
    });
    for (const key of [
      "url",
      "agent",
      "prompt",
      "token",
      "blockResources",
      "returnCookie",
    ])
      expect(calls[1]!.url.searchParams.has(key)).toBe(false);
  });
  it("OAuth JWT credentials stay only in Authorization", async () => {
    const fetchFn = mockFetch((url, init) => {
      expect(url.searchParams.has("token")).toBe(false);
      expect(init.headers).toMatchObject({
        Authorization: "Bearer header.payload.signature",
      });
      expect(init.headers).not.toHaveProperty("x-api-token");
      return Response.json({ ok: true });
    });
    await scrapeHtml("https://example.com", {
      token: "header.payload.signature",
      fetchFn,
    });
  });
});

it.each([scrapeHtml, scrapeMarkdown])(
  "forwards warmStart booleans for %s",
  async (operation) => {
    const seen: string[] = [];
    const fetchFn = mockFetch((url) => {
      seen.push(url.searchParams.get("warmStart")!);
      return Response.json({ ok: true });
    });
    for (const warmStart of [false, true]) {
      await operation("https://example.com", {
        token: "test",
        fetchFn,
        warmStart,
      });
    }
    expect(seen).toEqual(["false", "true"]);
  },
);
