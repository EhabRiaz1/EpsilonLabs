"""Server-rendered HTML. Every dynamic string goes through e(); untrusted mail text is only ever escaped."""
import html
from datetime import datetime

from dashboard import data

e = html.escape
FONTS = ("https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&"
         "family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap")


def tag(text: str, tone: str = "") -> str:
    return f'<span class="tag {tone}">{e(text)}</span>'


def strategy_tag(sid: str) -> str:
    """Small strategy tag on a Pipeline row (empty for deals no prospector strategy made)."""
    if not sid:
        return ""
    t = data.STRATEGY_TAG.get(sid, sid)
    return f' <span class="tag out st" title="{e(t)} strategy: {e(sid)}">{e(t)}</span>'


def kbd(k: str) -> str:
    return f'<span class="kbd" aria-hidden="true">{e(k)}</span>'


def tenders_rail(sh: dict) -> str:
    t = sh.get("tenders")
    if not t:
        return ""
    return (f'<div><h2 class="mono lbl">Tenders</h2><p class="mono sub"><a href="/opportunities">'
            f'{t["new"]} new, {t["worth"]} worth a look</a></p></div>')


def schedule_html(sh: dict) -> str:
    rows = sh.get("schedule") or []
    if not rows:
        return ""
    csrf = sh.get("csrf", "")
    out = ""
    for r in rows:
        btn = ""
        if r["runnable"] and not r["running"] and csrf:
            btn = (f'<form method="post" action="/act/run_job" class="runf"><input type="hidden" name="csrf" value="{e(csrf)}">'
                   f'<input type="hidden" name="job" value="{e(r["job"])}"><input type="hidden" name="next" value="/">'
                   f'<button class="runbtn" title="Run {e(r["label"])} now">Run now</button></form>')
        out += (f'<div class="sch{" on" if r["running"] else ""}"><div class="sch-t"><span class="agn">{e(r["label"])}</span>'
                f'<span class="st">{e(r["cadence"])}</span></div>'
                f'<div class="sch-n"><span class="mono">{e(r["next"]) if not r["running"] else ""}</span>'
                f'<b>{e(r["until"])}</b>{btn}</div></div>')
    return f'<div class="schedule"><h2 class="mono lbl">Schedule · next runs (PKT)</h2>{out}</div>'


def rail_html(sh: dict, compact: bool = False) -> str:
    ag = "".join(f'<div class="ag"><span class="agn">{e(a["name"].capitalize())}</span>'
                 f'<span class="st {a["state"]}">{e(a["text"])}</span></div>' for a in sh["agents"])
    pct = min(100, round(sh["calls"] / max(sh["budget"], 1) * 100))
    tone = "red" if pct >= 100 else ("amber" if pct >= 80 else "")
    cost = f' · ${sh["cost"]:.2f}' if sh["cost"] else ""
    wd = sh["watchdog"]
    return (f'{schedule_html(sh)}'
            f'<div><h2 class="mono lbl">Agents</h2>{ag}</div>'
            f'<div><h2 class="mono lbl">Spend today</h2><div class="bar {tone}" role="meter" aria-valuemin="0" '
            f'aria-valuemax="{sh["budget"]}" aria-valuenow="{sh["calls"]}" aria-label="LLM calls today">'
            f'<i style="width:{pct}%"></i></div>'
            f'<p class="mono sub">{sh["calls"]} of {sh["budget"]} calls{e(cost)}</p></div>'
            f'<div><h2 class="mono lbl">Prospector</h2><p class="mono sub">{sh.get("prospected", 0)} found today</p></div>'
            f'{tenders_rail(sh)}'
            f'<div><h2 class="mono lbl">Watchdog</h2><div class="ag"><span class="agn">Last ping</span>'
            f'<span class="st {wd["state"]}">{e(wd["text"])}</span></div></div>')


ICON = {
    "today": '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
    "deck": '<path d="M4 7h16v13H4z"/><path d="M7 4h10M9 11h6"/>',
    "held": '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M12 8v5M12 16v.5"/>',
    "pipeline": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "health": '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    "agents": '<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>',
    "sliders": '<path d="M4 6h8.6M17.4 6H20M4 12h2.6M11.4 12H20M4 18h10.6M19.4 18H20"/><circle cx="15" cy="6" r="2.2"/><circle cx="9" cy="12" r="2.2"/><circle cx="17" cy="18" r="2.2"/>',
    "site": '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    "briefcase": '<path d="M3 8h18v12H3z"/><path d="M8 8V5h8v3M3 13h18M11 13v2h2v-2"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "theme": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
}


def icon(name: str) -> str:
    return (f'<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[name]}</svg>')


SIDENAV = [(None, "/", "Today", "today"), (None, "/deck", "Deck", "deck"),
           ("Work", "/#held", "Held", "held"), ("Work", "/opportunities", "Opportunities", "briefcase"),
           ("Work", "/pipeline", "Pipeline", "pipeline"),
           ("System", "/agents", "Agents", "agents"), ("System", "/health", "Health", "health"), ("System", "/settings", "Settings", "sliders")]
THEME_BOOT = '<script src="/static/theme.js"></script>'


def page(title: str, body: str, active: str, csrf: str, sh: dict | None, demo: bool = False,
         rail: bool = False, cls: str = "") -> str:
    current = "Deck" if title == "Deck" else active
    nav, section = "", None
    for sec, href, label, ic in SIDENAV:
        if sec != section and sec:
            nav += f'<p class="navsec mono">{e(sec)}</p>'
        section = sec
        badge = ""
        if sh and label == "Deck" and sh["queue"]:
            badge = f'<b aria-label="{sh["queue"]} drafts waiting">{sh["queue"]}</b>'
        on = label == current
        nav += (f'<a href="{href}"{" class=on aria-current=page" if on else ""}>{icon(ic)}'
                f'<span>{e(label)}</span>{badge}</a>')
    if sh:
        tone, text = sh["status"]
        detail = f'<span class="rail-pop">{rail_html(sh)}</span>'
        status = (f'<details class="statuspop"><summary><span class="dot {tone}" aria-hidden="true"></span>'
                  f'<span class="stxt">{e(text)} · {sh["calls"]}/{sh["budget"]} calls</span></summary>{detail}</details>')
    else:
        status = '<div class="statuspop"><span class="dot red" aria-hidden="true"></span>Status unavailable</div>'
    demo_b = '<span class="tag amber demo">DEMO DATA</span>' if demo else ""
    aside = f'<aside class="side" aria-label="Status">{rail_html(sh)}</aside>' if rail and sh else ""
    content = f'<div class="page{" with-rail" if aside else ""}"><main id="main" class="main {cls}">{body}</main>{aside}</div>'
    return (f'<!doctype html><html lang="en" data-theme="studio"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<meta name="csrf" content="{e(csrf)}"><meta name="referrer" content="same-origin">'
            f'<title>{e(title)} · Epsilon OS</title>{THEME_BOOT}'
            f'<link href="{FONTS}" rel="stylesheet"><link rel="stylesheet" href="/static/dashboard.css"></head>'
            f'<body><a class="skip" href="#main">Skip to content</a><div class="shell">'
            f'<aside class="sidebar" id="sidebar" aria-label="Sidebar">'
            f'<div class="sb-head"><a class="brand" href="/"><i aria-hidden="true">ε</i><span>Epsilon Labs</span></a></div>'
            f'<p class="zone mono">Operations</p>'
            f'<nav class="sidenav" aria-label="Primary">{nav}</nav>'
            f'<div class="sb-foot"><span class="me" aria-hidden="true">ER</span><span class="me-t"><b>Ehab Riaz</b>'
            f'<span class="mono">Founder</span></span>'
            f'<button type="button" class="iconbtn" data-theme-toggle aria-label="Switch theme" title="Switch theme">'
            f'{icon("theme")}</button></div></aside>'
            f'<div class="col"><header class="top">'
            f'<button type="button" class="iconbtn menu" data-menu aria-label="Open menu" aria-controls="sidebar">{icon("menu")}</button>'
            f'<p class="toptitle"><span class="crumb">Operations</span><span class="sep">/</span>'
            f'<span>{e(title)}</span></p>{demo_b}'
            f'<div class="topr"><button type="button" class="cmdk" data-cmdk aria-haspopup="dialog">{icon("search")}'
            f'<span>Search</span>{kbd("⌘K")}</button>'
            f'<a class="viewsite mono" href="https://www.epsilon-labs.co" target="_blank" rel="noopener">View site</a>'
            f'<div class="status">{status}</div></div></header>'
            f'{content}</div></div>'
            f'<div id="toasts" class="toasts" role="status" aria-live="polite"></div>'
            f'{shortcuts_sheet()}{palette()}'
            f'<script src="/static/dashboard.js" defer></script></body></html>')


