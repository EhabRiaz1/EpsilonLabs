"""Code-side eligibility for a Pakistan-registered firm bidding abroad. Runs before any model sees the notice.

`assess(opp)` returns {"status": "ok"|"flag"|"exclude", "notes": [...]}.
  exclude  set-asides (small business, 8(a), SDVOSB, WOSB, HUBZone), security clearance, ITAR/EAR-controlled,
           a hard "must be registered/established in <country>", on-site-only work with no remote component.
  flag     local entity / presence, insurance, WTO GPA access, language other than English. These are bidding
           hurdles (a partner, a cost, a translation), not reasons to hide the notice.
The patterns are deliberately specific: a false exclude hides a tender for good (it is stored as `pass`), so
vague wording ("security" or "local") never excludes on its own.
"""
import re

from core.feeds.base import Opp

R = re.I

EXCLUDE: tuple[tuple[str, re.Pattern], ...] = (
    ("Set-aside for small or disadvantaged US businesses (8(a), SDVOSB, WOSB, HUBZone, small business)",
     re.compile(r"\b8\s?\(a\)|\bSDVOSB\b|\bVOSB\b|\bEDWOSB\b|\bWOSB\b|\bHUB\s?Zone\b|service[- ]disabled veteran"
                r"|women[- ]owned small business|total small business set[- ]aside|small business set[- ]aside"
                r"|set[- ]aside for (?:small|disadvantaged)|reserved for small business", R)),
    ("Security clearance required",
     re.compile(r"security clearance|clearance (?:is |will be )?required|(?:must|shall) (?:hold|have|possess) "
                r"(?:a |an )?(?:valid )?(?:\w+ )?clearance|\bTS/SCI\b|top[- ]secret|facility clearance|\bFCL\b"
                r"|\bNPPV\s?[123]\b|\b(?:SC|DV)[- ]cleared\b|cleared (?:personnel|staff|resources)", R)),
    ("Export-controlled (ITAR / EAR)",
     re.compile(r"\bITAR\b|\bEAR[- ](?:controlled|regulated)|export[- ]controlled|export control(?:led)? (?:data|items?|technology)", R)),
)
# A hard residency rule. Case-sensitive on the country so "must be registered in the portal" prose is not caught,
# and portals / registries every foreign bidder uses (SAM.gov, e-tendering systems) are explicitly not residency.
_REG_HARD = re.compile(r"(?:[Mm]ust|[Ss]hall|need to|required to) (?:be )?(?:legally )?(?:registered|established|incorporated|"
                       r"domiciled|headquartered|based|licensed|resident) (?:and \w+ )?(?:in|within) (?:the )?"
                       r"([A-Z][\w ]{2,30})")
_REG_SOFT = re.compile(r"only (?:locally|nationally)[- ](?:registered|established|owned)|(?:open|restricted) to "
                       r"(?:local|national|domestic) (?:firms|companies|suppliers|vendors|entities|bidders) only|"
                       r"(?:local|national|domestic) (?:firms|companies|suppliers|vendors) only", R)
_PORTAL = re.compile(r"\b(?:SAM|System|Portal|Platform|Register|Registry|Website|Tender|e-?Tender|Procure\w*|Supplier|"
                     r"Vendor|CanadaBuys|MERX|UNGM|Contracts|Public|Bid|Commercial|Government|Gov|Federal)\b")
REG_LABEL = "Must be registered or established in the buyer's country"

ONSITE = re.compile(r"\bon[- ]?site (?:only|presence (?:is )?(?:required|mandatory))|(?:all )?work (?:must be |is to be |will be "
                    r"|shall be )?(?:performed|carried out|delivered|undertaken) (?:entirely |wholly |solely )?on[- ]?site"
                    r"|(?:must|shall|required to) (?:be )?(?:physically )?(?:present|located|based) (?:on[- ]?site|at (?:the )?"
                    r"(?:buyer|client|customer|agency|our)['’]?s? (?:premises|offices?|site|facilit\w+))"
                    r"|no remote (?:work|working|delivery)|remote (?:work|working|delivery|support) (?:is )?not "
                    r"(?:permitted|allowed|accepted|acceptable)|in[- ]person (?:only|delivery only)", R)
