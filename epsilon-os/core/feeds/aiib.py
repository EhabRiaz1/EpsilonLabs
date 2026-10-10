"""Asian Infrastructure Investment Bank project procurement opportunities (Pakistan is a member: eligible).

SHIPPED DISABLED. The list page (aiib.org/en/opportunities/business/project-procurement/list.html) loads but its table is rendered by JavaScript from an unpublished endpoint; no static rows to read, checked 2026-10-11.
It is not in the default `tenders.sources`; enabling it only produces a "disabled" line in the run report.
Never scraped behind a login or past an anti-bot check.
"""
from core.feeds import base

SOURCE = "aiib"
REASON = 'The list page (aiib.org/en/opportunities/business/project-procurement/list.html) loads but its table is rendered by JavaScript from an unpublished endpoint; no static rows to read, checked 2026-10-11.'
fetch = base.disabled(SOURCE, REASON)
