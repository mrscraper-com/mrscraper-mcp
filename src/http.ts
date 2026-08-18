import type { JSONValue } from "@modelcontextprotocol/server";

export const DEFAULT_TIMEOUT_SECONDS = 600;

const SENSITIVE_RESPONSE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
  "x-api-token",
]);

const SENSITIVE_DATA_KEYS = new Set([
  "accesstoken",
  "api_key",
  "apikey",
  "apitoken",
  "authorization",
  "cookie",
  "latestapitoken",
  "password",
  "refreshtoken",
  "secret",
  "set-cookie",
  "token",
  "x-api-token",
]);

const API_TOKEN_PATTERN = /\batk_[A-Za-z0-9_-]{12,}\b/g;
const AUTHORIZATION_PATTERN = /(authorization\s*:\s*bearer\s+)[^\s'"\\]+/gi;
const API_HEADER_PATTERN = /(x-api-token\s*:\s*)[^\s'"\\]+/gi;
const SIGNED_QUERY_PATTERN =
  /([?&](?:token|api[_-]?key|signature|sig|x-amz-(?:credential|security-token|signature))=)[^&\s'"\\]+/gi;

export interface ApiResponse {
  status_code: number | null;
  data: JSONValue;
  headers: Record<string, string>;
  error?: string;
  [key: string]: unknown;
}

export interface HttpRequestOptions {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean | null | undefined>;
  json?: unknown;
  timeout?: number;
  fetchFn?: typeof fetch;
}

function redactSensitiveString(value: string): string {
  return value
    .replace(API_TOKEN_PATTERN, "[REDACTED_API_TOKEN]")
    .replace(AUTHORIZATION_PATTERN, "$1[REDACTED]")
    .replace(API_HEADER_PATTERN, "$1[REDACTED]")
    .replace(SIGNED_QUERY_PATTERN, "$1[REDACTED]");
}

export function sanitizeResponseData(
  value: unknown,
  seen = new WeakSet<object>(),
): JSONValue {
  if (value === null || typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResponseData(item, seen));
  }

  const sanitized: Record<string, JSONValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const isExtractedPayload =
      normalizedKey === "data" &&
      [
        "id",
        "scraperId",
        "status",
        "type",
        "url",
        "runtime",
        "tokenUsage",
      ].some((marker) => Object.hasOwn(value, marker));

    if (isExtractedPayload) {
      sanitized[key] = item as JSONValue;
    } else if (SENSITIVE_DATA_KEYS.has(normalizedKey)) {
      sanitized[key] = "[REDACTED]";
    } else if (normalizedKey === "curl" && typeof item === "string") {
      sanitized[key] = redactSensitiveString(item);
    } else {
      sanitized[key] = sanitizeResponseData(item, seen);
    }
  }
  return sanitized;
}

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    [...response.headers.entries()].filter(
      ([name]) => !SENSITIVE_RESPONSE_HEADERS.has(name.toLowerCase()),
    ),
  );
}

async function responseData(response: Response): Promise<JSONValue> {
  const body = await response.text();
  const contentType = (
    response.headers.get("content-type") || ""
  ).toLowerCase();
  if (contentType.includes("application/json")) {
    try {
      return sanitizeResponseData(body ? JSON.parse(body) : null);
    } catch {
      return sanitizeResponseData(body);
    }
  }
  return body;
}

export async function request(
  method: string,
  url: string,
  options: HttpRequestOptions = {},
): Promise<ApiResponse> {
  const timeout = Number(options.timeout ?? DEFAULT_TIMEOUT_SECONDS);
  const timeoutSeconds =
    Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS;
  const target = new URL(url);
  for (const [name, value] of Object.entries(options.params || {})) {
    if (value !== undefined && value !== null) {
      target.searchParams.set(name, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.ceil(timeoutSeconds * 1_000)),
  );
  const headers = { ...(options.headers || {}) };
  const init: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    headers.accept = "application/json";
    init.body = JSON.stringify(options.json);
  }

  try {
    const response = await (options.fetchFn || fetch)(target, init);
    const data = await responseData(response);
    const safeHeaders = responseHeaders(response);
    if (response.status === 401) {
      return {
        error:
          "Unauthorized or invalid token. Run `mrscraper login` or visit https://app.mrscraper.com.",
        status_code: response.status,
        data,
        headers: safeHeaders,
      };
    }
    if (!response.ok) {
      return {
        error: `HTTP ${response.status}`,
        status_code: response.status,
        data,
        headers: safeHeaders,
      };
    }
    return {
      status_code: response.status,
      data,
      headers: safeHeaders,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aborted =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError") ||
      /abort(?:ed)?/i.test(message);
    return {
      error: aborted ? `Request timed out after ${timeoutSeconds}s` : message,
      status_code: null,
      data: null,
      headers: {},
    };
  } finally {
    clearTimeout(timer);
  }
}
