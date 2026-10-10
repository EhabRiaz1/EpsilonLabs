"""Saudi Etimad public tender listing.

SHIPPED DISABLED. tenders.etimad.sa answers every non-browser request with an anti-bot human-verification challenge (CAPTCHA), checked 2026-10-11. Not bypassed.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "etimad"
REASON = 'tenders.etimad.sa answers every non-browser request with an anti-bot human-verification challenge (CAPTCHA), checked 2026-10-11. Not bypassed.'
fetch = base.disabled(SOURCE, REASON)
