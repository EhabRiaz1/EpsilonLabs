"""Islamic Development Bank procurement notices (Pakistan is a member: eligible).

SHIPPED DISABLED. https://www.isdb.org/procurement returns 404 and no public notice feed was found, checked 2026-10-11.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "isdb"
REASON = 'https://www.isdb.org/procurement returns 404 and no public notice feed was found, checked 2026-10-11.'
fetch = base.disabled(SOURCE, REASON)
