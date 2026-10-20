import type { AddressInfo } from "node:net";

import express from "express";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createHttpApp } from "../src/app.js";
import { OAUTH_SCOPES, TOOL_NAMES, type OAuthConfig } from "../src/config.js";
import { isOAuthAccessToken } from "../src/oauth.js";
import { TOOL_SCOPES, requiredScopesForRequest } from "../src/scopes.js";

const ISSUER_PLACEHOLDER = "https://issuer.invalid";
const RESOURCE = "https://mcp.mrscraper.test/mcp";

let privateKey: CryptoKey;
let publicJwk: JWK;
let issuer: string;
let closeIssuer: () => Promise<void>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "test",
    alg: "RS256",
  };

  const app = express();
  app.get("/.well-known/jwks.json", (_request, response) => {
    response.json({ keys: [publicJwk] });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeIssuer = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined))),
    );
});

afterAll(async () => {
  await closeIssuer();
});

function oauthConfig(): OAuthConfig {
  return {
    enabled: true,
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    publicUrl: "https://mcp.mrscraper.test",
    resourceUrl: RESOURCE,
    scopesSupported: OAUTH_SCOPES,
    documentationUrl:
      "https://docs.mrscraper.com/docs/getting-started/mcp-server",
  };
}

async function mintToken(
  overrides: {
    scope?: string;
    audience?: string;
    issuer?: string;
    expiresIn?: string;
    subject?: string;
  } = {},
) {
  return new SignJWT({
    scope: overrides.scope ?? "scrape:write",
    client_id: "https://claude.ai/oauth/claude-code-client-metadata",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? RESOURCE)
    .setSubject(overrides.subject ?? "user-uuid")
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "10m")
    .sign(privateKey);
}

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.unstubAllEnvs();
});

interface UpstreamRequest {
  method: string;
  url: URL;
  authorization: string | undefined;
  apiToken: string | undefined;
  body: unknown;
}

