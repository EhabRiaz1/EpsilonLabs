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
