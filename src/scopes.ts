import {
  OAUTH_SCOPES,
  TOOL_NAMES,
  type OAuthScope,
  type ToolName,
} from "./config.js";

export const TOOL_SCOPES: Record<ToolName, OAuthScope> = {
  fetch: "scrape:read",
  serp: "scrape:read",
  results: "scrape:read",
  result: "scrape:read",
  scrape: "scrape:write",
  rerun: "scrape:write",
  status: "account:read",
};

export const ALL_SCOPES: OAuthScope[] = [...OAUTH_SCOPES];

function isToolName(value: unknown): value is ToolName {
  return (
    typeof value === "string" &&
    (TOOL_NAMES as readonly string[]).includes(value)
  );
}

export function requiredScopesForRequest(body: unknown): OAuthScope[] {
  const messages = Array.isArray(body) ? body : [body];
  const required = new Set<OAuthScope>();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const { method, params } = message as {
      method?: unknown;
      params?: { name?: unknown };
    };
    if (method !== "tools/call") continue;
    const name = params?.name;
    if (isToolName(name)) required.add(TOOL_SCOPES[name]);
  }
  return [...required];
}

export function missingScopes(
  granted: readonly string[],
  required: readonly OAuthScope[],
): OAuthScope[] {
  const held = new Set(granted);
  return required.filter((scope) => !held.has(scope));
}
