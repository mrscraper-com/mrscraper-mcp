import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MISSING_TOKEN_MESSAGE,
  createTokenVerifier,
  normalizeBearerToken,
  resolveApiToken,
} from "../src/auth.js";
import { getApiEndpoints, resolveTransport } from "../src/config.js";

afterEach(() => vi.unstubAllEnvs());

describe("CLI endpoint configuration", () => {
  it("uses the same platform and scraper hosts as the CLI", () => {
    vi.stubEnv("MRSCRAPER_API_BASE_URL", undefined);
    vi.stubEnv("MRSCRAPER_FETCH_BASE_URL", undefined);
    expect(getApiEndpoints()).toEqual({
      apiBaseUrl: "https://api.app.mrscraper.com/api/v1",
      scraperApiUrl: "https://api.mrscraper.com",
      subscriptionAccounts:
        "https://api.app.mrscraper.com/api/v1/subscription-accounts",
    });
  });

  it("supports the CLI's endpoint environment overrides", () => {
    vi.stubEnv("MRSCRAPER_API_BASE_URL", "http://127.0.0.1:8001/api/v1");
    vi.stubEnv("MRSCRAPER_FETCH_BASE_URL", "http://127.0.0.1:8002");
    expect(getApiEndpoints()).toEqual({
      apiBaseUrl: "http://127.0.0.1:8001/api/v1",
      scraperApiUrl: "http://127.0.0.1:8002",
      subscriptionAccounts:
        "http://127.0.0.1:8001/api/v1/subscription-accounts",
    });
  });
});

describe("transport configuration", () => {
  it.each([
    ["stdio", "stdio"],
    ["HTTP", "http"],
    [" http ", "http"],
  ] as const)("accepts %s", (configured, expected) => {
    expect(resolveTransport(configured)).toBe(expected);
  });

  it.each(["", "sse", "htp", "websocket"])("rejects %s", (configured) => {
    expect(() => resolveTransport(configured)).toThrow("Unsupported TRANSPORT");
  });
});

describe("API token resolution", () => {
  it("normalizes Bearer prefixes", () => {
    expect(normalizeBearerToken(" Bearer caller-key ")).toBe("caller-key");
  });

  it("uses MRSCRAPER_API_KEY first for stdio", () => {
    vi.stubEnv("MRSCRAPER_API_KEY", "stdio-key");
    vi.stubEnv("MRSCRAPER_API_TOKEN", "alternate-key");
    expect(resolveApiToken({ era: "legacy" })).toBe("stdio-key");
  });

  it("uses verified HTTP auth instead of an environment key", () => {
    vi.stubEnv("MRSCRAPER_API_KEY", "server-key");
    expect(
      resolveApiToken({
        era: "legacy",
        authInfo: {
          token: "caller-key",
          clientId: "test",
          scopes: [],
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        },
        requestInfo: new Request("https://mcp.example/mcp"),
      }),
    ).toBe("caller-key");
  });

  it("never falls back to an environment key for HTTP", () => {
    vi.stubEnv("MRSCRAPER_API_KEY", "server-key");
    expect(() =>
      resolveApiToken({
        era: "legacy",
        requestInfo: new Request("https://mcp.example/mcp"),
      }),
    ).toThrow(MISSING_TOKEN_MESSAGE);
  });

  it("can resolve x-api-token when HTTP auth middleware is disabled", () => {
    expect(
      resolveApiToken({
        era: "legacy",
        requestInfo: new Request("https://mcp.example/mcp", {
          headers: { "x-api-token": "caller-key" },
        }),
      }),
    ).toBe("caller-key");
  });

  it("builds a verifier with expiring auth info", async () => {
    const verifier = createTokenVerifier(async (token) => token === "valid");
    const auth = await verifier.verifyAccessToken("valid");
    expect(auth.token).toBe("valid");
    expect(auth.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    await expect(verifier.verifyAccessToken("invalid")).rejects.toThrow(
      "Invalid MrScraper API token",
    );
  });
});
