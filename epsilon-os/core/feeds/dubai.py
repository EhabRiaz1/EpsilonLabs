"""Dubai eSupply / UAE federal tenders.

SHIPPED DISABLED. esupply.dubai.gov.ae returns an empty JavaScript shell and its supplier tender list is behind login; the UAE federal site has no public feed. Not scraped behind a login.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "dubai"
REASON = 'esupply.dubai.gov.ae returns an empty JavaScript shell and its supplier tender list is behind login; the UAE federal site has no public feed. Not scraped behind a login.'
fetch = base.disabled(SOURCE, REASON)
