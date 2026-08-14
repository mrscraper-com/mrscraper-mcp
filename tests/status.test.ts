import { describe, expect, it } from "vitest";

import {
  formatApiDate,
  parseStatusDate,
  summarizeSubscriptionAccount,
} from "../src/status.js";

describe("status helpers", () => {
  it("supports durations and ISO values", () => {
    const now = new Date("2026-08-10T12:00:00Z");
    expect(formatApiDate(parseStatusDate("24h", now))).toBe(
      "2026-08-09 12:00:00",
    );
    expect(formatApiDate(parseStatusDate("2026-08-01T00:00:00Z", now))).toBe(
      "2026-08-01 00:00:00",
    );
  });

  it("rejects invalid date input", () => {
    expect(() => parseStatusDate("last Tuesday")).toThrow("Invalid date");
  });

  it("summarizes account data without credentials", () => {
    const summary = summarizeSubscriptionAccount({
      stripeStatus: "active",
      stripeSubscriptionId: "sub_secret",
      tokenLimit: 1000,
      tokenUsage: 250,
      rateLimit: 10,
      rateTtl: 60,
      isAutoRenew: true,
      user: {
        name: "Ada",
        email: "ada@example.com",
        latestApiToken: "atk_secret",
        isVerified: true,
      },
    });
    expect(summary.token_remaining).toBe(750);
    expect(summary.usage_percent).toBe(25);
    expect(summary.subscription_status).toBe("active");
    expect(summary).not.toHaveProperty("stripeSubscriptionId");
    expect(summary.user).not.toHaveProperty("latestApiToken");
  });
});
