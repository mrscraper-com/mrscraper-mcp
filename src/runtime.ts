import type { Server as HttpServer } from "node:http";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { createHttpApp } from "./app.js";
import { httpRuntimeConfig, resolveTransport } from "./config.js";
import { createServerFactory } from "./server.js";

export interface RunningHttpServer {
  server: HttpServer;
  close: () => Promise<void>;
}

export async function startHttpServer(): Promise<RunningHttpServer> {
  const config = httpRuntimeConfig();
  const { app, handler } = createHttpApp({
    host: config.host,
    allowedOrigins: config.allowedOrigins,
  });
  const server = await new Promise<HttpServer>((resolve, reject) => {
    const listener = app.listen(config.port, config.host, () =>
      resolve(listener),
    );
    listener.once("error", reject);
  });
  console.error(
    `MrScraper MCP ${config.host}:${config.port}/mcp (health: /health, ready: /ready)`,
  );
  return {
    server,
    async close() {
      await handler.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function run(): Promise<void> {
  const transport = resolveTransport();
  if (transport === "http") {
    const running = await startHttpServer();
    const shutdown = async () => {
      await running.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }

  const handle = serveStdio(createServerFactory(), {
    onerror: (error) => console.error("MCP stdio error:", error),
  });
  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