def shortcuts_sheet() -> str:
    rows = [("Enter", "Start the deck"), ("A", "Approve and send (press twice if lint is red)"),
            ("E", "Edit in place (Cmd/Ctrl+Enter sends, Esc cancels)"), ("R", "Reject (reason optional)"),
            ("L", "Later: move to the end"), ("U", "Undo last send, within 10 seconds"),
            ("J / K", "Previous / next card"), ("Esc", "Back to Today"), ("?", "This sheet")]
    li = "".join(f"<tr><th scope=row>{kbd(k)}</th><td>{e(v)}</td></tr>" for k, v in rows)
    return (f'<dialog id="sheet" aria-labelledby="sheet-t"><h2 id="sheet-t">Keyboard shortcuts</h2>'
            f'<table>{li}</table><form method="dialog"><button class="btn">Close</button></form></dialog>')


def palette() -> str:
    items = [("/", "Today", "G T"), ("/deck", "Start the deck", "↵"), ("/opportunities", "Opportunities", ""), ("/pipeline", "Pipeline", "G P"),
             ("/agents", "Agents", "G A"), ("/health", "Health", "G H"), ("/settings", "Settings", "G S"), ("/#held", "Held tray", ""), ("?", "Keyboard shortcuts", "?")]
    li = "".join(f'<li role="option" data-href="{e(h)}" tabindex="-1"><span>{e(t)}</span>{kbd(k) if k else ""}</li>'
                 for h, t, k in items)
    return (f'<dialog id="palette" class="palette" aria-label="Jump to"><input id="pal-q" type="text" '
            f'placeholder="Jump to a screen…" autocomplete="off" aria-label="Search screens">'
            f'<ul role="listbox" id="pal-list">{li}</ul></dialog>')


def error_state(csrf: str, msg: str = "Can't reach the database.", sh=None, demo=False, active="Today") -> str:
    body = (f'<section class="state err" role="alert"><h1>{e(msg)}</h1>'
            f'<p>Nothing was changed. Check your network and that the Supabase key is in the keychain.</p>'
            f'<p><a class="btn pri" href="">Retry</a></p></section>')
    return page("Error", body, active, csrf, sh, demo)


def message_page(csrf: str, title: str, msg: str, back: str = "/", sh=None, demo=False) -> str:
    body = (f'<section class="state err" role="alert"><h1>{e(title)}</h1><p>{e(msg)}</p>'
            f'<p><a class="btn" href="{e(back)}">Back</a></p></section>')
    return page(title, body, "Today", csrf, sh, demo)


# ------------------------------------------------------------------ Today

def _form(csrf: str, act: str, qid: str, label: str, cls: str = "", nxt: str = "/", extra: str = "") -> str:
    return (f'<form method="post" action="/act/{act}" class="inl"><input type="hidden" name="csrf" value="{e(csrf)}">'
            f'<input type="hidden" name="id" value="{e(qid)}"><input type="hidden" name="next" value="{e(nxt)}">'
            f'{extra}<button class="btn {cls}">{e(label)}</button></form>')


def card_tags(c: dict, lint: bool = True) -> str:
    out = [tag(c["kind_label"], {"reply": "sig", "quote": "sig", "outbound": "out"}.get(c["kind"], ""))]
    if c.get("step"):
        out.append(tag(f"Follow-up {c['step']} of 3", "cu"))
    if c["wedge"]:
        out.append(tag(c["wedge"], "cu"))
    if c["channel"] == "referral":
        out.append(tag("REFERRAL", "cu"))
    if c["late"]:
        out.append(tag(f"LATE {c['late_age']}", "amber"))
    if lint and c["lint"]:
        out.append(tag(f"LINT · {len(c['lint'])}", "red"))
    return "".join(out)


