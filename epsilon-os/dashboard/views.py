"""Server-rendered HTML. Every dynamic string goes through e(); untrusted mail text is only ever escaped."""
import html
from datetime import datetime

from dashboard import data

e = html.escape
FONTS = ("https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&"
         "family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap")


def tag(text: str, tone: str = "") -> str:
    return f'<span class="tag {tone}">{e(text)}</span>'


def kbd(k: str) -> str:
    return f'<span class="kbd" aria-hidden="true">{e(k)}</span>'


def rail_html(sh: dict, compact: bool = False) -> str:
    ag = "".join(f'<div class="ag"><span class="agn">{e(a["name"].capitalize())}</span>'
                 f'<span class="st {a["state"]}">{e(a["text"])}</span></div>' for a in sh["agents"])
    pct = min(100, round(sh["calls"] / max(sh["budget"], 1) * 100))
    tone = "red" if pct >= 100 else ("amber" if pct >= 80 else "")
    cost = f' · ${sh["cost"]:.2f}' if sh["cost"] else ""
    wd = sh["watchdog"]
    return (f'<div><h2 class="mono lbl">Agents</h2>{ag}</div>'
            f'<div><h2 class="mono lbl">Spend today</h2><div class="bar {tone}" role="meter" aria-valuemin="0" '
            f'aria-valuemax="{sh["budget"]}" aria-valuenow="{sh["calls"]}" aria-label="LLM calls today">'
            f'<i style="width:{pct}%"></i></div>'
            f'<p class="mono sub">{sh["calls"]} of {sh["budget"]} calls{e(cost)}</p></div>'
            f'<div><h2 class="mono lbl">Watchdog</h2><div class="ag"><span class="agn">Last ping</span>'
            f'<span class="st {wd["state"]}">{e(wd["text"])}</span></div></div>')


ICON = {
    "today": '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>',
    "deck": '<path d="M4 7h16v13H4z"/><path d="M7 4h10M9 11h6"/>',
    "held": '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M12 8v5M12 16v.5"/>',
    "pipeline": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    "health": '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    "site": '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    "menu": '<path d="M4 7h16M4 12h16M4 17h16"/>',
    "theme": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
}


def icon(name: str) -> str:
    return (f'<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[name]}</svg>')


SIDENAV = [(None, "/", "Today", "today"), (None, "/deck", "Deck", "deck"),
           ("Work", "/#held", "Held", "held"), ("Work", "/pipeline", "Pipeline", "pipeline"),
           ("System", "/health", "Health", "health")]
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
            f'<meta name="csrf" content="{e(csrf)}"><meta name="referrer" content="no-referrer">'
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
    items = [("/", "Today", "G T"), ("/deck", "Start the deck", "↵"), ("/pipeline", "Pipeline", "G P"),
             ("/health", "Health", "G H"), ("/#held", "Held tray", ""), ("?", "Keyboard shortcuts", "?")]
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
    out = [tag(c["kind_label"], "sig" if c["kind"] in ("reply", "quote") else "")]
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
    meter = min(100, round(float(k["collected"] or 0) / 3500 * 100))
    kp = (
        f'<div class="kpi"><span class="mono">Conversations · 30d</span><b data-count>{k["conversations"]}</b>'
        f'<small>+{k["conv_week"]} this week</small></div>'
        f'<div class="kpi"><span class="mono">Quotes out</span><b data-count>{k["quotes"]}</b>'
        f'<small>{e(data.money(k["quotes_value"]))} value</small></div>'
        f'<div class="kpi"><span class="mono">Collected · 30d</span><b data-count>{e(data.money(k["collected"]))}</b>'
        f'<small>target $3–4k</small><span class="kmeter" role="meter" aria-label="Collected vs $3.5k target" '
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

def deck_card(c: dict) -> str:
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
    lint_meta = f'{len(c["lint"])} warning{"s" if len(c["lint"]) != 1 else ""}' if c["lint"] else "clean"
    return (
        f'<article class="card" data-id="{e(c["id"])}" data-lint="{len(c["lint"])}" data-missing="{int(missing)}" '
        f'role="region" aria-labelledby="t-{e(c["id"])}" hidden>'
        f'<div class="who"><div class="av" aria-hidden="true">{e(data.initials(c["who"]))}</div><div>'
        f'<h2 id="t-{e(c["id"])}" tabindex="-1">{e(c["who"])}{", " + e(c["company"]) if c["company"] else ""}</h2>'
        f'<p>{ctx}</p></div><div class="tags">{card_tags(c, lint=False)}</div></div>'
        f'{late}{lint_html}'
        f'<div class="cols"><div><h3 class="mono lbl">They wrote · untrusted</h3>'
        f'<div class="untrusted">{wrote}</div></div>'
        f'<div><h3 class="mono lbl">You\'ll send</h3>'
        f'<div class="draft" data-draft>{e(c["draft"])}</div>'
        f'<p class="editnote" hidden></p></div></div>'
        f'<div class="why"><span>Classifier: {e(c["classifier"])}</span><span>Lint: {e(lint_meta)}</span>'
        f'<span>To: {e(c["to"] or "—")}</span><span>Thread: {e(c["thread"] or "—")}</span></div>'
        f'<p class="cardmsg err" role="alert" hidden></p>'
        f'<div class="reasonrow" hidden><label for="rr-{e(c["id"])}" class="mono">Reason (optional)</label>'
        f'<input id="rr-{e(c["id"])}" class="reason" maxlength="300" autocomplete="off">'
        f'<button class="btn" data-act="reject-confirm">Reject</button>'
        f'<button class="btn ghost" data-act="reject-cancel">Cancel</button></div>'
        f'</article>')


def deck(csrf: str, sh: dict, cards: list, counts: dict, demo: bool) -> str:
    pips = "".join('<span class="pip"></span>' for _ in cards)
    body = (
        f'<div class="stage" id="deck" data-sent="{counts["sent"]}" data-rejected="{counts["rejected"]}">'
        f'<div class="progress"><div class="strip" aria-hidden="true">{pips}</div>'
        f'<span class="mono cnt" id="count" aria-live="polite"></span></div>'
        f'<div class="deckwrap"><div class="stack" aria-hidden="true"></div>'
        f'{"".join(deck_card(c) for c in cards)}'
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
            f'<span class="sub">{e(r["title"])}</span></td><td><span class="tag ch-{e(r["channel"])}">{e(r["channel"].replace("_", "-").upper())}</span></td>'
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
    body = (f'<p class="eyebrow mono">System</p><h1 class="pt">Health</h1><p class="muted">Backup last restore test: {e(str(rt))}</p>'
            f'<section aria-labelledby="llm"><h2 id="llm" class="mono lbl">LLM calls per day · 14d</h2>'
            f'<ul class="bars" aria-label="LLM calls per day">{bars}</ul></section>'
            f'<section aria-labelledby="runs"><h2 id="runs" class="mono lbl">Agent runs · last 20 each</h2>{runs}</section>'
            f'<section aria-labelledby="acts"><h2 id="acts" class="mono lbl">Last 50 actions</h2>'
            f'<table class="grid"><thead><tr><th scope="col">When</th><th scope="col">Agent</th>'
            f'<th scope="col">Action</th><th scope="col">Target</th></tr></thead><tbody>{acts}</tbody></table></section>')
    return page("Health", body, "Health", csrf, sh, demo, cls="healthpage")
