"""Hacker News "Ask HN: Freelancer? Seeking freelancer?" thread, for prospecting strategy S13 (not a tender source).

Deterministic HTTP through the official, public HN Algolia API (no key, no login):

    GET https://hn.algolia.com/api/v1/search_by_date?query="Seeking freelancer"&tags=story
        -> the monthly threads. Since October 2025 they are no longer posted by `whoishiring` (that account's newest
           freelancer thread is 2025-10-01; checked 2026-10-13), so code takes any story whose title matches
           TITLE, newest month first, and within a month the one with the most comments (a stray duplicate thread
           usually has one or two).
    GET https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_<id>&hitsPerPage=1000&page=N
        -> every comment of that thread (a thread has tens to a few hundred).

Kept: top-level comments (parent is the story) whose text starts with SEEKING FREELANCER and mentions work Epsilon
sells (embedded, firmware, IoT, hardware, dashboards, apps, AI; see MATCH). For each, code extracts the website
domains and email addresses that appear in the post. Nothing here judges the company; agents/prospector.py hands
the candidates, as untrusted text, to a tool-less model for scoring and then re-checks every field in code.
"""
import html
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from core.feeds import base

API = "https://hn.algolia.com/api/v1"
THREAD_QUERY = '"Seeking freelancer"'
TITLE = re.compile(r"^Ask HN: Freelancer\? Seeking freelancer\? \((January|February|March|April|May|June|July|August|"
                   r"September|October|November|December) (20\d\d)\)$")
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")
SEEKING = re.compile(r"^\W*seeking\s+freelancers?\b", re.I)
MAX_PAGES = 5                 # 5 x 1000 comments; a real thread has far fewer
TEXT_MAX = 1500
# (tag, pattern). A post is kept when at least one matches; the tags tell the model what code saw.
MATCH: tuple[tuple[str, re.Pattern], ...] = tuple((tag, re.compile(rx, re.I)) for tag, rx in (
    ("embedded", r"\bembedded\b|\bmicrocontrollers?\b|\bmcu\b|\bstm32\b|\besp32\b|\bnrf5\d|\brtos\b|\bzephyr\b"),
    ("firmware", r"\bfirmware\b"),
    ("iot", r"\biot\b|internet of things|\bconnected devices?\b|\bble\b|\bbluetooth low energy\b|\bmqtt\b|\blora(?:wan)?\b"),
    ("hardware", r"\bhardware\b|\bpcbs?\b|\belectronics\b|\bschematics?\b|\bsensors?\b|\bplc\b|\bscada\b|\bmodbus\b"),
    ("dashboards", r"\bdashboards?\b|\binternal tools?\b|\badmin panel\b|\breporting\b|\bcrm\b|\berp\b"),
    ("apps", r"\bapps?\b|\bmobile apps?\b|\bios\b|\bandroid\b|\bflutter\b|\breact native\b|\bswift(?:ui)?\b|\bkotlin\b|\bweb apps?\b"),
    ("ai", r"\bai\b|\bllms?\b|\bmachine learning\b|\bml engineer\b|\bgenerative\b|\bagents?\b|\brag\b|\bopenai\b|\banthropic\b"),
))
_HREF = re.compile(r'href="([^"]+)"', re.I)
_URL = re.compile(r"https?://[^\s<>\"')]+", re.I)
_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}\b")
_BARE = re.compile(r"(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|io|co|ai|app|dev|net|org|tech|so|xyz|"
                   r"us|uk|de|fr|nl|se|no|dk|fi|es|it|ch|at|be|ie|ca|au|nz|sg|jp|eu))\b(?!@)", re.I)
# Hosts that are never a company's own site (forums, docs, job boards, code hosts, link shorteners).
NOT_SITE = ("news.ycombinator.com", "ycombinator.com", "docs.google.com", "google.com", "notion.so", "notion.site",
            "github.com", "gitlab.com", "linkedin.com", "twitter.com", "x.com", "calendly.com", "forms.gle",
            "typeform.com", "airtable.com", "lever.co", "greenhouse.io", "ashbyhq.com", "workable.com",
            "wellfound.com", "angel.co", "upwork.com", "fiverr.com", "toptal.com", "gmail.com", "googlemail.com",
            "proton.me", "protonmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "bit.ly",
            "medium.com", "substack.com", "youtube.com", "loom.com", "dropbox.com")


