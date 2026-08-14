import {
  createMcpExpressApp,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import type { Express, NextFunction, Request, Response } from "express";

import { createTokenVerifier } from "./auth.js";
import {
  TOOL_NAMES,
  VERSION,
  httpAuthEnabled,
  httpRuntimeConfig,
} from "./config.js";
import { createServerFactory, type ServerFactoryOptions } from "./server.js";

export interface HttpAppOptions extends ServerFactoryOptions {
  host?: string;
  allowedOrigins?: string[];
  authEnabled?: boolean;
  validateToken?: (token: string) => Promise<boolean>;
  logPayloads?: boolean;
  payloadLogMax?: number;
}

export interface HttpApp {
  app: Express;
  handler: McpHttpHandler;
}

const LOCAL_ORIGIN_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

function normalizeAllowedOrigins(origins: string[]): {
  origins: Set<string>;
  hostnames: string[];
} {
  const normalized = origins.map((origin) => {
    try {
      const parsed = new URL(origin);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash
      ) {
        throw new Error("not an HTTP origin");
      }
      return parsed;
    } catch {
      throw new Error(
        `Invalid MRSCRAPER_ALLOWED_ORIGINS entry ${JSON.stringify(origin)}; expected a full origin such as https://agent.example.com`,
      );
    }
  });
  return {
    origins: new Set(normalized.map((origin) => origin.origin)),
    hostnames: [
      ...new Set([
        ...LOCAL_ORIGIN_HOSTNAMES,
        ...normalized.map((origin) => origin.hostname),
      ]),
    ],
  };
}

function exactOriginProtection(allowedOrigins: Set<string>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.get("origin");
    if (!origin) {
      next();
      return;
    }
    try {
      const parsed = new URL(origin);
      if (
        LOCAL_ORIGIN_HOSTNAMES.includes(parsed.hostname) ||
        allowedOrigins.has(parsed.origin)
      ) {
        next();
        return;
      }
    } catch {
      // Malformed and untrusted origins are handled by the same 403 response.
    }
    response.status(403).send("Forbidden Origin");
  };
}

function requestPayloadLogger(enabled: boolean, maxCharacters: number) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (
      enabled &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      request.body !== undefined
    ) {
      const serialized = JSON.stringify(request.body);
      const rendered =
        serialized.length > maxCharacters
          ? `${serialized.slice(0, maxCharacters)}... (truncated)`
          : serialized;
      console.error(`${request.method} ${request.path} payload: ${rendered}`);
    }
    next();
  };
}

export function createHttpApp(options: HttpAppOptions = {}): HttpApp {
  const runtime = httpRuntimeConfig();
  const host = options.host || runtime.host;
  const origins = options.allowedOrigins || runtime.allowedOrigins;
  const allowedOrigins = normalizeAllowedOrigins(origins);
  const app = createMcpExpressApp({
    host,
    allowedOrigins: allowedOrigins.hostnames,
  });
  const handler = createMcpHandler(createServerFactory(options), {
    onerror: (error) => console.error("MCP request error:", error),
  });
  const nodeHandler = toNodeHandler(handler);
  const logPayloads =
    options.logPayloads ??
    ["1", "true", "yes"].includes(
      (process.env.MRSCRAPER_LOG_HTTP_PAYLOAD || "").toLowerCase(),
    );
  const configuredMax = Number(
    options.payloadLogMax ?? process.env.MRSCRAPER_LOG_HTTP_PAYLOAD_MAX ?? 8192,
  );
  const payloadLogMax =
    Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 8192;

  app.use(exactOriginProtection(allowedOrigins.origins));
  app.use(requestPayloadLogger(logPayloads, payloadLogMax));
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "mrscraper-mcp", version: VERSION });
  });
  app.get("/ready", (_request, response) => {
    response.json({
      status: "ready",
      service: "mrscraper-mcp",
      version: VERSION,
      tools: TOOL_NAMES.length,
    });
  });

  const authEnabled = options.authEnabled ?? httpAuthEnabled();
  const auth = authEnabled
    ? [
        requireBearerAuth({
          verifier: createTokenVerifier(options.validateToken),
        }),
      ]
    : [];
  app.all("/mcp", ...auth, async (request, response, next) => {
    try {
      await nodeHandler(request, response, request.body);
    } catch (error) {
      next(error);
    }
  });
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      console.error("HTTP server error:", error);
      if (!response.headersSent) {
        response.status(500).json({ error: "Internal server error" });
      }
    },
  );
  return { app, handler };
}
