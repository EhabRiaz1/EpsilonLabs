"""Bahrain Tender Board.

SHIPPED DISABLED. tenderboard.gov.bh is reachable, but no public tender listing without supplier login was found, so nothing is read from it.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "bahrain"
REASON = 'tenderboard.gov.bh is reachable, but no public tender listing without supplier login was found, so nothing is read from it.'
fetch = base.disabled(SOURCE, REASON)