def today(csrf: str, now: datetime, sh: dict, k: dict, deck: list, held: list, trouble: list,
          last_sent: str | None, demo: bool) -> str:
    n, h = len(deck), len(held)
    if n:
        state = f"{n} draft{'s need' if n != 1 else ' needs'} you."
        if h:
            state += f" {h} {'is' if h == 1 else 'are'} held."
    elif h:
        state = f"Nothing in the deck. {h} held for your review."
    else:
        state = "Inbox zero. Nothing needs you."
    start = (f'<a class="btn pri start" href="/deck" id="start">Start {kbd("↵")}</a>' if n else "")
    empty_extra = ""
    if not n:
        ls = f"Last sent {last_sent} ago. " if last_sent else ""
        empty_extra = f'<p class="muted">{e(ls)}<a href="/pipeline">Open pipeline</a></p>'
    pct = "—" if k["interested_pct"] is None else f"{k['interested_pct']:.1f}%"
    pct_sub = f"of {k['sent']} sent" if k["sent"] else "no sends in 30d"
    meter = min(100, round(float(k.get("won_q4") or 0) / 100000 * 100))
    kp = (
        f'<div class="kpi"><span class="mono">Conversations · 30d</span><b data-count>{k["conversations"]}</b>'
        f'<small>+{k["conv_week"]} this week</small></div>'
        f'<div class="kpi"><span class="mono">Quotes out</span><b data-count>{k["quotes"]}</b>'
        f'<small>{e(data.money(k["quotes_value"]))} value</small></div>'
        f'<div class="kpi"><span class="mono">Won since 1 Oct</span><b data-count>{e(data.money(k.get("won_q4") or 0))}</b>'
        f'<small>target $100k by 31 Dec</small><span class="kmeter" role="meter" aria-label="Won vs $100k target" '
        f'aria-valuemin="0" aria-valuemax="100" aria-valuenow="{meter}"><i style="width:{meter}%"></i></span></div>'
        f'<div class="kpi"><span class="mono">Interested replies</span><b data-count>{pct}</b><small>{pct_sub}</small></div>')
    items = "".join(
        f'<li><a class="item" href="/deck?id={e(c["id"])}">'
        f'<span class="avs k-{e(c["kind"])}" aria-hidden="true">{e(data.initials(c["who"]))}</span>'
        f'<span class="it-main"><span class="it-who"><b>{e(c["who"])}</b>'
        f'{"<span class=co>" + e(c["company"]) + "</span>" if c["company"] else ""}</span>'
        f'<span class="sub">{e(c["subject"])}</span></span>'
        f'<span class="it-tags">{card_tags(c)}</span><span class="t">{e(c["age"])}</span>'
        f'<span class="go" aria-hidden="true">→</span></a></li>'
        for c in deck)
    needs = (f'<section aria-labelledby="needs"><h2 id="needs" class="mono lbl">Needs you</h2>'
             f'<ul class="list">{items}</ul></section>') if deck else ""
    held_html = ""
    if held:
        rows = ""
        for c in held:
            prev = " ".join(c["draft"].split())[:220] + ("…" if len(c["draft"]) > 220 else "")
            rows += (
                f'<li class="heldrow"><div class="hd"><b>{e(c["who"])}</b> {tag("HELD", "red")} '
                f'<span class="sub">{e(c["subject"])}</span>'
                f'<p class="heldwhy">Why held: {e(c["held_reason"] or "flagged")}</p>'
                f'<p class="peek">{e(prev)}</p></div><div class="acts">'
                f'{_form(csrf, "release", c["id"], "Release to deck")}'
                f'{_form(csrf, "reject", c["id"], "Reject")}'
                f'{_form(csrf, "suppress", c["id"], "Suppress sender", "danger")}</div></li>')
        held_html = (f'<section class="held" id="held" aria-labelledby="held-h"><h2 id="held-h" class="mono lbl red">'
                     f'Held · {h}</h2><ul class="list">{rows}</ul></section>')
    trouble_html = ""
    if trouble:
        rows = ""
        for c in trouble:
            if c.get("verify"):
                note = (f'{tag("UNSURE IF SENT", "amber")} <span class="sub">The outbox could not confirm this '
                        f'went out. It checks the Sent folder every minute; if it is there, mark it sent.</span>')
                acts = (_form(csrf, "mark_sent", c["id"], "Mark sent") +
                        _form(csrf, "retry", c["id"], "Resend", "",
                              extra='<label class="ck"><input type="checkbox" name="confirm" value="1" required> '
                                    'I checked Sent</label>'))
            else:
                note = f'{tag("NOT SENT", "red")} <span class="sub err">{e(c["send_error"] or "unknown error")}</span>'
                acts = _form(csrf, "retry", c["id"], "Retry")
            rows += (f'<li class="heldrow"><div class="hd"><b>{e(c["who"])}</b> {note}'
                     f'<span class="sub">To {e(c["to"])} · {e(c["thread"])}</span></div>'
                     f'<div class="acts">{acts}</div></li>')
        trouble_html = (f'<section class="held amberedge" aria-labelledby="fv-h"><h2 id="fv-h" class="mono lbl amber">'
                        f'Failed / Verify · {len(trouble)}</h2><ul class="list">{rows}</ul></section>')
    body = (f'<section class="hello" aria-labelledby="hi"><p class="mono dateline">{e(now.astimezone(data.PKT).strftime("%A %d %B · %H:%M"))} PKT</p>'
            f'<h1 id="hi">{e(data.greeting(now))}</h1>'
            f'<p class="state-line">{e(state)}</p>{empty_extra}{start}</section>'
            f'<section class="kpis" aria-label="Last 30 days">{kp}</section>'
            f'{needs}{held_html}{trouble_html}')
    return page("Today", body, "Today", csrf, sh, demo, rail=True, cls="today")


# ------------------------------------------------------------------ Deck

OUTREACH_WAIT = "Will send once the outreach domain is live"


def deck_card(c: dict, outreach_ready: bool = True) -> str:
    lint_html = ""
    if c["lint"]:
        li = "".join(f'<li>{e(h["type"])}: <code>{e(h["text"])}</code></li>' for h in c["lint"])
        lint_html = (f'<div class="lintbar" role="alert"><b>Lint warnings. Check before sending.</b><ul>{li}</ul>'
                     f'<span class="armnote">Press A again to send anyway.</span></div>')
    missing = not c["draft"].strip()
    late = (f'<p class="latenote">{tag("LATE " + c["late_age"], "amber")} The ack was not sent in time, '
            f'consider rewording.</p>') if c["late"] else ""
    ctx = f'{e(c["subject"])} · arrived {e(c["age"])} ago' if c["subject"] else f'arrived {e(c["age"])} ago'
    wrote = e(c["they_wrote"]) if c["they_wrote"] else '<span class="muted">No inbound text on record.</span>'
    ours = bool(c.get("ours")) and not c["they_wrote"]
    if ours:  # a follow-up has no inbound text; show our own earlier email, labelled as ours (not untrusted)
        wrote = e(c["ours"])
    col_head = ("Our previous email" if ours else
                "Why them · from the web, untrusted" if c["kind"] == "outbound" else "They wrote · untrusted")
    wait = f'<span class="waitnote">{e(OUTREACH_WAIT)}</span>' if c["kind"] == "outbound" and not outreach_ready else ""
    lint_meta = f'{len(c["lint"])} warning{"s" if len(c["lint"]) != 1 else ""}' if c["lint"] else "clean"
    return (
        f'<article class="card" data-id="{e(c["id"])}" data-lint="{len(c["lint"])}" data-missing="{int(missing)}" '
        f'role="region" aria-labelledby="t-{e(c["id"])}" hidden>'
        f'<div class="who"><div class="av" aria-hidden="true">{e(data.initials(c["who"]))}</div><div>'
        f'<h2 id="t-{e(c["id"])}" tabindex="-1">{e(c["who"])}{", " + e(c["company"]) if c["company"] else ""}</h2>'
        f'<p>{ctx}</p></div><div class="tags">{card_tags(c, lint=False)}</div></div>'
        f'{late}{lint_html}'
        f'<div class="cols"><div><h3 class="mono lbl">{col_head}</h3>'
        f'<div class="{"ours" if ours else "untrusted"}">{wrote}</div></div>'
        f'<div><h3 class="mono lbl">You\'ll send</h3>'
        f'<div class="draft" data-draft>{e(c["draft"])}</div>'
        f'<p class="editnote" hidden></p></div></div>'
        f'<div class="why"><span>Classifier: {e(c["classifier"])}</span><span>Lint: {e(lint_meta)}</span>'
        f'<span>To: {e(c["to"] or "—")}</span><span>Thread: {e(c["thread"] or "—")}</span>{wait}</div>'
        f'<p class="cardmsg err" role="alert" hidden></p>'
        f'<div class="reasonrow" hidden><label for="rr-{e(c["id"])}" class="mono">Reason (optional)</label>'
        f'<input id="rr-{e(c["id"])}" class="reason" maxlength="300" autocomplete="off">'
        f'<button class="btn" data-act="reject-confirm">Reject</button>'
        f'<button class="btn ghost" data-act="reject-cancel">Cancel</button></div>'
        f'</article>')


