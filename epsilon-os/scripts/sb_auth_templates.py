"""Brand Supabase's own auth emails (magic link, invite, email change, reauthentication, recovery) with the Epsilon
email layout, and push them to the live project through the Management API.

    .venv/bin/python scripts/sb_auth_templates.py --dry-run   # GET the config, write the HTML, show what would change
    .venv/bin/python scripts/sb_auth_templates.py             # the same, then PATCH /v1/projects/<ref>/config/auth

The HTML is rendered by node from platform/lib/email/layout-core.mjs (the one layout source the platform and the
site's enquiry emails use), with Supabase's Go-template placeholders ({{ .ConfirmationURL }}, {{ .Token }},
{{ .Email }}, {{ .NewEmail }}) left in place. The PATCH carries ONLY mailer_subjects_<kind> and
mailer_templates_<kind>_content for the five kinds below; every other auth setting is left untouched.
The personal access token comes from the macOS keychain via sb_sql.token(); it is never printed.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # epsilon-os/, for core.config
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sb_sql  # noqa: E402  (REF + token(): the keychain PAT)

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LAYOUT = os.path.join(REPO, "platform", "lib", "email", "layout-core.mjs")
API = f"https://api.supabase.com/v1/projects/{sb_sql.REF}/config/auth"
KINDS = ("magic_link", "invite", "email_change", "reauthentication", "recovery")

# Rendered by node so the layout has one source. argv: layout path, JSON {expiry}. Prints JSON {kind: {subject, html}}.
RENDER_JS = r"""
import { pathToFileURL } from "node:url";
const [layoutPath, optsJson] = process.argv.slice(-2);
const L = await import(pathToFileURL(layoutPath).href);
const { expiry } = JSON.parse(optsJson);
const URL_ = "{{ .ConfirmationURL }}";
const fallback = () => L.small("Opening it on another device? Copy this link into its browser instead:", 6) + L.linkBox(URL_);
const T = {
  magic_link: {
    subject: "Your Epsilon Labs sign-in link",
    label: "Sign in",
    preheader: `Your one-time sign-in link for Epsilon Labs. It works once and expires in ${expiry}.`,
    why: "You got this because someone asked to sign in as {{ .Email }}. If it wasn’t you, ignore it; nobody can sign in without the link.",
    html: L.eyebrow("Epsilon Labs · sign in") + L.h1("Sign in to Epsilon Labs") +
      L.p(`Use the button below to sign in as ${L.mono("{{ .Email }}")}. The link works once and expires in ${L.esc(expiry)}.`) +
      L.button(URL_, "Sign in") + fallback(),
  },
  invite: {
    subject: "You’re invited to the Epsilon Labs client portal",
    label: "Client portal",
    preheader: "Epsilon Labs invited you to the client portal. The link works once.",
    why: "You got this because Epsilon Labs invited {{ .Email }}. If you weren’t expecting it, ignore it; the link expires on its own.",
    html: L.eyebrow("Client portal · invitation") + L.h1("Join the Epsilon Labs client portal") +
      L.p("You have been invited to the Epsilon Labs client portal: requests and their replies, weekly updates, delivery reports and invoices for your projects, in one place.") +
      L.button(URL_, "Accept invitation") +
      L.small(`There is no password. After this, you sign in by entering ${L.mono("{{ .Email }}")} and clicking the one-time link we send.`, 14) + fallback(),
  },
  email_change: {
    subject: "Confirm your new email address",
    label: "Verification",
    preheader: "Confirm the new email address for your Epsilon Labs account.",
    why: "You got this because an email address change was requested for an Epsilon Labs account. If it wasn’t you, ignore it; nothing changes without the link.",
    html: L.eyebrow("Account · email change") + L.h1("Confirm your new email address") +
      L.p(`Confirm ${L.mono("{{ .NewEmail }}")} as the new sign-in address for the Epsilon Labs account that uses ${L.mono("{{ .Email }}")} today.`) +
      L.button(URL_, "Confirm new address") +
      L.small("If you didn’t ask for this change, ignore this email; your address stays as it is.", 14) + fallback(),
  },
  reauthentication: {
    subject: "{{ .Token }} is your Epsilon verification code",
    label: "Verification",
    preheader: `Your Epsilon verification code. It expires in ${expiry}.`,
    why: "You got this because a verification code was requested for {{ .Email }}.",
    html: L.eyebrow("Account · confirm it’s you") + L.h1("Your verification code") +
      L.p("Enter this code to confirm it’s you before the change goes through.") +
      L.codeBlock("{{ .Token }}", `Expires in ${expiry} · single use`) +
      L.small("If you didn’t ask for this code, ignore this email. Nothing changes without it."),
  },
  recovery: {
    subject: "Your Epsilon Labs account recovery link",
    label: "Sign in",
    preheader: `Your one-time recovery link for Epsilon Labs. It expires in ${expiry}.`,
    why: "You got this because account recovery was requested for {{ .Email }}. If it wasn’t you, ignore it; nobody can use it without the link.",
    html: L.eyebrow("Epsilon Labs · account recovery") + L.h1("Get back into your account") +
      L.p(`Use the button below to sign back in as ${L.mono("{{ .Email }}")}. The link works once and expires in ${L.esc(expiry)}.`) +
      L.button(URL_, "Recover access") + fallback(),
  },
};
const out = {};
for (const [k, t] of Object.entries(T)) {
  out[k] = { subject: t.subject, html: L.layout({ label: t.label, preheader: t.preheader, title: t.subject, why: t.why, body: t.html }) };
}
process.stdout.write(JSON.stringify(out));
"""


def _call(method: str, payload: dict | None = None) -> dict:
    req = urllib.request.Request(API, method=method, data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={"Authorization": f"Bearer {sb_sql.token()}", "Content-Type": "application/json",
                                          "User-Agent": "epsilon-os"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} config/auth: HTTP {e.code}: {e.read().decode(errors='replace')[:2000]}")


def expiry_text(seconds: int) -> str:
    if seconds % 3600 == 0:
        h = seconds // 3600
        return f"{h} hour{'s' if h != 1 else ''}"
    m = max(1, round(seconds / 60))
    return f"{m} minute{'s' if m != 1 else ''}"


def render(expiry: str) -> dict:
    r = subprocess.run(["node", "--input-type=module", "-", LAYOUT, json.dumps({"expiry": expiry})],
                       input=RENDER_JS, capture_output=True, text=True, check=False)
    if r.returncode != 0:
        raise SystemExit(f"node render failed:\n{r.stderr[-2000:]}")
    return json.loads(r.stdout)


def build_patch(current: dict, rendered: dict) -> dict:
    patch = {}
    for k in KINDS:
        for field, value in ((f"mailer_subjects_{k}", rendered[k]["subject"]),
                             (f"mailer_templates_{k}_content", rendered[k]["html"])):
            if field not in current:
                raise SystemExit(f"{field} is not in the live auth config; refusing to guess the API shape")
            if current[field] != value:
                patch[field] = value
    assert all(f.startswith(("mailer_subjects_", "mailer_templates_")) for f in patch), patch.keys()
    return patch


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="write the HTML and list the changes; do not PATCH")
    ap.add_argument("--out", default="/private/tmp/eps-mail/auth", help="where to write the rendered HTML")
    a = ap.parse_args()

    current = _call("GET")
    expiry = expiry_text(int(current.get("mailer_otp_exp") or 3600))
    rendered = render(expiry)
    os.makedirs(a.out, exist_ok=True)
    for k, m in rendered.items():
        with open(os.path.join(a.out, f"{k}.html"), "w") as f:
            f.write(m["html"])
    print(f"rendered {len(rendered)} templates to {a.out} (link/code expiry: {expiry}, from mailer_otp_exp)")

    patch = build_patch(current, rendered)
    if not patch:
        print("live config already matches; nothing to change")
        return
    for field in sorted(patch):
        old = current.get(field) or ""
        new = patch[field]
        if field.startswith("mailer_subjects_"):
            print(f"  {field}: {old!r} -> {new!r}")
        else:
            print(f"  {field}: {len(old)} chars -> {len(new)} chars")
    if a.dry_run:
        print(f"dry run: {len(patch)} field(s) would change; nothing sent")
        return
    _call("PATCH", patch)
    after = _call("GET")
    bad = [f for f in patch if after.get(f) != patch[f]]
    if bad:
        raise SystemExit(f"PATCH sent but these fields did not read back as written: {bad}")
    print(f"patched {len(patch)} field(s); read back and verified")


if __name__ == "__main__":
    main()
