import type { AddressInfo } from "node:net";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHttpApp } from "../src/app.js";
import { TOOL_NAMES, VERSION } from "../src/config.js";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  vi.unstubAllEnvs();
});

async function startApp(options: Parameters<typeof createHttpApp>[0] = {}) {
  const { app, handler } = createHttpApp({ host: "127.0.0.1", ...options });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const port = (server.address() as AddressInfo).port;
  const close = async () => {
    await handler.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  closers.push(close);
  return { baseUrl: `http://127.0.0.1:${port}`, close };
}

describe("HTTP application", () => {
  it("serves unauthenticated Kubernetes health routes", async () => {
    const { baseUrl } = await startApp({
      authEnabled: true,
      validateToken: async () => false,
    });
    const health = await fetch(`${baseUrl}/health`);
    const ready = await fetch(`${baseUrl}/ready`);
    expect(await health.json()).toEqual({
      status: "ok",
      service: "mrscraper-mcp",
      version: VERSION,
    });
    expect(await ready.json()).toEqual({
      status: "ready",
      service: "mrscraper-mcp",
      version: VERSION,
      tools: 7,
    });
    expect((await fetch(`${baseUrl}/chatgpt`)).status).toBe(404);
  });

  it("protects localhost from untrusted browser origins", async () => {
    const { baseUrl } = await startApp({ authEnabled: false });
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(response.status).toBe(403);
  });

  it("matches configured browser origins by scheme and port", async () => {
    const { baseUrl } = await startApp({
      authEnabled: false,
      allowedOrigins: ["https://agent.example:444"],
    });
    const request = (origin: string) =>
      fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          origin,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "origin-test", version: "1" },
          },
        }),
      });
    expect((await request("https://agent.example:444")).status).toBe(200);
    expect((await request("https://agent.example")).status).toBe(403);
    expect((await request("http://agent.example:444")).status).toBe(403);
  });

  it("rejects invalid configured origin values at startup", () => {
    expect(() =>
      createHttpApp({ allowedOrigins: ["https://agent.example/path"] }),
    ).toThrow("Invalid MRSCRAPER_ALLOWED_ORIGINS");
  });

  it("requires Authorization Bearer by default", async () => {
    const { baseUrl } = await startApp({
      authEnabled: true,
      validateToken: async () => false,
    });
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-api-token": "not-a-real-key",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "auth-test", version: "1" },
        },
      }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("serves MCP over HTTP with the caller's valid key", async () => {
    const { baseUrl } = await startApp({
      authEnabled: true,
      validateToken: async (token) => token === "valid-key",
    });
    const client = new Client({ name: "http-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      { authProvider: { token: async () => "valid-key" } },
    );
    await client.connect(transport);
    try {
      expect(client.getServerVersion()?.version).toBe(VERSION);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    } finally {
      await client.close();
    }
  });

  it("supports the current MCP protocol negotiation", async () => {
    const { baseUrl } = await startApp({
      authEnabled: true,
      validateToken: async (token) => token === "valid-key",
    });
    const client = new Client(
      { name: "modern-http-test", version: "1" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      { authProvider: { token: async () => "valid-key" } },
    );
    await client.connect(transport);
    try {
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    } finally {
      await client.close();
    }
  });

  it("keeps HTTP environment credentials isolated when auth is disabled", async () => {
    vi.stubEnv("MRSCRAPER_API_KEY", "server-key");
    const { baseUrl } = await startApp({ authEnabled: false });
    const client = new Client({ name: "http-boundary-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
    );
    await client.connect(transport);
    try {
      const response = await client.callTool({ name: "status", arguments: {} });
      expect(response.isError).toBe(true);
      expect(JSON.stringify(response.content)).toContain(
        "MrScraper API token is required",
      );
    } finally {
      await client.close();
    }
  });
});