def deck(csrf: str, sh: dict, cards: list, counts: dict, demo: bool, outreach_ready: bool = True) -> str:
    pips = "".join('<span class="pip"></span>' for _ in cards)
    body = (
        f'<div class="stage" id="deck" data-sent="{counts["sent"]}" data-rejected="{counts["rejected"]}">'
        f'<div class="progress"><div class="strip" aria-hidden="true">{pips}</div>'
        f'<span class="mono cnt" id="count" aria-live="polite"></span></div>'
        f'<div class="deckwrap"><div class="stack" aria-hidden="true"></div>'
        f'{"".join(deck_card(c, outreach_ready) for c in cards)}'
        f'<section class="card clear" id="clear" role="region" aria-labelledby="clear-t" hidden>'
        f'<div class="check" aria-hidden="true">✓</div><h2 id="clear-t" tabindex="-1">All clear.</h2>'
        f'<p id="clear-counts" class="muted"></p>'
        f'<p><a class="btn pri" href="/">Back to Today {kbd("Esc")}</a></p></section></div>'
        f'<div class="acts actrow" id="actbar">'
        f'<button class="btn" data-act="reject">Reject {kbd("R")}</button>'
        f'<button class="btn" data-act="edit">Edit {kbd("E")}</button>'
        f'<button class="btn pri big" data-act="approve">Approve &amp; send {kbd("A")}</button>'
        f'<button class="btn" data-act="later">Later {kbd("L")}</button>'
        f'<button class="btn ghost" data-act="sheet" aria-label="Keyboard shortcuts">{kbd("?")}</button></div>'
        f'<div class="editacts acts actrow" id="editbar" hidden>'
        f'<button class="btn ghost" data-act="edit-cancel">Cancel {kbd("Esc")}</button>'
        f'<button class="btn pri big" data-act="edit-send">Send edited {kbd("⌘↵")}</button></div>'
        f'</div>')
    return page("Deck", body, "Today", csrf, sh, demo, cls="deckpage")


# ------------------------------------------------------------------ Pipeline

def pipeline(csrf: str, sh: dict, p: dict, channel: str | None, panel: str, demo: bool) -> str:
    chips = [f'<a class="chip{" on" if not channel else ""}" href="/pipeline">All</a>'] + [
        f'<a class="chip{" on" if channel == c else ""}" href="/pipeline?channel={c}">{e(c.replace("_", "-"))}</a>'
        for c in data.CHANNELS]
    if not p["total"]:
        msg = ("No deals in this channel." if channel else
               "No deals yet. They appear when inbox or prospector creates one.")
        body = (f'<h1 class="pt">Pipeline</h1><div class="chips" role="group" aria-label="Filter by channel">'
                f'{"".join(chips)}</div><section class="state"><p>{e(msg)}</p></section>')
        return page("Pipeline", body, "Pipeline", csrf, sh, demo)
    live = [(key, label, len(p["groups"][key])) for key, label in data.STAGES if key != "dormant"]
    funnel = "".join(
        f'<div class="seg s-{e(key)}" style="flex-grow:{max(n, 0.35)}" title="{e(label)}: {n}">'
        f'<span class="mono">{e(label)}</span><b>{n}</b></div>' for key, label, n in live)
    funnel_html = (f'<div class="funnel" role="img" aria-label="Deals by stage: '
                   f'{e(", ".join(f"{l} {n}" for _, l, n in live))}">{funnel}</div>')
    secs = ""
    for key, label in data.STAGES:
        rows = p["groups"][key]
        if not rows and key == "dormant":
            continue
        trs = "".join(
            f'<tr tabindex="0" data-deal="{e(r["id"])}"><td><a href="/pipeline?deal={e(r["id"])}'
            f'{"&channel=" + e(channel) if channel else ""}">{e(r["company"])}</a>'
            f'<span class="sub">{e(r["title"])}</span></td><td><span class="tag ch-{e(r["channel"])}">{e(r["channel"].replace("_", "-").upper())}</span>{strategy_tag(r["strategy"])}</td>'
            f'<td class="num">{e("$" + format(float(r["value"]), ",.0f")) if r["value"] else "—"}</td>'
            f'<td class="num"><span class="days {r["tone"]}">{r["days"]}d</span>'
            f'{" " + tag("STALLED", "red") if r["tone"] == "red" else (" " + tag("SLOW", "amber") if r["tone"] else "")}</td>'
            f'<td class="next">{e(r["next"] or "—")}</td></tr>' for r in rows)
        table = (f'<table class="grid"><thead><tr><th scope="col">Company</th><th scope="col">Channel</th>'
                 f'<th scope="col" class="num">Value</th><th scope="col" class="num">In stage</th>'
                 f'<th scope="col">Next step</th></tr></thead><tbody>{trs}</tbody></table>') if rows else \
            '<p class="muted empty">None.</p>'
        head = f'<span class="mono lbl">{e(label)} · {len(rows)}</span>'
        if key == "dormant":
            secs += f'<details class="stage-g"><summary>{head}</summary>{table}</details>'
        else:
            secs += f'<section class="stage-g" aria-label="{e(label)}">{head}{table}</section>'
    body = (f'<p class="eyebrow mono">Operations</p><div class="pt-row"><h1 class="pt">Pipeline</h1><span class="mono">{p["total"]} deals</span></div>'
            f'{funnel_html}<div class="chips" role="group" aria-label="Filter by channel">'
            f'{"".join(chips)}</div>{secs}')
    panel_html = f'<aside id="panel" class="panel" aria-label="Deal details"{"" if panel else " hidden"}>{panel}</aside>'
    return page("Pipeline", f'<div class="pipe">{body}</div>{panel_html}', "Pipeline", csrf, sh, demo, cls="pipepage")


def deal_panel(pnl: dict) -> str:
    d, co = pnl["deal"], pnl["company"]
    cs = "".join(f'<li><b>{e(c.get("full_name") or c.get("email") or "—")}</b>'
                 f'{" " + tag("OPTED OUT", "red") if c.get("opted_out") else ""}'
                 f'<span class="sub">{e(c.get("role") or "")} {e(c.get("email") or "")}</span></li>'
                 for c in pnl["contacts"]) or '<li class="muted">No contacts.</li>'
    ts = "".join(
        f'<li><span class="mono">{e(t["age"])} · {e(t["type"])} · {e(t["direction"])}</span>'
        f'<b>{e(t.get("subject") or "(no subject)")}</b>'
        + (f'<div class="untrusted small">{e(t["body_excerpt"][:400])}</div>' if t.get("body_excerpt") else "")
        + "</li>" for t in pnl["touches"]) or '<li class="muted">No touches yet.</li>'
    val = f'${float(d["value_usd"]):,.0f}' if d.get("value_usd") else "no value yet"
    return (f'<div class="phead"><h2>{e(co.get("name") or d["title"])}</h2>'
            f'<a class="btn ghost" href="/pipeline" data-close aria-label="Close panel">Close {kbd("Esc")}</a></div>'
            f'<p class="sub">{e(d["title"])} · {tag(d["stage"].replace("_", " ").upper(), "cu")} · {e(val)}</p>'
            f'<h3 class="mono lbl">Contacts</h3><ul class="plain">{cs}</ul>'
            f'<h3 class="mono lbl">Last {len(pnl["touches"])} touches · inbound text is untrusted</h3>'
            f'<ul class="plain touches">{ts}</ul>')


