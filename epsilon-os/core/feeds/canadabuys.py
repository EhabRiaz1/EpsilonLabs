"""CanadaBuys open tender notices (Government of Canada), open-data CSV.

    GET https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv
(no key; verified live 2026-10-11, about 900 open notices, 6 MB). The server answers 403 to the default
python-httpx User-Agent and 200 to ours (see base.USER_AGENT). Columns used:
referenceNumber, title-titre-eng, publicationDate, tenderClosingDate, unspsc, gsin, procurementCategory,
contractingEntityName-eng, regionsOfDelivery-eng, noticeURL-eng, tenderDescription-eng. The CSV has no value
field, so value stays unknown (kept by the value filter). Canadian notices use UNSPSC/GSIN, not CPV: relevance
there comes from the keyword set.
"""
import csv
import io
from datetime import date

from core.feeds import base
from core.feeds.base import Opp

SOURCE = "canadabuys"
URL = "https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv"
MAX_BYTES = 40_000_000


def _col(row: dict, prefix: str) -> str:
    for k, v in row.items():
        if k and k.startswith(prefix) and v:
            return v.strip()
    return ""


def parse(text: str) -> list[Opp]:
    rows = csv.DictReader(io.StringIO(text.lstrip("﻿"), newline=""))
    out: dict[str, Opp] = {}
    for r in rows:
        status = _col(r, "tenderStatus-appelOffresStatut-eng")
        ref = _col(r, "referenceNumber-")
        title = base.clean_text(_col(r, "title-titre-eng"), 300)
        if not ref or not title or (status and status.lower() != "open"):
            continue
        codes = [c.strip().strip("*") for c in (_col(r, "unspsc") + ";" + _col(r, "gsin-nibs")).replace("\n", ";").split(";")]
        out[ref] = Opp(
            source=SOURCE, source_id=ref, title=title, url=_col(r, "noticeURL-URLavis-eng"),
            buyer=base.clean_text(_col(r, "contractingEntityName-nomEntitContractante-eng"), 200), country="CA",
            cpv_or_naics=[c for c in dict.fromkeys(codes) if c],
            published_at=base.parse_dt(_col(r, "publicationDate-")),
            deadline_at=base.parse_dt(_col(r, "tenderClosingDate-")),
            summary=base.clean_text(_col(r, "tenderDescription-descriptionAppelOffres-eng")),
            raw={"solicitation": _col(r, "solicitationNumber-"), "notice_type": _col(r, "noticeType-avisType-eng"),
                 "method": _col(r, "procurementMethod-methodeApprovisionnement-eng"),
                 "category": _col(r, "procurementCategory-"),
                 "trade_agreements": _col(r, "tradeAgreements-accordsCommerciaux-eng")[:300],
                 "delivery_regions": _col(r, "regionsOfDelivery-regionsLivraison-eng")[:200]},
        )
    return list(out.values())


def fetch(since: date, client=None) -> list[Opp]:
    c = client or base.client()
    r = base.request(c, "GET", URL, headers={"Accept": "text/csv,*/*"})
    if len(r.content) > MAX_BYTES:
        raise base.FeedError("canadabuys: CSV unexpectedly large")
    cutoff = base.as_datetime(since)
    return [o for o in parse(r.content.decode("utf-8-sig", "replace"))
            if o.published_at is None or o.published_at >= cutoff]
