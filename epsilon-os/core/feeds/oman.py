"""Oman Tender Board.

SHIPPED DISABLED. tenderboard.gov.om did not resolve (DNS) from this network, checked 2026-10-11.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "oman"
REASON = 'tenderboard.gov.om did not resolve (DNS) from this network, checked 2026-10-11.'
fetch = base.disabled(SOURCE, REASON)