# ------------------------------------------------------------------ Health

def health(csrf: str, sh: dict, h: dict, demo: bool) -> str:
    mx = max([n for _, n in h["llm"]] + [1])
    last = len(h["llm"]) - 1
    bars = "".join(
        f'<li{" class=today" if i == last else ""} title="{e(d.strftime("%a %d %b"))}: {n} calls">'
        f'<span class="v mono">{n}</span><i class="b" style="height:{max(round(n / mx * 100), 2 if n else 0)}%"></i>'
        f'<span class="d mono">{d.strftime("%d")}</span></li>' for i, (d, n) in enumerate(h["llm"]))
    runs = ""
    for agent, rows in h["runs"].items():
        trs = "".join(
            f'<tr><td class="mono">{e(r["age"])} ago</td><td>{tag(r["status"].upper(), {"error": "red", "warn": "amber"}.get(r["status"], "sig"))}</td>'
            f'<td>{e(r["counts"]) or "—"}</td><td class="err">{e(r["err"])}</td></tr>' for r in rows) or \
            '<tr><td colspan="4" class="muted">No runs recorded.</td></tr>'
        runs += (f'<details class="agent" {"open" if rows else ""}>'
                 f'<summary><b>{e(agent.capitalize())}</b> <span class="mono">{len(rows)} run{"" if len(rows) == 1 else "s"}</span></summary>'
                 f'<table class="grid"><thead><tr><th scope="col">When</th><th scope="col">Status</th>'
                 f'<th scope="col">Counts</th><th scope="col">Error</th></tr></thead><tbody>{trs}</tbody></table></details>')
    acts = "".join(
        f'<tr><td class="mono">{e(a["age"])} ago</td><td>{e(a["agent"])}</td><td>{e(a["action"])}</td>'
        f'<td class="mono sm">{e((a.get("target_id") or "")[:8])}</td></tr>' for a in h["actions"]) or \
        '<tr><td colspan="4" class="muted">No actions yet.</td></tr>'
    rt = h["restore_tested"] or "not recorded"
    strategies = strategies_section(h["strategies"])
    body = (f'<p class="eyebrow mono">System</p><h1 class="pt">Health</h1><p class="muted">Backup last restore test: {e(str(rt))}</p>'
            f'<section aria-labelledby="llm"><h2 id="llm" class="mono lbl">LLM calls per day · 14d</h2>'
            f'<ul class="bars" aria-label="LLM calls per day">{bars}</ul></section>'
            f'{strategies}'
            f'<section aria-labelledby="runs"><h2 id="runs" class="mono lbl">Agent runs · last 20 each</h2>{runs}</section>'
            f'<section aria-labelledby="acts"><h2 id="acts" class="mono lbl">Last 50 actions</h2>'
            f'<table class="grid"><thead><tr><th scope="col">When</th><th scope="col">Agent</th>'
            f'<th scope="col">Action</th><th scope="col">Target</th></tr></thead><tbody>{acts}</tbody></table></section>')
    return page("Health", body, "Health", csrf, sh, demo, cls="healthpage")


def _pct(v) -> str:
    return "—" if v is None else f"{v * 100:.0f}%"


def strategies_section(b: dict) -> str:
    trs = "".join(
        f'<tr><td><b>{e(r["name"])}</b> <span class="mono sub-tag">{e(r["tag"])}</span></td>'
        f'<td class="num">{e(str(r["quota"])) if r["quota"] is not None else "—"}{" " + tag("PINNED", "out") if r["pinned"] else ""}</td>'
        f'<td class="num">{r["created"]}</td><td class="num">{r["sent"]}</td><td class="num">{r["replies"]}</td>'
        f'<td class="num">{r["positive"]}</td><td class="num">{_pct(r["reply_rate"])}</td>'
        f'<td class="num">{_pct(r["positive_rate"])}</td><td class="num">{e(data.money(r["won_value"])) if r["won_value"] else "—"}</td></tr>'
        for r in b["rows"])
    return (f'<section aria-labelledby="strat" class="strat"><h2 id="strat" class="mono lbl">Strategies · last 30 days</h2>'
            f'<table class="grid"><thead><tr><th scope="col">Strategy</th><th scope="col" class="num">Quota / day</th>'
            f'<th scope="col" class="num">Created</th><th scope="col" class="num">Sent</th><th scope="col" class="num">Replies</th>'
            f'<th scope="col" class="num">Positive</th><th scope="col" class="num">Reply %</th>'
            f'<th scope="col" class="num">Positive %</th><th scope="col" class="num">Won</th></tr></thead>'
            f'<tbody>{trs}</tbody></table><p class="hint strat-note">{e(b["note"])}</p></section>')


def strategies_fieldset(v: dict, errors: dict) -> str:
    from agents import prospector
    from core import settings as cfg
    draft = v.get("strategy_draft")
    on = ("1", "on", "true")
    auto = (draft.get("auto_rebalance") in on) if draft else v["auto_rebalance"]
    rows = ""
    for sid in cfg.STRATEGY_IDS:
        q = draft.get(f"quota_{sid}", "") if draft else v["quotas"].get(sid, 0)
        pin = (draft.get(f"pin_{sid}") in on) if draft else sid in v["pinned"]
        err = errors.get(f"quota_{sid}")
        ref = "h-quotas" + (f" e-quota_{sid}" if err else "")
        msg = f'<p class="fielderr" id="e-quota_{sid}" role="alert">{e(err)}</p>' if err else ""
        rows += (f'<div class="qrow{" bad" if err else ""}"><label for="f-quota_{sid}" class="flab">{e(cfg.STRATEGY_LABEL[sid])}</label>'
                 f'<input class="inp num" id="f-quota_{sid}" name="quota_{sid}" type="number" inputmode="numeric" min="0" max="50" step="1" '
                 f'value="{e(str(q))}" aria-describedby="{ref}"{" aria-invalid=true" if err else ""}>'
                 f'<label class="ck pick" for="f-pin_{sid}"><input type="checkbox" id="f-pin_{sid}" name="pin_{sid}" value="1"'
                 f'{" checked" if pin else ""}> Pin</label>{msg}</div>')
    total_err = errors.get("quotas")
    try:
        total = sum(int(str(draft.get(f"quota_{s}", 0)).strip() or 0) for s in cfg.STRATEGY_IDS) if draft else sum(v["quotas"].values())
    except ValueError:
        total = sum(v["quotas"].values())
    tmsg = f'<p class="fielderr" role="alert">{e(total_err)}</p>' if total_err else ""
    mk_err = errors.get("markets")
    mk_val = draft.get("markets", "") if draft and "markets" in draft else ", ".join(v["markets"])
    mk_msg = f'<p class="fielderr" id="e-markets" role="alert">{e(mk_err)}</p>' if mk_err else ""
    markets = (f'<div class="field mkt{" bad" if mk_err else ""}"><label for="f-markets" class="flab">Markets to hunt in</label>'
               f'<input class="inp" id="f-markets" name="markets" type="text" value="{e(mk_val)}" autocomplete="off" '
               f'aria-describedby="h-markets{" e-markets" if mk_err else ""}"{" aria-invalid=true" if mk_err else ""}>'
               f'<p class="hint" id="h-markets">Two-letter country codes, comma separated: where a client can pay a Pakistan firm and budgets reach $10k+. '
               f'Pakistan and sanctioned markets (IR, KP, SY, CU, RU, BY) are always left out.</p>{mk_msg}</div>')
    return (f'<fieldset class="setcard wide strat-set" aria-describedby="h-quotas"><legend class="mono lbl">Strategies</legend>'
            f'<div class="quotas{" bad" if total_err else ""}">{rows}</div>'
            f'<p class="hint" id="h-quotas">Prospects to find per day for each strategy, 0 to switch one off. Pin keeps a quota fixed when it rebalances. '
            f'The total (now {total}) cannot be more than Prospects per day.</p>{tmsg}'
            f'<label class="ck pick" for="f-auto_rebalance"><input type="checkbox" id="f-auto_rebalance" name="auto_rebalance" value="1"'
            f'{" checked" if auto else ""}> Rebalance quotas automatically</label>'
            f'<p class="hint">Mondays, once a strategy has {prospector.MIN_SENDS} sends in 30 days: up to {prospector.REBALANCE_STEP} quota a week moves '
            f'toward the best positive-reply rate. No strategy goes below {prospector.REBALANCE_FLOOR}.</p>{markets}</fieldset>')


