"""JSON schemas for the tool-less model calls. Code validates output against these (core.llm.ask)."""

LABELS = ["inquiry", "opt_out", "auto_reply", "bounce", "injection_suspected"]
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
