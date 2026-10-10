"""Parser shared by the UK feeds (Find a Tender, Contracts Finder): one OCDS release -> Opp."""
from core.feeds import base
from core.feeds.base import Opp


def _value(v) -> tuple[float | None, float | None, str]:
    if not isinstance(v, dict):
        return None, None, ""
    amount = base.num(v.get("amount"))
    lo, hi = base.num(v.get("amountMin") or v.get("minimum")), base.num(v.get("amountMax") or v.get("maximum"))
    cur = str(v.get("currency") or "")
    return (lo or amount), (hi or amount), cur


def parse_release(rel: dict, source: str, notice_url) -> Opp | None:
    t = rel.get("tender") or {}
    if not isinstance(t, dict) or (t.get("status") and t["status"] not in ("active", "planned")):
        return None
    rid = rel.get("ocid") or rel.get("id")  # ocid is stable across amendments of one procurement
    title = base.clean_text(t.get("title"), 300)
    if not rid or not title:
        return None
    parties = [p for p in rel.get("parties") or [] if isinstance(p, dict)]
    buyers = [p for p in parties if "buyer" in (p.get("roles") or [])]
    buyer = (buyers[0] if buyers else {}) or {}
    name = buyer.get("name") or (rel.get("buyer") or {}).get("name") or ""
    country = base.country_code((buyer.get("address") or {}).get("countryName") or "United Kingdom")
    cls = []
    for c in [t.get("classification")] + list(t.get("additionalClassifications") or []):
        if isinstance(c, dict) and c.get("id") and (c.get("scheme") or "CPV") == "CPV":
            cls.append(str(c["id"]))
    for lot in t.get("lots") or []:
        for c in [lot.get("classification")] if isinstance(lot, dict) else []:
            if isinstance(c, dict) and c.get("id"):
                cls.append(str(c["id"]))
    vmin, vmax, cur = _value(t.get("value"))
    if vmin is None and vmax is None:
        vmin, vmax, cur = _value(t.get("minValue") or {})
        _, hi, _ = _value(t.get("maxValue") or {})
        vmax = hi or vmax
    period = t.get("tenderPeriod") or {}
    suit = t.get("suitability") or {}
    return Opp(
        source=source, source_id=str(rid), title=title, url=notice_url(rel), buyer=base.clean_text(name, 200),
        country=country, cpv_or_naics=list(dict.fromkeys(cls)),
        published_at=base.parse_dt(t.get("datePublished") or rel.get("date")),
        deadline_at=base.parse_dt(period.get("endDate")), value_min=vmin, value_max=vmax, currency=cur,
        summary=base.clean_text(t.get("description")),
        raw={"procedure": t.get("procurementMethodDetails") or t.get("procurementMethod"),
             "category": t.get("mainProcurementCategory"), "sme_suitable": suit.get("sme"),
             "languages": (t.get("submissionTerms") or {}).get("languages"),
             "documents": [d.get("url") for d in (t.get("documents") or []) if isinstance(d, dict) and d.get("url")][:3]},
    )