# ------------------------------------------------------------------ Settings

def _field(name: str, label: str, hint: str, control: str, errors: dict) -> str:
    err = errors.get(name)
    msg = f'<p class="fielderr" id="e-{name}" role="alert">{e(err)}</p>' if err else ""
    return (f'<div class="field{" bad" if err else ""}"><label for="f-{name}" class="flab">{e(label)}</label>'
            f'{control}<p class="hint" id="h-{name}">{e(hint)}</p>{msg}</div>')


def _num(name: str, val, lo: int, hi: int, errors: dict) -> str:
    ref = f"h-{name}" + (f" e-{name}" if errors.get(name) else "")
    return (f'<input class="inp num" id="f-{name}" name="{name}" type="number" inputmode="numeric" min="{lo}" max="{hi}" '
            f'step="1" value="{e(str(val))}" aria-describedby="{ref}"{" aria-invalid=true" if errors.get(name) else ""}>')


def settings_page(csrf: str, sh: dict, v: dict, errors: dict, saved: bool, demo: bool) -> str:
    from core import settings as cfg
    o = v["outreach"]
    seg_err = errors.get("segments")
    boxes = "".join(
        f'<label class="ck pick"><input type="checkbox" name="segments" value="{e(k)}"'
        f'{" checked" if k in v["segments"] else ""}> {e(cfg.SEGMENT_LABEL[k])}</label>' for k in cfg.SEGMENTS)
    segments = (f'<div class="field{" bad" if seg_err else ""}"><span class="flab" id="l-seg">Segments to hunt</span>'
                f'<div class="picks" role="group" aria-labelledby="l-seg">{boxes}</div>'
                f'<p class="hint">Each morning leads with the next segment in turn and tops up from the rest.</p>'
                f'{f"<p class=fielderr role=alert>{e(seg_err)}</p>" if seg_err else ""}</div>')
    paused = (f'<div class="field"><label class="ck pick" for="f-paused"><input type="checkbox" id="f-paused" name="paused" '
              f'value="1"{" checked" if v["paused"] else ""}> Pause the prospector</label>'
              f'<p class="hint">Stops new research and drafts. Approved sends and replies keep working.</p></div>')
    if v["address"]:
        addr_ctl = (f'<input class="inp" id="f-address" name="address" type="text" value="{e(v["address"])}" readonly '
                    f'aria-describedby="h-address">')
        addr_hint = "Set. Outreach mail is sent from and read in this mailbox. Its password is in the keychain."
    else:
        addr_ctl = (f'<input class="inp" id="f-address" name="address" type="email" autocomplete="off" '
                    f'placeholder="ehab@yourdomain.example" value="{e(v.get("address_draft", ""))}" aria-describedby="h-address">')
        addr_hint = "Leave empty until the outreach domain and mailbox exist. Then add keychain service epsilon-os-outreach."
    state = "Yes" if o["configured"] else "No"
    why = "" if o["configured"] else f'<small>{e(o["reason"])}</small>'
    kp = (f'<div class="kpi"><span class="mono">Configured</span><b>{state}</b>{why or "<small>sending live</small>"}</div>'
          f'<div class="kpi"><span class="mono">Today\'s cap</span><b>{o["cap"]}</b>'
          f'<small>ramp {o["ramp_cap"]} · setting {o["setting_cap"]}</small></div>'
          f'<div class="kpi"><span class="mono">Sent today</span><b>{o["sent_today"]}</b>'
          f'<small>{"warm-up since " + o["started_on"].isoformat() if o["started_on"] else "warm-up not started"}</small></div>')
    note = ""
    if saved:
        note = '<p class="savednote" role="status">Saved. Agents pick this up on their next run.</p>'
    elif errors:
        note = '<p class="fielderr banner" role="alert">Nothing was saved. Fix the fields marked below.</p>'
    form = (
        f'<form method="post" action="/act/settings" class="setform" novalidate>'
        f'<input type="hidden" name="csrf" value="{e(csrf)}"><input type="hidden" name="next" value="/settings?saved=1">'
        f'<div class="setgrid">'
        f'<section class="setcard" aria-labelledby="s-pro"><h2 id="s-pro" class="mono lbl">Prospector</h2>'
        f'{_field("per_day", "Prospects per day", "New companies researched each morning, 0 to 80.", _num("per_day", v["per_day"], 0, 80, errors), errors)}'
        f'{segments}{paused}'
        f'<p class="mono sub">{v["prospected"]} found today</p></section>'
        f'<section class="setcard" aria-labelledby="s-llm"><h2 id="s-llm" class="mono lbl">LLM budget</h2>'
        f'{_field("daily_budget", "Daily call budget", "Calls across all agents, 50 to 1000. About two calls per prospect plus research.", _num("daily_budget", v["daily_budget"], 50, 1000, errors), errors)}'
        f'<p class="mono sub">{v["calls"]} used today</p></section>'
        f'<section class="setcard" aria-labelledby="s-out"><h2 id="s-out" class="mono lbl">Outreach</h2>'
        f'{_field("daily_cap", "Daily send cap", "Ceiling, 0 to 100. The warm-up ramp (5/day, +5 every 3 days) applies below it.", _num("daily_cap", v["daily_cap"], 0, 100, errors), errors)}'
        f'{_field("address", "Outreach address", addr_hint, addr_ctl, errors)}</section>'
        f'{strategies_fieldset(v, errors)}'
        f'{tenders_card(v["tenders"], errors) if v.get("tenders") else ""}'
        f'</div>'
        f'<div class="setacts"><button class="btn pri" type="submit">Save settings</button>'
        f'<a class="btn ghost" href="/settings">Reset</a></div></form>')
    body = (f'<p class="eyebrow mono">System</p><div class="pt-row"><h1 class="pt">Settings</h1></div>{note}'
            f'{form}'
            f'<section aria-labelledby="s-st"><h2 id="s-st" class="mono lbl">Outreach status</h2>'
            f'<div class="kpis three">{kp}</div></section>')
    return page("Settings", body, "Settings", csrf, sh, demo, cls="settingspage")


