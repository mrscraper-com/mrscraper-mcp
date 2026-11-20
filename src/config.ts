export const VERSION = "0.5.0";

export const TOOL_NAMES = [
  "status",
  "scrapeHtml",
  "scrapeMarkdown",
  "getScreenshot",
  "scrapeBrand",
  "scrapeJson",
  "webSearch",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolSurface = "default" | "chatgpt";

export const CHATGPT_MCP_PATH = "/mcp/chatgpt";

// ChatGPT and Codex sign in with Client ID Metadata Documents hosted here.
export const OPENAI_OAUTH_CLIENT_PREFIX = "https://chatgpt.com/oauth/";

export type Transport = "stdio" | "http";

export interface ApiEndpoints {
  apiBaseUrl: string;
  scraperApiUrl: string;
  subscriptionAccounts: string;
}

function baseUrl(environmentName: string, fallback: string): string {
  return (process.env[environmentName] || fallback).replace(/\/+$/, "");
}

export function getApiEndpoints(): ApiEndpoints {
  const apiBaseUrl = baseUrl(
    "MRSCRAPER_API_BASE_URL",
    "https://api.app.mrscraper.com/api/v1",
  );
  // All six scraping/search services use this host.
  const scraperApiUrl = baseUrl(
    "MRSCRAPER_FETCH_BASE_URL",
    "https://api.mrscraper.com",
  );

  return {
    apiBaseUrl,
    scraperApiUrl,
    subscriptionAccounts: `${apiBaseUrl}/subscription-accounts`,
  };
}

export function resolveTransport(value = process.env.TRANSPORT): Transport {
  const transport = (value ?? "stdio").trim().toLowerCase();
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(
      `Unsupported TRANSPORT=${JSON.stringify(transport)}. Expected one of: http, stdio.`,
    );
  }
  return transport;
}

export function environmentFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

export function httpAuthEnabled(): boolean {
  return environmentFlag("MRSCRAPER_HTTP_AUTH", true);
}

export const DEFAULT_ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://chatgpt.com",
];

export function parseAllowedOrigins(): string[] {
  const configured = (process.env.MRSCRAPER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured])];
}

// Glama connector ownership proof for the hosted server at mcp.mrscraper.com.
// The token is public by design. Set MRSCRAPER_GLAMA_CLAIM to another token,
// or to an empty value to stop serving the file.
export const DEFAULT_GLAMA_CLAIM =
  "glama_claim_WcbtWUx-SQR6UPEOqR6KGU_f0aHg1gFa";

export const GLAMA_CLAIM_PATHS = [
  "/.well-known/glama.json",
  "/mcp/.well-known/glama.json",
];

export function glamaClaim(): string | undefined {
  const claim = (
    process.env.MRSCRAPER_GLAMA_CLAIM ?? DEFAULT_GLAMA_CLAIM
  ).trim();
  return claim || undefined;
}

export function httpRuntimeConfig(): {
  host: string;
  port: number;
  allowedOrigins: string[];
} {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || "8000");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return { host, port, allowedOrigins: parseAllowedOrigins() };
}

// Scope names issued by the platform's authorization server and checked again
// by the scraper gateway (GET / needs scrape:read, POST / needs scrape:write).
export const OAUTH_SCOPES = ["scrape:read", "account:read"] as const;

export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const DOCUMENTATION_URL =
  "https://docs.mrscraper.com/docs/getting-started/mcp-server";

export interface OAuthConfig {
  enabled: boolean;

  issuer: string;

  jwksUrl: string;

  publicUrl: string;

  resourceUrl: string;
  scopesSupported: readonly string[];
  documentationUrl: string;
}

export function getOAuthConfig(): OAuthConfig {
  const issuer = baseUrl(
    "MRSCRAPER_OAUTH_ISSUER",
    "https://api.app.mrscraper.com",
  );
  const publicUrl = baseUrl(
    "MRSCRAPER_MCP_PUBLIC_URL",
    "https://mcp.mrscraper.com",
  );
  return {
    enabled: environmentFlag("MRSCRAPER_OAUTH", true),
    issuer,
    jwksUrl: baseUrl(
      "MRSCRAPER_OAUTH_JWKS_URL",
      `${issuer}/.well-known/jwks.json`,
    ),
    publicUrl,
    resourceUrl: `${publicUrl}/mcp`,
    scopesSupported: OAUTH_SCOPES,
    documentationUrl: baseUrl("MRSCRAPER_DOCS_URL", DOCUMENTATION_URL),
  };
}