REMOTE = re.compile(r"(?<!no )(?<!not )\bremote(?:ly)?\b(?! (?:work|working|delivery|support) (?:is )?not)|\boff[- ]?site\b|"
                    r"\bvirtual(?:ly)?\b|\bhybrid\b|\bwork from home\b", R)

FLAGS: tuple[tuple[str, re.Pattern], ...] = (
    ("Local entity or local presence asked for: needs a local partner or subsidiary",
     re.compile(r"local (?:entity|presence|office|subsidiary|partner|representative|registration|content)|"
                r"(?:registered|established|incorporated) (?:office|company|entity|branch) in|"
                r"preference (?:will be )?given to local", R)),
    ("Insurance required (professional indemnity / liability): get a quote before bidding",
     re.compile(r"professional indemnity|public liability|employer'?s? liability|cyber (?:liability )?insurance|"
                r"errors and omissions|\binsurance (?:cover|coverage|certificate|policy|requirements?)\b|proof of insurance|"
                r"(?:hold|maintain|carry|have) .{0,30}\binsurance\b", R)),
    ("WTO GPA / trade-agreement access: Pakistan is not a GPA party, so we may not be allowed to bid directly",
     re.compile(r"\bGPA\b|Government Procurement Agreement|covered by (?:the )?(?:WTO|trade agreements?)|"
                r"(?:CETA|CPTPP|CFTA)\b.{0,40}(?:suppliers|bidders|only)", R)),
    ("Language: the notice or the bid is not in English",
     re.compile(r"(?:must|shall|to) be (?:submitted |written |drafted |presented )?in (?!English)"
                r"(?:French|German|Spanish|Italian|Portuguese|Dutch|Polish|Swedish|Danish|Finnish|Greek|Czech|"
                r"Hungarian|Romanian|Bulgarian|Croatian|Arabic|Russian|Turkish)", R)),
)


# Per-source eligibility facts for a Pakistan-registered firm.
MEMBER_OPEN = ("worldbank", "adb", "isdb", "aiib", "ungm")   # Pakistan is a member / UN supplier-eligible
MEMBER_HINT = "Open to member-country firms (Pakistan is a member), unless the notice restricts nationality"
NOT_MEMBER = {"ebrd": "EBRD financing is normally limited to firms from member countries and Pakistan is not one: "
                      "check the notice's eligibility clause before spending time",
              "afdb": "AfDB financing is limited to member-country firms and Pakistan is not a member"}
SOURCE_FLAGS = {"samgov": "US federal award needs SAM.gov entity registration (UEI, plus NCAGE for a foreign firm) first"}
NATIONALITY = re.compile(r"national (?:competitive|open) bidding|\bNCB\b|local competitive bidding|"
                         r"(?:eligible|open|restricted) (?:only )?(?:to|for) (?:firms|bidders|companies|suppliers|"
                         r"contractors|consultants) (?:from|of) (?!all\b|any\b|member)|nationals of|"
                         r"only .{0,40}(?:national|citizen)s? (?:of|from)", R)


# Domestic Pakistani tenders (ppra_epms). Epsilon is a Pakistan-registered firm in Lahore, so residency and on-site
# rules do not exclude it there; what does matter are Pakistani registrations, read from the notice text.
DOMESTIC = "PK"
_PEC = re.compile(r"\bPEC\b|Pakistan Engineering Council", R)
_PEC_CAT = re.compile(r"\b(?:PEC|Pakistan Engineering Council)\b[^;\n]{0,80}?\b(?:category|cat\.?)?\s*\(?\b(C-?\s?(?:[1-6]|A|B))\b", R)
_PEC_SPEC = re.compile(r"\b((?:CE|EE|ME|EL|EC)-?\s?\d{1,2})\b")
_FBR = re.compile(r"\bFBR\b|active tax ?payers?|\bATL\b|sales tax registration|\bSTRN\b|\bNTN\b", R)
_OEM = re.compile(r"\bOEM\b.{0,40}?(?:authori[sz]ation|letter|certificate)|manufacturer'?s? authori[sz]ation|"
                  r"authori[sz]ed (?:dealer|distributor|partner|reseller)", R)
PEC_NOTE = "Pakistan Engineering Council contractor registration"


