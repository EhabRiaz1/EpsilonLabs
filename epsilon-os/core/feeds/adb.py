"""Asian Development Bank tenders and consulting notices (Pakistan is a member: eligible).

SHIPPED DISABLED. https://www.adb.org/projects/tenders and /api/tenders answer HTTP 403 to non-browser clients (WAF), checked 2026-10-11. No public feed reachable by code. Re-enable only with an official API or feed URL.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "adb"
REASON = 'https://www.adb.org/projects/tenders and /api/tenders answer HTTP 403 to non-browser clients (WAF), checked 2026-10-11. No public feed reachable by code. Re-enable only with an official API or feed URL.'
fetch = base.disabled(SOURCE, REASON)