async function startApp(
  config: OAuthConfig = oauthConfig(),
  upstreamRequests: UpstreamRequest[] = [],
) {
  // Exercise the real HTTP client without contacting production services.
  const upstream = express();
  upstream.use(express.json());
  upstream.use((request, response) => {
    upstreamRequests.push({
      method: request.method,
      url: new URL(request.originalUrl, "http://upstream.test"),
      authorization: request.get("authorization"),
      apiToken: request.get("x-api-token"),
      body: request.body,
    });
    if (request.path === "/" && request.method === "POST") {
      response.json({ html: "<h1>Example Domain</h1>", error: null });
    } else if (request.path === "/api/google/serp/v2/sync") {
      response.json({ data: { organic: [{ title: "MrScraper" }] } });
    } else if (request.path === "/subscription-accounts") {
      response.json({
        stripeStatus: "active",
        tokenLimit: 1000,
        tokenUsage: 10,
        user: { name: "Test User", email: "user@example.test" },
      });
    } else {
      response.status(501).json({ error: "Unexpected upstream request" });
    }
  });
  const upstreamServer = await new Promise<ReturnType<typeof upstream.listen>>(
    (resolve) => {
      const listener = upstream.listen(0, "127.0.0.1", () => resolve(listener));
    },
  );
  closers.push(
    () =>
      new Promise<void>((resolve, reject) =>
        upstreamServer.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const upstreamUrl = `http://127.0.0.1:${(upstreamServer.address() as AddressInfo).port}`;
  vi.stubEnv("MRSCRAPER_FETCH_BASE_URL", upstreamUrl);
  vi.stubEnv("MRSCRAPER_SYNC_BASE_URL", upstreamUrl);
  vi.stubEnv("MRSCRAPER_API_BASE_URL", upstreamUrl);

  const { app, handler } = createHttpApp({
    host: "127.0.0.1",
    authEnabled: true,
    oauthConfig: config,
    validateToken: async (token) => token === "valid-key",
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  closers.push(async () => {
    await handler.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function toolCall(baseUrl: string, name: string, token?: string) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name,
        arguments:
          name === "scraperAPI"
            ? { url: "https://example.com" }
            : name === "webSearch"
              ? { url: "MrScraper", raw: false }
              : {},
      },
    }),
  });
}

async function expectToolSuccess(response: Response) {
  expect(response.status).toBe(200);
  const text = await response.text();
  const event = text.split("\n").find((line) => line.startsWith("data: "));
  const message = JSON.parse(event ? event.slice(6) : text);
  expect(message).not.toHaveProperty("error");
  expect(message.result).toBeDefined();
  expect(message.result.isError).not.toBe(true);
  expect(message.result.structuredContent).toMatchObject({ status_code: 200 });
  return message.result.structuredContent;
}

describe("token shape detection", () => {
  it("separates OAuth access tokens from MrScraper API keys", () => {
    expect(isOAuthAccessToken("header.payload.signature")).toBe(true);
    expect(isOAuthAccessToken(`atk_${"a".repeat(64)}`)).toBe(false);
    expect(isOAuthAccessToken("Bearer header.payload.signature")).toBe(true);
  });
});

describe("scope mapping", () => {
  it("covers every registered tool", () => {
    expect(Object.keys(TOOL_SCOPES).sort()).toEqual(
      ["scraperAPI", "webSearch", "status"].sort(),
    );
  });

  it("gates only tools/call", () => {
    expect(requiredScopesForRequest({ method: "initialize" })).toEqual([]);
    expect(requiredScopesForRequest({ method: "tools/list" })).toEqual([]);
    expect(
      requiredScopesForRequest({
        method: "tools/call",
        params: { name: "scraperAPI" },
      }),
    ).toEqual(["scrape:write"]);
    expect(
      requiredScopesForRequest({
        method: "tools/call",
        params: { name: "status" },
      }),
    ).toEqual(["account:read"]);
  });

  it("unions the scopes a batched payload needs", () => {
    expect(
      requiredScopesForRequest([
        { method: "tools/call", params: { name: "webSearch" } },
        { method: "tools/call", params: { name: "scraperAPI" } },
      ]).sort(),
    ).toEqual(["scrape:read", "scrape:write"]);
    expect(
      requiredScopesForRequest([
        { method: "tools/call", params: { name: "webSearch" } },
        { method: "tools/call", params: { name: "status" } },
      ]).sort(),
    ).toEqual(["account:read", "scrape:read"]);
  });

  it("advertises every scope a tool requires", () => {
    for (const scope of Object.values(TOOL_SCOPES)) {
      expect(OAUTH_SCOPES).toContain(scope);
    }
  });
});

describe("OAuth discovery documents", () => {
  it("serves protected resource metadata on both well-known paths", async () => {
    const baseUrl = await startApp();
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource: RESOURCE,
        authorization_servers: [issuer],
        scopes_supported: ["scrape:read", "scrape:write", "account:read"],
      });
    }
  });

  it("omits offline_access from resource scopes but offers it on the AS", async () => {
    const baseUrl = await startApp();
    const prm = await (
      await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    const as = await (
      await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)
    ).json();
    expect(prm.scopes_supported).not.toContain("offline_access");
    expect(as.scopes_supported).toEqual([
      "scrape:read",
      "scrape:write",
      "account:read",
      "offline_access",
    ]);
    expect(as.scopes_supported).toContain("offline_access");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
    expect(as.client_id_metadata_document_supported).toBe(true);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
  });

  it("does not advertise OAuth when OAuth access tokens are disabled", async () => {
    const baseUrl = await startApp({ ...oauthConfig(), enabled: false });
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-authorization-server",
    ]) {
      expect((await fetch(`${baseUrl}${path}`)).status).toBe(404);
    }

    const response = await toolCall(baseUrl, "scraperAPI");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toContain(
      "resource_metadata=",
    );
    await expectToolSuccess(await toolCall(baseUrl, "scraperAPI", "valid-key"));
  });
});