# ------------------------------------------------------------------ Opportunities (S1 tenders)

def _opp_rows(cards: list, with_status: bool = False) -> str:
    out = ""
    for c in cards:
        tier = "hi" if c["score"] >= data.WORTH_A_LOOK else ("mid" if c["score"] >= data.LOW_FIT else "lo")
        note = c["elig_notes"][0] if c["elig_notes"] else "No eligibility issues found by the rules"
        where = " · ".join(x for x in (c["buyer"], c["country"], c["source"]) if x)
        status = f' {tag(c["status"].upper(), "cu")}' if with_status else ""
        out += (
            f'<tr><td class="num"><span class="fit {tier}" aria-label="Fit score {c["score"]} of 100">{c["score"]}</span></td>'
            f'<td><a href="/opportunities?id={e(c["id"])}">{e(c["title"])}</a>{status}'
            f'<span class="sub">{e(where)}</span></td>'
            f'<td>{e(c["offer"]) or "—"}</td><td class="num">{e(c["value"])}</td>'
            f'<td class="num"><span class="days {c["deadline_tone"]}">{e(c["deadline"])}</span></td>'
            f'<td><span class="tag {c["badge_tone"]}">{e(c["badge"])}</span>'
            f'<span class="sub oppnote">{e(note)}</span></td></tr>')
    return out


def _opp_table(label: str, cards: list, with_status: bool = False, fold: bool = False) -> str:
    if not cards:
        return ""
    head = (f'<tr><th scope="col" class="num">Fit</th><th scope="col">Opportunity</th><th scope="col">Offer</th>'
            f'<th scope="col" class="num">Value</th><th scope="col" class="num">Deadline</th>'
            f'<th scope="col">Eligibility</th></tr>')
    table = (f'<div class="oppcard"><table class="grid opps"><thead>{head}</thead>'
             f'<tbody>{_opp_rows(cards, with_status)}</tbody></table></div>')
    title = f'<span class="mono lbl">{e(label)} · {len(cards)}</span>'
    if fold:
        return f'<details class="opp-g">' f'<summary>{title}</summary>{table}</details>'
    return f'<section class="opp-g" aria-label="{e(label)}">{title}{table}</section>'


def opportunity_panel(csrf: str, c: dict, nxt: str = "/opportunities") -> str:
    def items(xs: list, empty: str) -> str:
        return ("<ul class=\"plain brief\">" + "".join(f"<li>{e(x)}</li>" for x in xs) + "</ul>") if xs else \
            f'<p class="muted">{e(empty)}</p>'
    link = (f'<p><a class="btn" href="{e(c["url"])}" target="_blank" rel="noopener noreferrer">Official notice ↗</a></p>'
            if c["url"] else '<p class="muted">No notice link was published.</p>')
    st = c["status"]
    btns = ""
    if st in ("new", "pass"):
        btns += _form(csrf, "opp_bid", c["id"], "Bid", "pri", "/opportunities")
    if st == "new":
        btns += (f'<form method="post" action="/act/opp_pass" class="inl passf"><input type="hidden" name="csrf" value="{e(csrf)}">'
                 f'<input type="hidden" name="id" value="{e(c["id"])}"><input type="hidden" name="next" value="/opportunities">'
                 f'<input class="inp" name="reason" type="text" maxlength="300" placeholder="Reason (optional)" '
                 f'aria-label="Reason for passing"><button class="btn">Pass</button></form>')
    if st == "bid":
        btns += _form(csrf, "opp_submitted", c["id"], "Mark submitted", "pri", "/opportunities")
        btns += _form(csrf, "opp_pass", c["id"], "Drop (pass)", "", "/opportunities")
    if st in ("bid", "submitted"):
        btns += _form(csrf, "opp_won", c["id"], "Won", "", "/opportunities")
        btns += _form(csrf, "opp_lost", c["id"], "Lost", "danger", "/opportunities")
    state = {"new": "", "bid": "You are bidding on this.", "pass": "Passed.", "submitted": "Submitted.",
             "won": "Won.", "lost": "Lost.", "expired": "Expired."}.get(st, "")
    state_html = f'<p class="mono sub">{e(state)}{" " + e(c["notes"]) if c["notes"] and st == "pass" else ""}</p>' if state else ""
    elig = items(c["elig_notes"], "No eligibility issues found by the rules.")
    facts = (f'<p class="sub">{tag(c["badge"], c["badge_tone"])} {e(" · ".join(x for x in (c["buyer"], c["country"], c["source"]) if x))}</p>'
             f'<p class="sub">Value: {e(c["value"])} · Deadline: <span class="days {c["deadline_tone"]}">{e(c["deadline"])}</span>'
             f'{" (" + e(c["deadline_date"]) + ")" if c["deadline_date"] else ""}</p>')
    offer = (f'<p class="sub">Closest offer: <b>{e(c["offer"])}</b> · fit {c["score"]}/100</p>' if c["offer"] else "")
    summary = e(c["summary"][:2500]) + ("…" if len(c["summary"]) > 2500 else "")
    return (f'<div class="phead"><h2>{e(c["title"][:140])}</h2>'
            f'<a class="btn ghost" href="/opportunities" data-close aria-label="Close panel">Close</a></div>'
            f'{facts}{offer}{state_html}'
            f'<div class="oppacts">{btns}</div>'
            f'<h3 class="mono lbl">Why this score</h3>{items(c["reasons"], "No reasons recorded.")}'
            f'<h3 class="mono lbl">Eligibility</h3>{elig}'
            f'<h3 class="mono lbl">What the buyer asks for</h3>{items(c["requirements"], "Not listed in the notice text we have.")}'
            f'<h3 class="mono lbl">What we would need</h3>{items(c["what_we_need"], "Nothing indicated.")}'
            f'<h3 class="mono lbl">Effort</h3><p>{e(c["effort"]) or "Not estimated."}</p>'
            f'<h3 class="mono lbl">Summary · buyer text is untrusted</h3>'
            f'<div class="untrusted small">{summary or "No description in the feed."}</div>'
            f'<h3 class="mono lbl">Official notice</h3>{link}')


def opportunities_page(csrf: str, sh: dict, d: dict, panel: str, demo: bool) -> str:
    new = d["new"]
    worth = [c for c in new if c["score"] >= data.WORTH_A_LOOK]
    mid = [c for c in new if data.LOW_FIT <= c["score"] < data.WORTH_A_LOOK]
    low = [c for c in new if c["score"] < data.LOW_FIT]
    tally = (f'{len(new)} new · {len(worth)} worth a look · {len(d["active"])} in progress · '
             f'{d["won"]} won · {d["lost"]} lost · {d["passed"]} passed')
    if not new and not d["active"]:
        body_main = ('<section class="state"><p>No opportunities yet. The tenders agent checks the official feeds '
                     'every morning at 06:00 and lists the ones worth a look here.</p></section>')
    else:
        body_main = (_opp_table("Worth a look", worth) + _opp_table("Other new", mid)
                     + _opp_table("In progress", d["active"], with_status=True)
                     + _opp_table("Low fit", low, fold=True))
        if not (worth or mid or low):
            body_main = '<section class="state"><p>Nothing new right now.</p></section>' + body_main
    body = (f'<p class="eyebrow mono">Work</p><div class="pt-row"><h1 class="pt">Opportunities</h1>'
            f'<span class="mono">{e(tally)}</span></div>'
            f'<p class="muted oppintro">Public tenders from official feeds, scored against what Epsilon sells. '
            f'Nothing is ever bid for you.</p>{body_main}')
    panel_html = f'<aside id="opp-panel" class="panel" aria-label="Opportunity brief"{"" if panel else " hidden"}>{panel}</aside>'
    return page("Opportunities", f'<div class="opps-page">{body}</div>{panel_html}', "Opportunities", csrf, sh, demo,
                cls="oppspage")


