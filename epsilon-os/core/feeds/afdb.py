"""African Development Bank procurement notices.

SHIPPED DISABLED. https://www.afdb.org/... answers HTTP 403 to non-browser clients, checked 2026-10-11. Also, Pakistan is not an AfDB member country, so most notices would be flagged ineligible anyway.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "afdb"
REASON = 'https://www.afdb.org/... answers HTTP 403 to non-browser clients, checked 2026-10-11. Also, Pakistan is not an AfDB member country, so most notices would be flagged ineligible anyway.'
fetch = base.disabled(SOURCE, REASON)
