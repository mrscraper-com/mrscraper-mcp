function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

// Copies only usage fields: the raw account also carries the caller's API key
// (user.latestApiToken) and Stripe identifiers.
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