def pk_flags(text: str) -> list[str]:
    """Short eligibility flags for a Pakistani notice, e.g. ["PEC C-6", "PEC specialisation CE-10", "FBR active taxpayer"].
    Code reads them from the buyer's text; ppra_epms stores them in raw["eligibility_flags"]."""
    out: list[str] = []
    pec = _PEC.search(text or "")
    if pec:
        cat = _PEC_CAT.search(text)
        out.append("PEC C-" + re.sub(r"[\s-]", "", cat.group(1))[1:].upper() if cat else "PEC")
        spec = _PEC_SPEC.search(text[pec.start():])
        if spec:
            code = re.sub(r"[\s-]", "", spec.group(1))
            out.append(f"PEC specialisation {code[:2]}-{code[2:]}")
    if _FBR.search(text or ""):
        out.append("FBR active taxpayer")
    if _OEM.search(text or ""):
        out.append("OEM authorisation letter")
    return out


def pk_notes(flags: list[str]) -> list[str]:
    """The founder-facing notes for pk_flags, first in the eligibility notes so the Opportunities list shows them."""
    notes = []
    for f in flags:
        if f.startswith("PEC specialisation"):
            continue
        if f.startswith("PEC"):
            spec = next((x.split()[-1] for x in flags if x.startswith("PEC specialisation")), "")
            cat = f[4:] if f != "PEC" else ""
            notes.append(f"Needs {f} ({PEC_NOTE}" + (f", category {cat} or above" if cat else "")
                         + (f", specialisation {spec}" if spec else "") + ")")
        elif f.startswith("FBR"):
            notes.append("Needs FBR active-taxpayer (ATL) status")
        elif f.startswith("OEM"):
            notes.append("Needs an OEM authorisation letter from the manufacturer")
    return notes


def _text(opp: Opp) -> str:
    raw = opp.raw or {}
    extra = " ".join(str(raw.get(k) or "") for k in ("set_aside", "set_aside_description", "trade_agreements",
                                                     "delivery_regions", "location"))
    return f"{opp.title}\n{opp.summary}\n{extra}"


def assess(opp: Opp) -> dict:
    text = _text(opp)
    domestic = opp.country == DOMESTIC
    excl: list[str] = [label for label, rx in EXCLUDE if rx.search(text)]
    reg = _REG_HARD.search(text)
    if not domestic and ((reg and not _PORTAL.search(reg.group(1))) or _REG_SOFT.search(text)):
        excl.append(REG_LABEL)
    raw_set_aside = str((opp.raw or {}).get("set_aside") or "").strip().upper()
    if raw_set_aside and raw_set_aside not in ("NONE", "N/A") and not any(x.startswith("Set-aside") for x in excl):
        excl.append(f"Set-aside for small or disadvantaged US businesses (SAM.gov code {raw_set_aside})")
    flags = [label for label, rx in FLAGS if rx.search(text) and not (domestic and label == FLAGS[0][0])]
    if domestic:
        raw_flags = (opp.raw or {}).get("eligibility_flags")
        flags = pk_notes(raw_flags if isinstance(raw_flags, list) else pk_flags(text)) + flags
    if opp.raw.get("non_english") and FLAGS[3][0] not in flags:
        flags.append(FLAGS[3][0])
    if ONSITE.search(text) and not domestic:   # on-site in Pakistan is possible for a Lahore firm
        if REMOTE.search(text):
            flags.append("On-site presence is mentioned alongside remote work: confirm how much can be remote")
        else:
            excl.append("On-site only in the buyer's country, no remote component")
    hints: list[str] = []
    if opp.source in MEMBER_OPEN:
        if NATIONALITY.search(text):
            flags.append("Nationality or national-bidding restriction mentioned: confirm a Pakistan firm may bid")
        else:
            hints.append(MEMBER_HINT)
    if opp.source in NOT_MEMBER:
        flags.append(NOT_MEMBER[opp.source])
    if opp.source in SOURCE_FLAGS:
        flags.append(SOURCE_FLAGS[opp.source])
    if excl:
        return {"status": "exclude", "notes": excl + flags}
    return {"status": "flag" if flags else "ok", "notes": flags + hints}


def worst(*statuses: str) -> str:
    order = {"ok": 0, "flag": 1, "exclude": 2}
    return max(statuses, key=lambda s: order.get(s, 0))
