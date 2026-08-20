import type { AddressInfo } from "node:net";

import { createHttpApp } from "../src/app.js";

const { app, handler } = createHttpApp({
  host: "127.0.0.1",
  authEnabled: true,
  validateToken: async (token) => token === "valid-key",
});
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function show(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.text();
  console.log(`\n--- ${init?.method ?? "GET"} ${path} -> ${response.status}`);
  const challenge = response.headers.get("www-authenticate");
  if (challenge) console.log(`WWW-Authenticate: ${challenge}`);
  console.log(body.slice(0, 700));
}

const call = (name: string, token?: string) => ({
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

await show("/.well-known/oauth-protected-resource/mcp");
await show("/.well-known/oauth-protected-resource");
await show("/.well-known/oauth-authorization-server");
await show("/mcp", call("status"));

await handler.close();
server.close();
