"""JSON schemas for the tool-less model calls. Code validates output against these (core.llm.ask)."""

LABELS = ["inquiry", "not_interested", "not_now", "opt_out", "auto_reply", "bounce", "injection_suspected"]
WEDGES = ["W1", "W2", "W3", "OUT", "NA"]
FLAGS = ["urgent", "referral", "existing_client", "dream25_candidate", "asks_price",
         "asks_timeline", "asks_guarantee", "contains_link", "asks_sensitive_info"]
STAGES = ["none", "conversation", "scoping_call", "quote_out", "lost", "dormant"]

CLASSIFY = {
    "type": "object",
    "additionalProperties": False,
    "required": ["label", "wedge", "flags", "stage_proposal", "confidence", "reason"],
    "properties": {
        "label": {"type": "string", "enum": LABELS},
        "wedge": {"type": "string", "enum": WEDGES},
        "flags": {"type": "array", "items": {"type": "string", "enum": FLAGS}},
        "stage_proposal": {"type": "string", "enum": STAGES},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "reason": {"type": "string", "maxLength": 400},
    },
}

DRAFT = {
    "type": "object",
    "additionalProperties": False,
    "required": ["body", "notes"],
    "properties": {
        "body": {"type": "string", "minLength": 1, "maxLength": 4000},
        "notes": {"type": "string", "maxLength": 400},
    },
}


# ---------------------------------------------------------------- prospector (P1-P5)

PROSPECT_SEGMENTS = ["industrial", "oem_hardware", "smb_software"]


def research(slugs: list[str]) -> dict:
    """Schema for core.llm.research. `slugs` are the offer slugs that exist in tools/offers.py."""
    contact = {
        "type": ["object", "null"],
        "additionalProperties": False,
        "required": ["email", "name", "role", "source_url"],
        "properties": {
            "email": {"type": "string", "maxLength": 254},
            "name": {"type": "string", "maxLength": 120},
            "role": {"type": "string", "maxLength": 120},
            "source_url": {"type": "string", "pattern": "^https?://", "maxLength": 500},
        },
    }
    company = {
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "domain", "country", "sector", "segment", "evidence_url", "evidence_quote",
                     "observation", "suggested_offer_slug", "contact", "confidence"],
        "properties": {
            "name": {"type": "string", "minLength": 1, "maxLength": 160},
            "domain": {"type": "string", "minLength": 3, "maxLength": 120},
            "country": {"type": "string", "pattern": "^[A-Z]{2}$"},
            "sector": {"type": "string", "maxLength": 80},
            "segment": {"type": "string", "enum": PROSPECT_SEGMENTS},
            "evidence_url": {"type": "string", "pattern": "^https?://", "maxLength": 500},
            "evidence_quote": {"type": "string", "minLength": 1, "maxLength": 240},
            "observation": {"type": "string", "minLength": 1, "maxLength": 400},
            "suggested_offer_slug": {"type": "string", "enum": list(slugs)},
            "contact": contact,
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        },
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["companies", "notes"],
        "properties": {
            "companies": {"type": "array", "maxItems": 5, "items": company},
            "notes": {"type": "string", "maxLength": 400},
        },
    }


DOSSIER = {
    "type": "object",
    "additionalProperties": False,
    "required": ["body_md"],
    "properties": {"body_md": {"type": "string", "minLength": 1, "maxLength": 3000}},
}

OUTBOUND = {
    "type": "object",
    "additionalProperties": False,
    "required": ["subject", "body", "notes"],
    "properties": {
        "subject": {"type": "string", "minLength": 1, "maxLength": 120},
        "body": {"type": "string", "minLength": 1, "maxLength": 1500},
        "notes": {"type": "string", "maxLength": 400},
    },
}


CONTACTS = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "contacts": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"domain": {"type": "string"}, "email": {"type": "string"}, "name": {"type": "string"},
                           "role": {"type": "string"}, "source_url": {"type": "string"}},
            "required": ["domain", "email", "source_url"]}},
        "notes": {"type": "string"}},
    "required": ["contacts"],
}


# ---------------------------------------------------------------- strategy research (S2-S5, migration 007)

STRATEGY_IDS = ["s2_trigger", "s3_regulation", "s4_partner", "s5_intent", "s7_orphaned", "s8_tradeshow", "s9_crowdfund",
                "s10_accelerator"]
TRIGGER_TYPES = ["funding", "expansion", "grant", "end_of_life", "regulation", "partner_page", "rfq", "fulltime_post",
                 "orphaned", "tradeshow", "crowdfunding", "cohort", "other"]


def research_strategy(slugs: list[str], strategy: str) -> dict:
    """Like research(), but each company names its strategy, a trigger and the facts code needs to judge it."""
    base = research(slugs)
    company = dict(base["properties"]["companies"]["items"])
    props = dict(company["properties"])
    props.update({
        "strategy": {"type": "string", "enum": [strategy]},
        "evidence_date": {"type": "string", "maxLength": 10},
        "trigger": {"type": "string", "maxLength": 200},
        "trigger_type": {"type": "string", "enum": TRIGGER_TYPES},
        "headcount": {"type": "integer", "minimum": 0, "maximum": 1000000},
        "post_age_days": {"type": "integer", "minimum": 0, "maximum": 3650},
    })
    company["properties"] = props
    company["required"] = sorted(set(company["required"]) | set(props))
    items = {**base["properties"]["companies"], "items": company}
    return {**base, "properties": {**base["properties"], "companies": items}}

# ---------------------------------------------------------------- tenders (S1)

ELIGIBILITY_STATUS = ["ok", "flag", "exclude"]


def tender_fit(slugs: list[str]) -> dict:
    """Schema for the tool-less fit call in agents/tenders.py. `slugs` are the offers in catalogue.json."""
    short = {"type": "string", "minLength": 1, "maxLength": 240}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["score", "offer_slug", "reasons", "requirements", "eligibility", "effort", "what_we_need"],
        "properties": {
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "offer_slug": {"type": "string", "enum": list(slugs)},
            "reasons": {"type": "array", "minItems": 1, "maxItems": 5, "items": short},
            "requirements": {"type": "array", "maxItems": 8, "items": short},
            "eligibility": {
                "type": "object",
                "additionalProperties": False,
                "required": ["status", "notes"],
                "properties": {
                    "status": {"type": "string", "enum": ELIGIBILITY_STATUS},
                    "notes": {"type": "array", "maxItems": 6, "items": short},
                },
            },
            "effort": {"type": "string", "minLength": 1, "maxLength": 240},
            "what_we_need": {"type": "array", "maxItems": 8, "items": short},
        },
    }


# ---------------------------------------------------------------- client platform (012): weekly update, referral ask

WEEKLY_UPDATE = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "done", "next", "needs_input", "notes"],
    "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 120},
        "done": {"type": "array", "maxItems": 12, "items": {"type": "string", "minLength": 1, "maxLength": 300}},
        "next": {"type": "array", "maxItems": 8, "items": {"type": "string", "minLength": 1, "maxLength": 300}},
        "needs_input": {"type": "array", "maxItems": 5, "items": {"type": "string", "minLength": 1, "maxLength": 300}},
        "notes": {"type": "string", "maxLength": 400},
    },
}

REFERRAL_ASK = {
    "type": "object",
    "additionalProperties": False,
    "required": ["subject", "body", "notes"],
    "properties": {
        "subject": {"type": "string", "minLength": 1, "maxLength": 120},
        "body": {"type": "string", "minLength": 1, "maxLength": 1500},
        "notes": {"type": "string", "maxLength": 300},
    },
}
