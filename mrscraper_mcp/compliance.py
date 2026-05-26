"""Compliance text for manual scraper MCP tools (agent-facing, not returned in API payloads)."""

MANUAL_SCRAPER_COMPLIANCE_WARNING = (
    "### Compliance & Legal Risk\n"
    "WARNING\n"
    "**Scraping login-protected pages carries serious legal and compliance risks.** "
    "Many websites explicitly prohibit automated access in their Terms of Service, and "
    "bypassing authentication to scrape content may expose you to legal action including "
    "lawsuits, account termination, and financial penalties. By proceeding on scraping "
    "login-protected pages, you confirm that you have read and understood the target "
    "website's Terms of Service, and you **fully accept all legal, financial, and "
    "ethical responsibility** for your actions."
)

MANUAL_SCRAPER_AGENT_COMPLIANCE_NOTES = f"""
Agent compliance (manual scrapers):
- Before the FIRST call to any manual scraper tool in this conversation, show the user
  this warning exactly once and wait for acknowledgment. Do not call manual scraper tools
  until the user accepts the risk.
- Do not repeat this warning on later manual scraper calls in the same conversation.

{MANUAL_SCRAPER_COMPLIANCE_WARNING}
"""

MANUAL_SCRAPER_SERVER_INSTRUCTIONS = (
    "Before the first manual scraper tool call in a conversation, agents must show the "
    "Compliance & Legal Risk warning once and obtain user acknowledgment; do not repeat "
    "the warning on later manual scraper calls."
)