def tenders_card(t: dict, errors: dict) -> str:
    from core import settings as cfg
    boxes = "".join(
        f'<label class="ck pick"><input type="checkbox" name="tenders_sources" value="{e(k)}"'
        f'{" checked" if k in t["sources"] else ""}> {e(cfg.TENDER_SOURCE_LABEL[k])}</label>' for k in cfg.TENDER_LIVE)
    off = ", ".join(cfg.TENDER_SOURCE_LABEL[k].replace(" (disabled)", "") for k in cfg.TENDER_DISABLED)
    src_err = errors.get("tenders_sources")
    sources = (f'<div class="field{" bad" if src_err else ""}"><span class="flab" id="l-tsrc">Sources</span>'
               f'<div class="picks" role="group" aria-labelledby="l-tsrc">{boxes}</div>'
               f'<p class="hint">Shipped disabled (login, anti-bot or unreachable): {e(off)}.</p>'
               f'{f"<p class=fielderr role=alert>{e(src_err)}</p>" if src_err else ""}</div>')

    def money(name: str, label: str, hint: str, val) -> str:
        ref = f"h-{name}" + (f" e-{name}" if errors.get(name) else "")
        ctl = (f'<input class="inp num" id="f-{name}" name="{name}" type="number" inputmode="numeric" min="0" step="1000" '
               f'value="{e(str(val))}" aria-describedby="{ref}"{" aria-invalid=true" if errors.get(name) else ""}>')
        return _field(name, label, hint, ctl, errors)
    paused = (f'<div class="field"><label class="ck pick" for="f-tenders_paused"><input type="checkbox" id="f-tenders_paused" '
              f'name="tenders_paused" value="1"{" checked" if t["paused"] else ""}> Pause tenders</label>'
              f'<p class="hint">Stops the daily scan. Existing opportunities stay on the page.</p></div>')
    return (f'<section class="setcard" aria-labelledby="s-ten"><h2 id="s-ten" class="mono lbl">Tenders</h2>'
            f'{_field("tenders_per_day", "Scored per day", "Tenders sent to the model each morning, 0 to 50.", _num("tenders_per_day", t["per_day"], 0, 50, errors), errors)}'
            f'{money("tenders_value_min", "Minimum value (USD)", "Tenders with no stated value are always kept.", t["value_min"])}'
            f'{money("tenders_value_max", "Maximum value (USD)", "Converted at approximate rates.", t["value_max"])}'
            f'{sources}{paused}</section>')


_STATE_LABEL = {"ok": "ok", "amber": "warn", "red": "down", "idle": "idle"}


def agents_page(csrf: str, sh: dict, a: dict, now, demo: bool) -> str:
    from dashboard import schedule
    c = a["counts"]
    bits = [f'{c["ok"]} healthy']
    if c["amber"]:
        bits.append(f'{c["amber"]} need a look')
    if c["red"]:
        bits.append(f'{c["red"]} down')
    if c["idle"]:
        bits.append(f'{c["idle"]} idle')
    nxt = ""
    if a["soonest"]:
        nxt = f' · next up: {e(a["soonest"][0])} {e(schedule.until(a["soonest"][1], now))}'
    secs = ""
    for cat, items in a["categories"]:
        rows = ""
        for r in items:
            pips = "".join(f'<i class="pip {({"error": "red", "warn": "amber"}).get(h, "ok")}"></i>' for h in r["history"])
            when = ""
            if r["next"]:
                when = f'<span class="ag-next">{e(r["next"].strftime("%a %H:%M"))} · {e(schedule.until(r["next"], now))}</span>'
            btn = ""
            if r["runnable"] and csrf:
                btn = (f'<form method="post" action="/act/run_job" class="runf"><input type="hidden" name="csrf" value="{e(csrf)}">'
                       f'<input type="hidden" name="job" value="{e(r["job"])}"><input type="hidden" name="next" value="/agents">'
                       f'<button class="runbtn">Run now</button></form>')
            issue = f'<p class="ag-issue">{e(r["issue"])}</p>' if r["issue"] else ""
            calls = f'<span class="ag-calls" title="AI calls today">{r["calls"]} AI calls</span>' if r["calls"] else ""
            rows += (f'<li class="agrow {r["state"]}{" running" if r["running"] else ""}">'
                     f'<span class="agdot {r["state"]}" aria-hidden="true"></span>'
                     f'<div class="ag-main"><div class="ag-title"><b>{e(r["label"])}</b>'
                     f'<span class="agstate {r["state"]}">{e(r["text"])}</span></div>'
                     f'<p class="ag-what">{e(r["what"])}</p>{issue}</div>'
                     f'<div class="ag-last"><span>{"Last run " + e(r["last"]) + (" ago" if r["last"] not in ("never", "now") else "") if r["cadence"] or r["history"] else ""}</span>'
                     f'<span class="ag-sum">{e(r["summary"])}</span></div>'
                     f'<div class="ag-sched"><span class="ag-cad">{e(r["cadence"])}</span>{when}</div>'
                     f'<div class="ag-hist" aria-label="Last runs">{pips}</div>'
                     f'<div class="ag-act">{calls}{btn}</div></li>')
        n_bad = sum(1 for r in items if r["state"] in ("amber", "red"))
        flag = f'<span class="agcat-flag">{n_bad} need attention</span>' if n_bad else ""
        secs += (f'<section class="agcat"><h2 class="agcat-h">{e(cat)} <span class="agcat-n">{len(items)}</span>{flag}</h2>'
                 f'<ul class="aglist">{rows}</ul></section>')
    planned = "".join(f'<li class="agrow planned"><span class="agdot idle" aria-hidden="true"></span>'
                      f'<div class="ag-main"><div class="ag-title"><b>{e(n)}</b><span class="agstate idle">planned</span></div>'
                      f'<p class="ag-what">{e(w)}</p></div></li>' for n, w in a["planned"])
    secs += (f'<section class="agcat"><h2 class="agcat-h">Coming with the client platform <span class="agcat-n">{len(a["planned"])}</span></h2>'
             f'<ul class="aglist">{planned}</ul></section>')
    body = (f'<header class="aghead"><p class="eyebrow mono">System</p><h1 class="pt">Agents</h1>'
            f'<p class="muted">{" · ".join(bits)}{nxt}</p></header>{secs}')
    return page("Agents", body, "Agents", csrf, sh, demo, cls="agentspage")