describe("bearer challenges", () => {
  it("points unauthenticated callers at the resource metadata document", async () => {
    const baseUrl = await startApp();
    const response = await toolCall(baseUrl, "scraperAPI");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.mrscraper.test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("executes scraperAPI with a valid write access token", async () => {
    const requests: UpstreamRequest[] = [];
    const baseUrl = await startApp(oauthConfig(), requests);
    const token = await mintToken();
    const data = await expectToolSuccess(
      await toolCall(baseUrl, "scraperAPI", token),
    );
    expect(data.data).toEqual({ html: "<h1>Example Domain</h1>", error: null });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "POST",
      authorization: `Bearer ${token}`,
      apiToken: undefined,
      body: { url: "https://example.com", maxRetries: 3 },
    });
    expect(requests[0]!.url.searchParams.has("token")).toBe(false);
  });

  it("rejects a token minted for another audience", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({
      audience: "https://elsewhere.example/mcp",
    });
    expect((await toolCall(baseUrl, "scraperAPI", token)).status).toBe(401);
  });

  it("rejects a token minted for the bare public origin", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({
      audience: "https://mcp.mrscraper.test",
    });
    expect((await toolCall(baseUrl, "scraperAPI", token)).status).toBe(401);
  });

  it("rejects a token from another issuer", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ issuer: ISSUER_PLACEHOLDER });
    expect((await toolCall(baseUrl, "scraperAPI", token)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ expiresIn: "-1m" });
    expect((await toolCall(baseUrl, "scraperAPI", token)).status).toBe(401);
  });
});

describe("per-tool scope gate", () => {
  it("executes both scraping tools with read and write scopes", async () => {
    const requests: UpstreamRequest[] = [];
    const baseUrl = await startApp(oauthConfig(), requests);
    const token = await mintToken({ scope: "scrape:read scrape:write" });
    for (const name of ["scraperAPI", "webSearch"]) {
      await expectToolSuccess(await toolCall(baseUrl, name, token));
    }
    expect(requests.map((request) => request.url.pathname)).toEqual([
      "/",
      "/api/google/serp/v2/sync",
    ]);
    expect(
      requests.every((request) => request.authorization === `Bearer ${token}`),
    ).toBe(true);
  });

  it("rejects a read-only scraper token before it reaches the backend", async () => {
    const requests: UpstreamRequest[] = [];
    const baseUrl = await startApp(oauthConfig(), requests);
    const token = await mintToken({ scope: "scrape:read account:read" });
    const response = await toolCall(baseUrl, "scraperAPI", token);
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain("account:read");

    expect(challenge).toContain("scrape:write");
    expect(challenge).toContain("resource_metadata=");
    expect(await response.json()).toEqual({
      error: "insufficient_scope",
      error_description: "This tool requires the scrape:write scope",
    });
    expect(requests).toEqual([]);
  });

  it("allows a read tool held by a read-only token", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ scope: "scrape:read" });
    const data = await expectToolSuccess(
      await toolCall(baseUrl, "webSearch", token),
    );
    expect(data.data).toEqual({ data: { organic: [{ title: "MrScraper" }] } });
  });

  it("refuses status without account:read", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ scope: "scrape:read" });
    const response = await toolCall(baseUrl, "status", token);
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain("This tool requires the account:read scope");
  });

  it("never gates the handshake", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ scope: "" });
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "scope-test", version: "1" },
        },
      }),
    });
    expect(response.status).toBe(200);
  });
});

describe("API key compatibility", () => {
  it("still accepts a MrScraper API key as the bearer credential", async () => {
    const requests: UpstreamRequest[] = [];
    const baseUrl = await startApp(oauthConfig(), requests);
    await expectToolSuccess(await toolCall(baseUrl, "scraperAPI", "valid-key"));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      authorization: "Bearer valid-key",
      apiToken: "valid-key",
    });
    expect(requests[0]!.url.searchParams.get("token")).toBe("valid-key");
  });

  it("grants an API key every scope so no tool is gated", async () => {
    const baseUrl = await startApp();
    for (const name of TOOL_NAMES) {
      await expectToolSuccess(await toolCall(baseUrl, name, "valid-key"));
    }
  });

  it("still rejects an unknown API key", async () => {
    const baseUrl = await startApp();
    expect((await toolCall(baseUrl, "scraperAPI", "nope")).status).toBe(401);
  });
});
