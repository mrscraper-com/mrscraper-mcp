function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function formatApiDate(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }
  return date
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, "");
}

export function parseStatusDate(
  value: string | undefined,
  now = new Date(),
  fallbackDuration = "24h",
): Date {
  const input = (value || fallbackDuration).trim().toLowerCase();
  if (input === "now") return new Date(now);

  const relative = /^(\d+)(m|h|d|w)$/.exec(input);
  if (relative) {
    const amount = Number(relative[1]);
    const units: Record<string, number> = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    return new Date(now.getTime() - amount * (units[relative[2]!] || 0));
  }

  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid date "${value}". Use ISO 8601, "now", or a duration such as 24h or 7d.`,
    );
  }
  return parsed;
}

export interface SubscriptionSummary {
  subscription_status: unknown;
  enterprise: boolean;
  token_usage: number;
  token_limit: number;
  token_remaining: number;
  usage_percent: number;
  rate_limit: number;
  rate_ttl: number;
  auto_renew: boolean;
  ends_at: unknown;
  user: {
    name: unknown;
    email: unknown;
    verified: boolean;
  };
}

export function summarizeSubscriptionAccount(
  account: Record<string, unknown>,
): SubscriptionSummary {
  const tokenLimit = numberOrZero(account.tokenLimit);
  const tokenUsage = numberOrZero(account.tokenUsage);
  const user = recordOrEmpty(account.user);
  return {
    subscription_status: account.stripeStatus ?? null,
    enterprise: Boolean(account.isEnterprise),
    token_usage: tokenUsage,
    token_limit: tokenLimit,
    token_remaining: Math.max(0, tokenLimit - tokenUsage),
    usage_percent:
      tokenLimit > 0 ? Number(((tokenUsage / tokenLimit) * 100).toFixed(2)) : 0,
    rate_limit: numberOrZero(account.rateLimit),
    rate_ttl: numberOrZero(account.rateTtl),
    auto_renew: Boolean(account.isAutoRenew),
    ends_at: account.endsAt ?? null,
    user: {
      name: user.name ?? null,
      email: user.email ?? null,
      verified: Boolean(user.isVerified),
    },
  };
}
