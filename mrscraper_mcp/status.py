"""CLI-compatible account-status and date helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from typing import Any

_DURATION_PATTERN = re.compile(r"^(\d+)(m|h|d|w)$")


def format_api_date(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def parse_status_date(
    value: str | None,
    now: datetime | None = None,
    fallback_duration: str = "24h",
) -> datetime:
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)

    input_value = (value or fallback_duration).strip().lower()
    if input_value == "now":
        return reference

    match = _DURATION_PATTERN.fullmatch(input_value)
    if match:
        amount = int(match.group(1))
        unit = match.group(2)
        seconds = {
            "m": 60,
            "h": 3_600,
            "d": 86_400,
            "w": 604_800,
        }[unit]
        return reference - timedelta(seconds=amount * seconds)

    try:
        normalized = (
            input_value[:-1] + "+00:00" if input_value.endswith("z") else input_value
        )
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError(
            f'Invalid date "{value}". Use ISO 8601, "now", or a duration such as 24h or 7d.'
        ) from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _number_or_zero(value: Any) -> float | int:
    if isinstance(value, bool):
        return int(value)
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return int(number) if number.is_integer() else number


def summarize_subscription_account(account: dict[str, Any]) -> dict[str, Any]:
    token_limit = _number_or_zero(account.get("tokenLimit"))
    token_usage = _number_or_zero(account.get("tokenUsage"))
    user = account.get("user") if isinstance(account.get("user"), dict) else {}
    remaining = max(0, token_limit - token_usage)
    usage_percent = round((token_usage / token_limit) * 100, 2) if token_limit else 0

    return {
        "subscription_status": account.get("stripeStatus"),
        "enterprise": bool(account.get("isEnterprise")),
        "token_usage": token_usage,
        "token_limit": token_limit,
        "token_remaining": remaining,
        "usage_percent": usage_percent,
        "rate_limit": _number_or_zero(account.get("rateLimit")),
        "rate_ttl": _number_or_zero(account.get("rateTtl")),
        "auto_renew": bool(account.get("isAutoRenew")),
        "ends_at": account.get("endsAt"),
        "user": {
            "name": user.get("name"),
            "email": user.get("email"),
            "verified": bool(user.get("isVerified")),
        },
    }
