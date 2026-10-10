"""Qatar Monaqasat tenders.

SHIPPED DISABLED. monaqasat.mof.gov.qa timed out on connect from this network, checked 2026-10-11, and its supplier area needs login.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "monaqasat"
REASON = 'monaqasat.mof.gov.qa timed out on connect from this network, checked 2026-10-11, and its supplier area needs login.'
fetch = base.disabled(SOURCE, REASON)
