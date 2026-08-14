import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MISSING_TOKEN_MESSAGE,
  createTokenVerifier,
  normalizeBearerToken,
  resolveApiToken,
} from "../src/auth.js";
import { resolveTransport } from "../src/config.js";

afterEach(() => vi.unstubAllEnvs());

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
