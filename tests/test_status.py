from datetime import datetime, timezone

from mrscraper_mcp.status import (
    format_api_date,
    parse_status_date,
    summarize_subscription_account,
)


def test_status_dates_support_durations_and_iso_values():
    now = datetime(2026, 8, 10, 12, tzinfo=timezone.utc)
    assert format_api_date(parse_status_date("24h", now)) == "2026-08-09 12:00:00"
    assert format_api_date(parse_status_date("2026-08-01T00:00:00Z", now)) == (
        "2026-08-01 00:00:00"
    )


def test_account_summary_is_concise_and_excludes_credentials():
    summary = summarize_subscription_account(
        {
            "stripeStatus": "active",
            "stripeSubscriptionId": "sub_secret",
            "tokenLimit": 1_000,
            "tokenUsage": 250,
            "rateLimit": 10,
            "rateTtl": 60,
            "isAutoRenew": True,
            "user": {
                "name": "Ada",
                "email": "ada@example.com",
                "latestApiToken": "atk_secret",
                "isVerified": True,
            },
        }
    )
    assert summary["token_remaining"] == 750
    assert summary["usage_percent"] == 25
    assert summary["subscription_status"] == "active"
    assert "stripeSubscriptionId" not in summary
    assert "latestApiToken" not in summary["user"]
