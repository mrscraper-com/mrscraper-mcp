import { describe, expect, it } from "vitest";

import { summarizeSubscriptionAccount } from "../src/status.js";

describe("status helpers", () => {
  it("summarizes account data without credentials", () => {
    const summary = summarizeSubscriptionAccount({
      stripeStatus: "active",
      stripeSubscriptionId: "sub_secret",
      tokenLimit: 1000,
      tokenUsage: 1250,
      rateLimit: 10,
      rateTtl: 60,
      isAutoRenew: true,
      user: {
        name: "Ada",
        email: "ada@example.test",
        latestApiToken: "atk_secret",
        isVerified: true,
      },
    });
    expect(summary.token_remaining).toBe(0);
    expect(summary.usage_percent).toBe(125);
    expect(summary.subscription_status).toBe("active");
    expect(summary).not.toHaveProperty("stripeSubscriptionId");
    expect(summary.user).not.toHaveProperty("latestApiToken");
  });

  it("tolerates missing and non-numeric fields", () => {
    const summary = summarizeSubscriptionAccount({
      tokenLimit: "abc",
      user: "not an object",
    });
    expect(summary).toMatchObject({
      subscription_status: null,
      token_limit: 0,
      token_usage: 0,
      token_remaining: 0,
      usage_percent: 0,
      ends_at: null,
      user: { name: null, email: null, verified: false },
    });
  });
});
