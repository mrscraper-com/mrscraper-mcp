import { describe, expect, it, vi } from "vitest";

import { scrapeHtml, scrapeJson } from "../src/api.js";
import { scrapeHtmlInputSchema, scrapeJsonInputSchema } from "../src/tools.js";
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

  it("names the cause of a network failure", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("Headers Timeout Error"), {
          code: "UND_ERR_HEADERS_TIMEOUT",
        }),
      });
    }) as unknown as typeof fetch;
    const result = await request("GET", "https://www.scrapethissite.com/", {
      fetchFn,
    });
    expect(result.error).toBe("fetch failed (Headers Timeout Error)");
  });
});

describe("Scrape JSON transport", () => {
  function capture() {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetchFn = mockFetch((url, init) => {
      calls.push({ url, init });
      return Response.json({ success: true, data: {} });
    });
    return { calls, fetchFn };
  }

  it("sends the prompt in the query while the URL fits in 8,000 characters", async () => {
    const { calls, fetchFn } = capture();
    const prompt = "a".repeat(7000);
    await scrapeJson(
      "test",
      scrapeJsonInputSchema.parse({ url: "https://example.com", prompt }),
      { fetchFn },
    );
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.body).toBeUndefined();
    expect(calls[0]!.url.searchParams.get("prompt")).toBe(prompt);
  });

  it("moves url, prompt, and agent to a POST body when the URL is too long", async () => {
    const { calls, fetchFn } = capture();
    const prompt = "é &".repeat(4000);
    await scrapeJson(
      "test",
      scrapeJsonInputSchema.parse({
        url: "https://example.com",
        prompt,
        maxRetries: 0,
      }),
      { fetchFn },
    );
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      url: "https://example.com",
      prompt,
      agent: "general",
    });
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({
      super: "false",
      waitUntil: "domcontentloaded",
      timeout: "300",
      geoCode: "us",
      proxyCountry: "us",
      maxRetries: "0",
      saveResult: "false",
      browserRendering: "false",
      html: "false",
      screenshot: "false",
    });
  });
});

it("sends OAuth access tokens only in Authorization", async () => {
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const fetchFn = mockFetch((url, init) => {
    calls.push({ url, init });
    return Response.json({ html: "" });
  });
  await scrapeHtml(
    "header.payload.signature",
    scrapeHtmlInputSchema.parse({ url: "https://example.com" }),
    { fetchFn },
  );
  expect(calls[0]!.url.searchParams.has("token")).toBe(false);
  expect(calls[0]!.init.headers).toMatchObject({
    Authorization: "Bearer header.payload.signature",
  });
  expect(calls[0]!.init.headers).not.toHaveProperty("x-api-token");
});
