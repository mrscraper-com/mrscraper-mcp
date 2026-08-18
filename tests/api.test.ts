import { describe, expect, it, vi } from "vitest";

import {
  createAiScraperApi,
  fetchContentApi,
  googleSerpSyncApi,
  normalizeSerpInput,
  parseBulkUrls,
  rerunAiScraperApi,
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
          },
        },
      ),
    );
    const result = await request("GET", "https://example.com", { fetchFn });
    expect(result.headers).not.toHaveProperty("set-cookie");
    expect(result.headers).not.toHaveProperty("x-api-token");
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
    const result = await request("GET", "https://example.com", { fetchFn });
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
    const result = await request("GET", "https://example.com", {
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

describe("CLI-aligned API calls", () => {
  it("fetches once with the exact Web Unblocker parameters", async () => {
    const requests: Array<{ url: URL; init: RequestInit }> = [];
    const fetchFn = mockFetch((url, init) => {
      requests.push({ url, init });
      return new Response("<html>Checking your browser - captcha</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const result = await fetchContentApi({
      token: "test-token",
      url: "https://target.example",
      browserRendering: true,
      geoCode: "ID",
      waitForSelector: ".ready",
      homePage: true,
      blockResources: true,
      maxRetries: 4,
      tokenCap: 100,
      timeout: 45,
      fetchFn,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.searchParams.get("browserRendering")).toBe("true");
    expect(requests[0]!.url.searchParams.get("geoCode")).toBe("ID");
    expect(requests[0]!.url.searchParams.get("waitForSelector")).toBe(".ready");
    expect(requests[0]!.url.searchParams.get("homePage")).toBe("true");
    expect(requests[0]!.url.searchParams.get("blockResources")).toBe("true");
    expect(requests[0]!.url.searchParams.get("maxRetries")).toBe("4");
    expect(requests[0]!.url.searchParams.get("tokenCap")).toBe("100");
    expect(requests[0]!.url.searchParams.get("timeout")).toBe("45");
    expect(requests[0]!.url.searchParams.has("token")).toBe(false);
    expect(new Headers(requests[0]!.init.headers).get("authorization")).toBe(
      "Bearer test-token",
    );
    expect(result).not.toHaveProperty("unblocker");
  });

  it("sends listing maxPages", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body));
      return Response.json({ data: { id: "listing-1" } });
    });
    const result = await createAiScraperApi({
      token: "test",
      url: "https://target.example/listings",
      message: "Extract every listing",
      agent: "listing",
      maxPages: 4,
      fetchFn,
    });
    expect(result.status_code).toBe(200);
    expect(body).toMatchObject({ agent: "listing", maxPages: 4 });
  });

  it("omits unspecified scrape controls and proxyCountry", async () => {
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch((_url, init) => {
      body = JSON.parse(String(init.body));
      return Response.json({ data: { id: "general-1" } });
    });
    await createAiScraperApi({
      token: "test",
      url: "https://target.example",
      message: "Extract the title",
      agent: "general",
      fetchFn,
    });
    expect(body).toEqual({
      url: "https://target.example",
      message: "Extract the title",
      agent: "general",
    });
  });

  it("preserves the CLI Node request profile for reruns", async () => {
    let headers = new Headers();
    const fetchFn = mockFetch((_url, init) => {
      headers = new Headers(init.headers);
      return Response.json({ data: { id: "rerun-1" } }, { status: 201 });
    });
    await rerunAiScraperApi({
      token: "test-token",
      scraperId: "scraper-1",
      url: "https://target.example",
      fetchFn,
    });
    expect(headers.get("user-agent")).toBe("node");
    expect(headers.get("accept-language")).toBe("*");
    expect(headers.get("sec-fetch-mode")).toBe("cors");
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("x-api-token")).toBe("test-token");
  });

  it("normalizes Google URLs and emits the v2 SERP payload", async () => {
    expect(
      normalizeSerpInput(
        "https://www.google.com/search?q=running+shoes&gl=us&hl=en&start=20",
      ),
    ).toEqual({
      query: "running shoes",
      region: "us",
      language: "en",
      page: 3,
    });
    let path = "";
    let body: Record<string, unknown> = {};
    const fetchFn = mockFetch((url, init) => {
      path = url.pathname;
      body = JSON.parse(String(init.body));
      return Response.json({ success: true });
    });
    await googleSerpSyncApi({
      token: "test",
      queryOrUrl: "iphone 17",
      region: "id",
      language: "id",
      page: 2,
      renderJs: true,
      fetchFn,
    });
    expect(path).toBe("/api/google/serp/v2/sync");
    expect(body).toEqual({
      query: "iphone 17",
      region: "id",
      language: "id",
      page: 2,
      format: "json",
      renderJs: true,
    });
  });

  it("parses CLI-style bulk targets", () => {
    expect(
      parseBulkUrls("https://a.example,https://b.example\nhttps://c.example"),
    ).toEqual(["https://a.example", "https://b.example", "https://c.example"]);
    expect(parseBulkUrls("https://a.example|https://b.example")).toEqual([
      "https://a.example|https://b.example",
    ]);
  });
});