def _get(c, url: str, **params) -> dict:
    return base.request(c, "GET", url, params=params).json()


def text_of(comment_html: str) -> str:
    """HN comment HTML -> plain text with paragraph breaks kept as newlines."""
    t = re.sub(r"<p>", "\n", comment_html or "", flags=re.I)
    return base.clean_text(t, TEXT_MAX)


def matches(text: str) -> list[str]:
    return [tag for tag, rx in MATCH if rx.search(text or "")]


def _host_ok(host: str) -> str:
    h = (host or "").lower().strip(".").removeprefix("www.")
    if not h or "." not in h or any(h == b or h.endswith("." + b) for b in NOT_SITE):
        return ""
    return h


def domains_and_emails(comment_html: str) -> tuple[list[str], list[str]]:
    """Website domains and email addresses that appear in the post, in order of appearance, deduplicated."""
    raw = html.unescape(comment_html or "")
    urls = _HREF.findall(raw) + _URL.findall(re.sub(r"<[^>]+>", " ", raw))
    emails = []
    for m in _EMAIL.findall(re.sub(r"<[^>]+>", " ", raw)):
        e = m.lower().rstrip(".")
        if e not in emails:
            emails.append(e)
    doms: list[str] = []
    for u in urls:
        h = _host_ok(urlparse(u if "//" in u else "https://" + u).hostname or "")
        if h and h not in doms:
            doms.append(h)
    text = re.sub(r"<[^>]+>", " ", raw)
    for b in _BARE.findall(re.sub(r"https?://\S+", " ", text)):
        h = _host_ok(b)
        if h and h not in doms:
            doms.append(h)
    for e in emails:
        h = _host_ok(e.split("@", 1)[1])
        if h and h not in doms:
            doms.append(h)
    return doms[:6], emails[:4]


def pick_thread(hits: list[dict]) -> dict | None:
    """Newest month's thread; within that month, the one with the most comments."""
    best, best_key = None, None
    for h in hits or []:
        m = TITLE.match(str(h.get("title") or "").strip())
        if not m or not str(h.get("objectID") or "").isdigit():
            continue
        key = (int(m.group(2)), MONTHS.index(m.group(1)), int(h.get("num_comments") or 0), int(h.get("created_at_i") or 0))
        if best_key is None or key > best_key:
            best, best_key = h, key
    return best


def find_thread(c) -> dict | None:
    data = _get(c, f"{API}/search_by_date", query=THREAD_QUERY, tags="story", hitsPerPage=50)
    if not isinstance(data, dict) or "hits" not in data:
        raise base.FeedError("hn: unexpected thread search response")
    return pick_thread(data["hits"])


def comments(c, story_id: str) -> list[dict]:
    out: list[dict] = []
    for page in range(MAX_PAGES):
        if page:
            base.pause()
        data = _get(c, f"{API}/search_by_date", tags=f"comment,story_{story_id}", hitsPerPage=1000, page=page)
        if not isinstance(data, dict) or "hits" not in data:
            raise base.FeedError("hn: unexpected comments response")
        out += data["hits"]
        if page + 1 >= int(data.get("nbPages") or 1):
            break
    return out


def candidates(story: dict, hits: list[dict]) -> list[dict]:
    """Top-level SEEKING FREELANCER posts that mention Epsilon's kind of work, as plain dicts for the prospector."""
    sid = str(story["objectID"])
    out = []
    for h in hits:
        if str(h.get("parent_id")) != sid or not str(h.get("objectID") or "").isdigit():
            continue
        text = text_of(h.get("comment_text") or "")
        if not SEEKING.match(text):
            continue
        tags = matches(text)
        if not tags:
            continue
        doms, emails = domains_and_emails(h.get("comment_text") or "")
        posted = datetime.fromtimestamp(int(h.get("created_at_i") or 0), timezone.utc) if h.get("created_at_i") else \
            base.parse_dt(h.get("created_at"))
        out.append({"post_id": str(h["objectID"]), "url": f"https://news.ycombinator.com/item?id={h['objectID']}",
                    "posted_on": posted.date().isoformat() if posted else "", "text": text, "matched": tags,
                    "domains": doms, "emails": emails, "thread": story.get("title") or ""})
    return out


def fetch_candidates(client=None) -> list[dict]:
    c = client or base.client()
    story = find_thread(c)
    if story is None:
        return []
    base.pause()
    return candidates(story, comments(c, str(story["objectID"])))
