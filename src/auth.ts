import type {
  AuthInfo,
  McpRequestContext,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

import { getApiEndpoints } from "./config.js";
import { request } from "./http.js";

const TOKEN_VALIDATE_TIMEOUT_SECONDS = 15;

export const MISSING_TOKEN_MESSAGE =
  'MrScraper API token is required. For HTTP, configure the MCP client with "headers": {"Authorization": "Bearer <your-token>"}. For stdio, set MRSCRAPER_API_KEY or MRSCRAPER_API_TOKEN.';

export function normalizeBearerToken(token: string): string {
  return token
    .trim()
    .replace(/^bearer\s+/i, "")
    .trim();
}

function environmentApiToken(): string | undefined {
  for (const name of ["MRSCRAPER_API_KEY", "MRSCRAPER_API_TOKEN"]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveApiToken(context?: Partial<McpRequestContext>): string {
  const verified = context?.authInfo?.token?.trim();
  if (verified) return normalizeBearerToken(verified);

  const requestInfo = context?.requestInfo;
  if (requestInfo) {
    for (const name of ["x-api-token", "authorization"]) {
      const value = requestInfo.headers.get(name)?.trim();
      if (value) return normalizeBearerToken(value);
    }
    throw new Error(MISSING_TOKEN_MESSAGE);
  }

  const environmentToken = environmentApiToken();
  if (environmentToken) return environmentToken;
  throw new Error(MISSING_TOKEN_MESSAGE);
}

export async function validateApiToken(
  token: string,
  fetchFn?: typeof fetch,
): Promise<boolean> {
  const apiToken = normalizeBearerToken(token);
  if (!apiToken) return false;
  const response = await request(
    "GET",
    getApiEndpoints().subscriptionAccounts,
    {
      headers: { accept: "application/json", "x-api-token": apiToken },
      timeout: TOKEN_VALIDATE_TIMEOUT_SECONDS,
      fetchFn,
    },
  );
  return response.status_code === 200 && !response.error;
}

export function createTokenVerifier(
  validate: (token: string) => Promise<boolean> = validateApiToken,
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (!(await validate(token))) {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "Invalid MrScraper API token",
        );
      }
      return {
        token: normalizeBearerToken(token),
        clientId: "mrscraper-mcp",
        scopes: [],
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
      };
    },
  };
}
