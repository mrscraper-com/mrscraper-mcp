import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type {
  AuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

import { normalizeBearerToken, validateApiToken } from "./auth.js";
import { getOAuthConfig, type OAuthConfig } from "./config.js";
import { ALL_SCOPES } from "./scopes.js";

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export function isOAuthAccessToken(token: string): boolean {
  return JWT_SHAPE.test(normalizeBearerToken(token));
}

function invalidToken(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}

function claimedScopes(payload: JWTPayload): string[] {
  const { scope, scp } = payload as { scope?: unknown; scp?: unknown };
  if (typeof scope === "string") return scope.split(/\s+/).filter(Boolean);
  if (Array.isArray(scp))
    return scp.filter((value) => typeof value === "string");
  return [];
}

export function createOAuthVerifier(
  config: OAuthConfig = getOAuthConfig(),
): OAuthTokenVerifier {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));

  return {
    async verifyAccessToken(rawToken: string): Promise<AuthInfo> {
      const token = normalizeBearerToken(rawToken);
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.resourceUrl,
        }));
      } catch (error) {
        throw invalidToken(
          `Invalid MrScraper access token: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (typeof payload.sub !== "string" || !payload.sub) {
        throw invalidToken("Access token is missing a subject");
      }
      if (typeof payload.exp !== "number") {
        throw invalidToken("Access token is missing an expiry");
      }

      const clientId = payload.client_id;
      return {
        token,
        clientId: typeof clientId === "string" ? clientId : config.issuer,
        scopes: claimedScopes(payload),
        expiresAt: payload.exp,
        resource: new URL(config.resourceUrl),
        extra: { userId: payload.sub, oauth: true },
      };
    },
  };
}

export function createCompositeVerifier(
  options: {
    config?: OAuthConfig;
    validateToken?: (token: string) => Promise<boolean>;
  } = {},
): OAuthTokenVerifier {
  const config = options.config ?? getOAuthConfig();
  const validate = options.validateToken ?? validateApiToken;
  const oauth = config.enabled ? createOAuthVerifier(config) : undefined;

  return {
    async verifyAccessToken(rawToken: string): Promise<AuthInfo> {
      const token = normalizeBearerToken(rawToken);
      if (oauth && isOAuthAccessToken(token)) {
        return oauth.verifyAccessToken(token);
      }
      if (!(await validate(token))) {
        throw invalidToken("Invalid MrScraper API token");
      }
      return {
        token,
        clientId: "mrscraper-mcp",
        scopes: [...ALL_SCOPES],
        expiresAt: Math.floor(Date.now() / 1_000) + 300,
        extra: { oauth: false },
      };
    },
  };
}

export function buildAuthorizationServerMetadata(
  config: OAuthConfig = getOAuthConfig(),
): OAuthMetadata {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    jwks_uri: config.jwksUrl,
    scopes_supported: [...config.scopesSupported, "offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],

    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: config.documentationUrl,
  };
}
