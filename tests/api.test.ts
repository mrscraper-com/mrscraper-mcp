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

describe("integration service contract", () => {
  it.each([
    ["HTML", scrapeHtml, { html: "true", markdown: "false" }],
    [
      "Markdown",
      scrapeMarkdown,
      { markdown: "true", html: "false", screenshot: "false" },
    ],
    [
      "Screenshot",
      getScreenshot,
      {
        screenshot: "full",
        browserRendering: "true",
        html: "false",
        markdown: "false",
      },
    ],
    [
      "JSON",
      scrapeJson,
      { agent: "general", html: "true", screenshot: "false" },
    ],
  ] as const)(
    "GETs %s with only the fixed values, saveResult and maxAge",
    async (_name, fn, flags) => {
      const fetchFn = mockFetch((url, init) => {
        expect(init.method).toBe("GET");
        expect(init.body).toBeUndefined();
        expect(url.origin).toBe("https://api.mrscraper.com");
        expect(Object.fromEntries(url.searchParams)).toEqual({
          url: "https://example.com",
          maxAge: "0",
          saveResult: "true",
          ...flags,
        });
        expect(init.headers).toMatchObject({
          Authorization: "Bearer test",
          "x-api-token": "test",
        });
        return Response.json({ ok: true });
      });
      await fn("https://example.com", { token: "test", fetchFn });
    },
  );
  it("forwards every documented page input the caller sets", async () => {
    const seen: Record<string, string>[] = [];
    const fetchFn = mockFetch((url) => {
      seen.push(Object.fromEntries(url.searchParams));
      return Response.json({ ok: true });
    });
    const page = {
      timeout: 330,
      geoCode: "GB",
      waitForSelector: " #results ",
      maxAge: 86400000,
      maxRetries: 0,
    };
    const loading = {
      browserRendering: false,
      warmStart: true,
      blockResources: true,
    };
    const options = { token: "test", fetchFn, ...page };
    await scrapeHtml("https://example.com", {
      ...options,
      ...loading,
      screenshot: "1920x1080-75",
    });
    await scrapeMarkdown("https://example.com", { ...options, ...loading });
    await getScreenshot("https://example.com", {
      ...options,
      screenshot: "top",
    });
    await scrapeJson("https://example.com", {
      ...options,
      ...loading,
      prompt: "List the titles.",
      html: false,
      screenshot: true,
    });
    const sent = {
      url: "https://example.com",
      timeout: "330",
      geoCode: "gb",
      waitForSelector: "#results",
      maxAge: "86400000",
      maxRetries: "0",
      saveResult: "true",
    };
    const loaded = {
      browserRendering: "false",
      warmStart: "true",
      blockResources: "true",
    };
    expect(seen).toEqual([
      {
        ...sent,
        ...loaded,
        html: "true",
        markdown: "false",
        screenshot: "1920x1080-75",
      },
      {
        ...sent,
        ...loaded,
        markdown: "true",
        html: "false",
        screenshot: "false",
      },
      {
        ...sent,
        screenshot: "top",
        browserRendering: "true",
        html: "false",
        markdown: "false",
      },
      {
        ...sent,
        ...loaded,
        agent: "general",
        prompt: "List the titles.",
        html: "false",
        screenshot: "true",
      },
    ]);
  });
  it("accepts only the documented screenshot areas", async () => {
    const fetchFn = mockFetch(() => Response.json({ ok: true }));
    for (const screenshot of ["full", "top", "100x3840", "1280x800-25"])
      await getScreenshot("https://example.com", {
        token: "test",
        fetchFn,
        screenshot,
      });
    for (const screenshot of ["side", "99x800", "1280x3841", "1280x800-301"]) {
      await expect(
        getScreenshot("https://example.com", {
          token: "test",
          fetchFn,
          screenshot,
        }),
      ).rejects.toThrow(/screenshot must be/);
      await expect(
        scrapeHtml("https://example.com", {
          token: "test",
          fetchFn,
          screenshot,
        }),
      ).rejects.toThrow(/screenshot must be/);
    }
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });
  it("reads status from the platform endpoint", async () => {
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
  it("brand and search send only their fixed values and set fields", async () => {
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
      { action: "websearch", query: "web scraping" },
      {
        action: "websearch",
        query: "web scraping",
        country: "id",
        numResults: "20",
      },
    ]);
  });
  it("JSON long-prompt POST fallback", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchFn = mockFetch((url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true });
    });
    const prompt = "é &".repeat(4000);
    await scrapeJson("https://example.com", {
      token: "test",
      fetchFn,
      prompt,
      maxRetries: 0,
    });
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      url: "https://example.com",
      agent: "general",
      prompt,
    });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      html: "true",
      screenshot: "false",
      maxRetries: "0",
      maxAge: "0",
      saveResult: "true",
    });
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
