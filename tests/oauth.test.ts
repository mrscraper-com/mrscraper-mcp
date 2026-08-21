import type { AddressInfo } from "node:net";

import express from "express";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createHttpApp } from "../src/app.js";
import type { OAuthConfig } from "../src/config.js";
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
    scopesSupported: ["scrape:read", "scrape:write", "account:read"],
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
    scope: overrides.scope ?? "scrape:read scrape:write account:read",
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
});

async function startApp(config: OAuthConfig = oauthConfig()) {
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
      params: { name, arguments: {} },
    }),
  });
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
      [
        "fetch",
        "rerun",
        "result",
        "results",
        "scrape",
        "serp",
        "status",
      ].sort(),
    );
  });

  it("gates only tools/call", () => {
    expect(requiredScopesForRequest({ method: "initialize" })).toEqual([]);
    expect(requiredScopesForRequest({ method: "tools/list" })).toEqual([]);
    expect(
      requiredScopesForRequest({
        method: "tools/call",
        params: { name: "scrape" },
      }),
    ).toEqual(["scrape:write"]);
  });

  it("unions the scopes a batched payload needs", () => {
    expect(
      requiredScopesForRequest([
        { method: "tools/call", params: { name: "serp" } },
        { method: "tools/call", params: { name: "rerun" } },
      ]).sort(),
    ).toEqual(["scrape:read", "scrape:write"]);
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

    const response = await toolCall(baseUrl, "status");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).not.toContain(
      "resource_metadata=",
    );
    expect((await toolCall(baseUrl, "status", "valid-key")).status).toBe(200);
  });
});

describe("bearer challenges", () => {
  it("points unauthenticated callers at the resource metadata document", async () => {
    const baseUrl = await startApp();
    const response = await toolCall(baseUrl, "status");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.mrscraper.test/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("accepts a valid access token", async () => {
    const baseUrl = await startApp();
    const response = await toolCall(baseUrl, "status", await mintToken());
    expect(response.status).toBe(200);
  });

  it("rejects a token minted for another audience", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({
      audience: "https://elsewhere.example/mcp",
    });
    expect((await toolCall(baseUrl, "status", token)).status).toBe(401);
  });

  it("rejects a token minted for the bare public origin", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({
      audience: "https://mcp.mrscraper.test",
    });
    expect((await toolCall(baseUrl, "status", token)).status).toBe(401);
  });

  it("rejects a token from another issuer", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ issuer: ISSUER_PLACEHOLDER });
    expect((await toolCall(baseUrl, "status", token)).status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ expiresIn: "-1m" });
    expect((await toolCall(baseUrl, "status", token)).status).toBe(401);
  });
});

describe("per-tool scope gate", () => {
  it("refuses a write tool held by a read-only token with insufficient_scope", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ scope: "scrape:read" });
    const response = await toolCall(baseUrl, "scrape", token);
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain("scrape:write");

    expect(challenge).toContain("scrape:read");
    expect(challenge).toContain("resource_metadata=");
  });

  it("allows a read tool held by a read-only token", async () => {
    const baseUrl = await startApp();
    const token = await mintToken({ scope: "scrape:read" });
    expect((await toolCall(baseUrl, "results", token)).status).toBe(200);
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
    const baseUrl = await startApp();
    expect((await toolCall(baseUrl, "status", "valid-key")).status).toBe(200);
  });

  it("grants an API key every scope so no tool is gated", async () => {
    const baseUrl = await startApp();
    expect((await toolCall(baseUrl, "scrape", "valid-key")).status).toBe(200);
  });

  it("still rejects an unknown API key", async () => {
    const baseUrl = await startApp();
    expect((await toolCall(baseUrl, "status", "nope")).status).toBe(401);
  });
});
