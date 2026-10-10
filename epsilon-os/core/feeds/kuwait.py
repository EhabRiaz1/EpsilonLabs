"""Kuwait Central Tenders Committee (CAPT/CTC).

SHIPPED DISABLED. The site is an Arabic JavaScript application; no public machine-readable listing was found, checked 2026-10-11.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "kuwait"
REASON = 'The site is an Arabic JavaScript application; no public machine-readable listing was found, checked 2026-10-11.'
fetch = base.disabled(SOURCE, REASON)
