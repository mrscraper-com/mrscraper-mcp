export const VERSION = "0.1.0";

export const TOOL_NAMES = [
  "fetch",
  "scrape",
  "serp",
  "status",
  "rerun",
  "results",
  "result",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type Transport = "stdio" | "http";

export interface ApiEndpoints {
  apiBaseUrl: string;
  fetchHtmlBaseUrl: string;
  syncScraperBaseUrl: string;
  subscriptionAccounts: string;
  analyticStatuses: string;
  scrapersAi: string;
  scrapersAiRerun: string;
  scrapersAiRerunBulk: string;
  scrapersManualRerun: string;
  scrapersManualRerunBulk: string;
  results: string;
  googleSerpSync: string;
}

function baseUrl(environmentName: string, fallback: string): string {
  return (process.env[environmentName] || fallback).replace(/\/+$/, "");
}

export function getApiEndpoints(): ApiEndpoints {
  const apiBaseUrl = baseUrl(
    "MRSCRAPER_API_BASE_URL",
    "https://api.app.mrscraper.com/api/v1",
  );
  const fetchHtmlBaseUrl = baseUrl(
    "MRSCRAPER_FETCH_BASE_URL",
    "https://api.mrscraper.com",
  );
  const syncScraperBaseUrl = baseUrl(
    "MRSCRAPER_SYNC_BASE_URL",
    "https://sync.scraper.mrscraper.com",
  );

  return {
    apiBaseUrl,
    fetchHtmlBaseUrl,
    syncScraperBaseUrl,
    subscriptionAccounts: `${apiBaseUrl}/subscription-accounts`,
    analyticStatuses: `${apiBaseUrl}/analytic/statuses`,
    scrapersAi: `${apiBaseUrl}/scrapers-ai`,
    scrapersAiRerun: `${apiBaseUrl}/scrapers-ai-rerun`,
    scrapersAiRerunBulk: `${apiBaseUrl}/scrapers-ai-rerun/bulk`,
    scrapersManualRerun: `${apiBaseUrl}/scrapers-manual-rerun`,
    scrapersManualRerunBulk: `${apiBaseUrl}/scrapers-manual-rerun/bulk`,
    results: `${apiBaseUrl}/results`,
    googleSerpSync: `${syncScraperBaseUrl}/api/google/serp/v2/sync`,
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

export const OAUTH_SCOPES = [
  "scrape:read",
  "scrape:write",
  "account:read",
] as const;

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
