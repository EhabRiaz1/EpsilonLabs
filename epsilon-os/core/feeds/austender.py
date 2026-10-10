"""AusTender (Australian Government) approaches to market (ATMs).

The AusTender OCDS API (https://api.tenders.gov.au/ocds/findByDates/<contractPublished|contractLastModified|
contractStart|contractEnd>/<from>/<to>, verified live 2026-10-11, no key) only publishes AWARDED contract notices,
never open tenders, so it is no use for finding bids. The open ATMs are published on:

  1. RSS "AusTender Current ATM List": https://www.tenders.gov.au/public_data/rss/rss.xml
     (title "<ATM id>: <title>", link .../Atm/Show/<uuid>, short description, pubDate = publish date)
  2. the public ATM page for each new item, which carries the agency, UNSPSC category, close date (ACT local time),
     location, type and conditions for participation. Parsed from the `list-desc` label/value pairs.

We read the RSS, keep items published since `since`, then fetch those pages one at a time with a pause between
(at most MAX_DETAIL per run). The public pages show no estimated value, so value stays unknown.
"""
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

from core.feeds import base
from core.feeds.base import Opp

SOURCE = "austender"
RSS_URL = "https://www.tenders.gov.au/public_data/rss/rss.xml"
MAX_DETAIL = 60
CANBERRA = ZoneInfo("Australia/Canberra")
_PAIR = re.compile(r'<div class="list-desc">\s*<span><label for="(\w+)">.*?</label>:</span>\s*'
                   r'<div class="list-desc-inner">(.*?)</div>\s*</div>', re.S)
_UUID = re.compile(r"/Atm/Show/([0-9a-fA-F-]{36})")


def parse_rss(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    items = []
    for it in root.iter("item"):
        link = (it.findtext("link") or "").strip()
        m = _UUID.search(link)
        if not m:
            continue
        title = (it.findtext("title") or "").strip()
        ref, _, rest = title.partition(": ")
        try:
            pub = parsedate_to_datetime(it.findtext("pubDate") or "")
        except (TypeError, ValueError):
            pub = None
        items.append({"uuid": m.group(1).lower(), "link": link, "ref": ref if rest else "", "title": rest or title,
                      "description": base.clean_text(it.findtext("description"), 600), "published": pub})
    return items


def parse_close(text: str) -> datetime | None:
    m = re.search(r"(\d{1,2}-[A-Za-z]{3}-\d{4})(?:\s+(\d{1,2}:\d\d\s*[ap]m))?", text or "")
    if not m:
        return None
    try:
        d = datetime.strptime(m.group(1), "%d-%b-%Y")
        if m.group(2):
            t = datetime.strptime(m.group(2).replace(" ", ""), "%I:%M%p")
            d = d.replace(hour=t.hour, minute=t.minute)
    except ValueError:
        return None
    return d.replace(tzinfo=CANBERRA).astimezone(ZoneInfo("UTC"))


def parse_detail(page: str) -> dict:
    out = {}
    for key, val in _PAIR.findall(page):
        out[key] = base.clean_text(val, 2500)
    return out


def build(item: dict, detail: dict) -> Opp:
    cat = detail.get("Category", "")
    code = cat.split(" - ")[0].strip() if cat else ""
    parts = [detail.get("Description") or item["description"]]
    for k, label in (("ConditionsForParticipation", "Conditions for participation"),
                     ("OtherInstructions", "Other instructions"), ("MultiStageCriteria", "Criteria")):
        if detail.get(k):
            parts.append(f"{label}: {detail[k]}")
    return Opp(
        source=SOURCE, source_id=item["uuid"], title=base.clean_text(item["title"], 300), url=item["link"],
        buyer=detail.get("Agency", ""), country="AU", cpv_or_naics=[code] if code.isdigit() else [],
        published_at=item["published"] and base.parse_dt(item["published"].isoformat()),
        deadline_at=parse_close(detail.get("CloseDate", "")), summary=base.clean_text("\n".join(p for p in parts if p)),
        raw={"atm_id": item["ref"] or detail.get("AtmId"), "type": detail.get("Type"),
             "location": detail.get("Locations"), "category": cat,
             "panel": detail.get("PanelArrangement"), "multi_agency": detail.get("MultiAgencyAccess")},
    )


def fetch(since: date, client=None) -> list[Opp]:
    c = client or base.client()
    items = parse_rss(base.request(c, "GET", RSS_URL).text)
    cutoff = base.as_datetime(since)
    fresh = [i for i in items if i["published"] is None or i["published"].astimezone(cutoff.tzinfo) >= cutoff]
    out = []
    for n, item in enumerate(fresh[:MAX_DETAIL]):
        if n:
            base.pause()
        try:
            detail = parse_detail(base.request(c, "GET", item["link"]).text)
        except base.FeedError:
            detail = {}  # keep the notice on its RSS facts rather than lose it
        out.append(build(item, detail))
    return out
