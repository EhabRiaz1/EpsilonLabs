"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/app/components/Icon";
import type { IconName } from "@/app/components/icons";
import { EMPTY_CODE, OtpInput } from "@/app/components/OtpInput";
import { ThemePill } from "@/app/components/ThemePill";
import { eps } from "@/app/components/eps";
import { inline, scopeView, timelineView } from "@/lib/markdown";
import { splitMoney } from "@/lib/money";
import type { AcceptedView, PublicProposal } from "@/lib/deal-room";
import { confirmCode, sendCode } from "./actions";

// Port of the approved prototype platform-v2-20261011/deal-room.html: proposal document, sticky price card, and
// the accept flow (name -> "Send code" -> 6-digit code, auto-advance -> accepted, deposit invoice, portal access).

type Labels = { validUntil: string; daysLeft: number; sent: string; fingerprint: string; acceptedOn: string };
type Step = 1 | 2 | 3;

const SCOPE_ICONS: IconName[] = ["pin", "cpu", "chart", "bell", "shield", "layers", "zap", "globe"];

function Money({ value, currency, className }: { value: number | string; currency: string; className?: string }) {
  const { whole, dec } = splitMoney(value, currency);
  return (
    <span className={className ?? "money"}>
      {whole}
      <span className="dec">{dec}</span>
    </span>
  );
}

/** The prototype's number ticker, in React so motion.js never rewrites nodes React owns. */
function Ticker({ value, currency }: { value: number; currency: string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 900);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <Money value={Math.round(shown * 100) / 100} currency={currency} className="big num" />;
}

function Text({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>))}
    </>
  );
}

function Section({ id, n, title, className, children }: { id: string; n: string; title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`} id={id}>
      <div className="num">
        <span className="n">{n}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function DealRoom(props: {
  token: string;
  p: PublicProposal;
  stageAmounts: number[];
  labels: Labels;
  initialAccepted: AcceptedView | null;
  /** admin preview: same page, accepting disabled */
  preview?: boolean;
}) {
  const { p, labels, stageAmounts } = props;
  const [accepted, setAccepted] = useState<AcceptedView | null>(props.initialAccepted);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [code, setCode] = useState<string[]>([...EMPTY_CODE]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false); // terms inactive, gone, already accepted: no point retrying
  const [emailMasked, setEmailMasked] = useState(p.email_masked);
  const [resendIn, setResendIn] = useState(0);
  const [canResendNow, setCanResendNow] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const scope = scopeView(p.scope_md);
  const timeline = timelineView(p.timeline_md);
  const first = (s: string) => s.trim().split(/\s+/)[0] || s;
  const depositPct = p.schedule[0]?.pct ?? 0;
  const termsLink = (
    <a href={p.terms.pdf_path} target="_blank" rel="noopener noreferrer">
      {p.terms.version}
    </a>
  );

  // resend countdown
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // modal: lock scroll, Escape closes (but not while a request is in flight)
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  function openAccept() {
    if (props.preview) {
      eps()?.toast("Preview: accepting is disabled here", { icon: "eye" });
      return;
    }
    setStep(accepted ? 3 : 1);
    setError(null);
    setOpen(true);
    setTimeout(() => nameRef.current?.focus(), 150);
  }

  async function requestCode() {
    if (busy || name.trim().length < 3) return;
    setBusy(true);
    setError(null);
    const r = await sendCode(props.token, name).catch(() => ({ ok: false as const, reason: "error" as const, message: "We couldn't reach the server. Check your connection and try again." }));
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      setBlocked(r.reason === "terms_inactive" || r.reason === "gone" || r.reason === "accepted");
      if (step === 2 && r.reason !== "mail_failed") setStep(1);
      return;
    }
    setEmailMasked(r.emailMasked);
    setCode([...EMPTY_CODE]);
    setStep(2);
    setResendIn(59);
    setCanResendNow(false);
    eps()?.toast(`Code sent to ${r.emailMasked}`, { icon: "mail" });
  }

  async function confirm(digits: string[] = code) {
    if (busy || !digits.every((d) => d !== "")) return;
    setBusy(true);
    setError(null);
    const r = await confirmCode(props.token, digits.join(""), name).catch(() => ({ ok: false as const, reason: "error" as const, message: "We couldn't reach the server. Check your connection and try again." }));
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      setCode([...EMPTY_CODE]);
      if (r.reason === "locked" || r.reason === "code_expired") setCanResendNow(true);
      if (r.reason === "terms_inactive" || r.reason === "gone") setBlocked(true);
      return;
    }
    setAccepted(r.accepted);
    setStep(3);
  }

  function onCode(next: string[]) {
    setCode(next);
    if (next.every((d) => d !== "")) void confirm(next); // auto-advance on the sixth digit
  }

  const steps = (
    <div className="acc-steps" aria-hidden="true">
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= step ? "on" : undefined} />
      ))}
    </div>
  );

  const errorBox = error && (
    <p className="acc-error" role="alert">
      <Icon name="alert" className="i-sm" />
      {error}
    </p>
  );

  return (
    <div className="dr">
      <header className="dr-top">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">
            <strong>Epsilon Labs</strong>
            <span>{p.client_company} · proposal</span>
          </span>
        </span>
        <div className="mid">
          <span className="pill pill-white pill-mono">Proposal · v{p.version}</span>
          <span className="pill pill-white">
            <span className={`dot ${p.terms.active ? "c-good" : "c-3"}`} />
            Terms {p.terms.version}
          </span>
        </div>
        <div className="row" style={{ marginLeft: "auto" }}>
          {accepted ? (
            <span className="pill pill-good">
              <span className="dot" />
              Accepted{labels.acceptedOn || accepted.stamp ? ` · ${labels.acceptedOn || accepted.stamp.split(" ").slice(0, 2).join(" ")}` : ""}
            </span>
          ) : (
            <span className="pill pill-amber">
              <span className="dot" />
              Valid until {labels.validUntil}
              <span className="days">
                {" "}
                · {labels.daysLeft} {labels.daysLeft === 1 ? "day" : "days"}
              </span>
            </span>
          )}
          <ThemePill />
        </div>
      </header>

      <main className="wrap-x">
        <div className="hero">
          <div className="eyebrow">
            Prepared for {p.client_company} · {p.contact_name}
          </div>
          <h1>{p.title}</h1>
          {p.summary && <p className="lede">{p.summary}</p>}
          <div className="meta">
            <span className="who">
              <span className="avatar">ER</span>Ehab Riaz · Epsilon Labs
            </span>
            <span>{labels.sent}</span>
            <span>Version {p.version}</span>
          </div>
        </div>

        <div className="dr-grid">
          <article className="doc">
            <Section id="scope" n="01" title="Scope">
              {scope.intro.map((t, i) => (
                <p className="intro" key={i}>
                  <Text text={t} />
                </p>
              ))}
              {scope.items.length > 0 && (
                <div className="scope" data-stagger>
                  {scope.items.map((it, i) => (
                    <div className="item" key={i} style={scope.items.length % 2 === 1 && i === scope.items.length - 1 ? { gridColumn: "1/-1" } : undefined}>
                      <Icon name={SCOPE_ICONS[i % SCOPE_ICONS.length]} />
                      <h3>{it.title}</h3>
                      {it.body.map((b, j) => (
                        <p key={j}>
                          <Text text={b} />
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {scope.notes.map((t, i) => (
                <div className="not" key={i}>
                  <Text text={t} />
                </div>
              ))}
            </Section>

            {(timeline.steps.length > 0 || timeline.intro.length > 0) && (
              <Section id="timeline" n="02" title="Timeline">
                {timeline.intro.map((t, i) => (
                  <p className="intro" key={i}>
                    <Text text={t} />
                  </p>
                ))}
                <ol className="tl">
                  {timeline.steps.map((s, i) => (
                    <li key={i} data-kind={s.milestone ? "client" : "internal"}>
                      <span className="tl-dot" />
                      {s.week && <div className="tl-week">{s.week}</div>}
                      <div className="tl-title">{s.title}</div>
                      {s.meta.map((m, j) => (
                        <div className="tl-meta" key={j}>
                          <Text text={m} />
                        </div>
                      ))}
                      {s.milestone && (
                        <span className="ms pill pill-accent">
                          <span className="dot" />
                          {s.milestone}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </Section>
            )}

            <Section id="price" n="03" title="Price">
              <table className="price-lines">
                <tbody>
                  {p.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <div className="w-600">
                          {l.name}
                          {l.qty > 1 ? ` × ${l.qty}` : ""}
                        </div>
                        {l.description && <div className="d">{l.description}</div>}
                      </td>
                      <td>
                        <Money value={l.amount} currency={p.currency} />
                      </td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>
                      Total{" "}
                      <span className="c-3 t-12" style={{ fontWeight: 400 }}>
                        · {p.currency}, excluding taxes
                      </span>
                    </td>
                    <td>
                      <Money value={p.total} currency={p.currency} className="big" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="sched" data-stagger>
                {p.schedule.map((s, i) => (
                  <div key={i}>
                    <span className="pct">
                      {s.pct}% · {s.label}
                    </span>
                    <Money value={stageAmounts[i]} currency={p.currency} className="big" />
                    <p>{i === 0 ? "Deposit invoice issued when you accept." : `Invoiced at: ${s.label.toLowerCase()}.`}</p>
                  </div>
                ))}
              </div>
            </Section>

            {scope.checklist.length > 0 && (
              <Section id="fromyou" n="04" title="From you">
                <ul className="fromyou">
                  {scope.checklist.map((t, i) => (
                    <li key={i}>
                      <Icon name="check" />
                      <span>
                        <Text text={t} />
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section id="terms" n={scope.checklist.length > 0 ? "05" : "04"} title="Terms and changes" className="terms">
              <p>
                This proposal is governed by the {p.terms.title}, version {termsLink}. Accepting the proposal accepts those terms. The acceptance record
                stores which proposal version and which terms version you accepted.
              </p>
              {p.changes_md.trim() && (
                <div className="changes">
                  <strong>Changes since v{p.version - 1}.</strong> <Text text={p.changes_md.replace(/\s+/g, " ").trim()} />
                </div>
              )}
            </Section>
          </article>

          <aside className="side" data-accepted={accepted ? "" : undefined}>
            <div className="panel price-card">
              <div className="pending-box">
                <div className="eyebrow">Total · {p.currency}, excl. taxes</div>
                <Ticker value={Number(p.total)} currency={p.currency} />
                <div className="rows">
                  {p.schedule.map((s, i) => (
                    <div key={i}>
                      <span className="pct">{s.pct}%</span>
                      <span className="lbl">{s.label}</span>
                      <Money value={stageAmounts[i]} currency={p.currency} />
                    </div>
                  ))}
                </div>
                <div className="cta">
                  <button className="btn btn-primary btn-lg btn-block" type="button" onClick={openAccept}>
                    Accept proposal
                    <Icon name="arrowR" />
                  </button>
                  <a className="btn btn-secondary btn-block" href={`mailto:er@epsilon-labs.co?subject=${encodeURIComponent(`Question: ${p.title} (v${p.version})`)}`}>
                    Ask a question
                  </a>
                </div>
                <p className="fine">
                  Accepting records your name, email, the time and a fingerprint of this exact version:{" "}
                  <span className="mono">
                    v{p.version} · {labels.fingerprint}
                  </span>
                  . Then the deposit invoice for <Money value={stageAmounts[0]} currency={p.currency} /> is issued and your {p.client_company} login on
                  client.epsilon-labs.co is created.
                </p>
              </div>
              {accepted && (
                <div className="accepted-box">
                  <span className="pill pill-good">
                    <span className="dot" />
                    Accepted
                  </span>
                  <div className="display t-28" style={{ marginTop: 12 }}>
                    Thank you, {first(accepted.name)}
                  </div>
                  <div className="c-3 t-12" style={{ margin: "2px 0 14px" }}>
                    {accepted.stamp} · {accepted.name}
                  </div>
                  {accepted.invoice && (
                    <div className="line">
                      <Icon name="receipt" />
                      <span className="grow">
                        Deposit invoice <span className="mono">{accepted.invoice.number}</span>
                      </span>
                      <Money value={accepted.invoice.total} currency={accepted.invoice.currency} />
                    </div>
                  )}
                  <div className="line">
                    <Icon name="mail" />
                    <span className="grow">
                      {accepted.portalSent === false
                        ? "Ehab will send your portal login shortly"
                        : `Portal access: sign in at client.epsilon-labs.co with ${accepted.emailMasked}`}
                    </span>
                  </div>
                  <div className="line">
                    <Icon name="shield" />
                    <span className="grow c-3 t-12">
                      Record{" "}
                      <span className="mono">
                        {accepted.record} · {accepted.termsVersion}
                      </span>
                    </span>
                  </div>
                  <div className="cta">
                    <a className="btn btn-secondary btn-block" href="/login">
                      Open the portal
                      <Icon name="arrowR" />
                    </a>
                  </div>
                </div>
              )}
            </div>
            <div className="glass q">
              <strong>Questions on this proposal</strong>
              Reply to the email this link came from, or write to Ehab at <a href="mailto:er@epsilon-labs.co">er@epsilon-labs.co</a>.
            </div>
          </aside>
        </div>
      </main>

      <div className="mobile-bar">
        {accepted ? (
          <>
            <span className="pill pill-good">
              <span className="dot" />
              Accepted
            </span>
            <span className="c-2 t-13 grow">
              {accepted.invoice ? (
                <>
                  Deposit invoice {accepted.invoice.number} · <Money value={accepted.invoice.total} currency={accepted.invoice.currency} />
                </>
              ) : (
                accepted.stamp
              )}
            </span>
          </>
        ) : (
          <>
            <div>
              <div className="eyebrow">Total</div>
              <Money value={p.total} currency={p.currency} className="big" />
            </div>
            <button className="btn btn-primary btn-lg" type="button" onClick={openAccept}>
              Accept proposal
            </button>
          </>
        )}
      </div>

      <div className="scrim" data-open={open ? "" : undefined} onClick={() => !busy && setOpen(false)} />
      <div className="modal" data-open={open ? "" : undefined} role="dialog" aria-modal="true" aria-labelledby="acc-title" aria-hidden={!open}>
        <div className="modal-card acc">
          {steps}
          {step === 1 && (
            <div className="acc-step" data-on="">
              <h2 id="acc-title">Accept this proposal</h2>
              <p className="sub">
                Type your full name as it should appear on the acceptance record. We then email a 6-digit code to{" "}
                <span className="mono">{emailMasked}</span>.
              </p>
              <div className="field" style={{ marginTop: 20 }}>
                <label className="label" htmlFor="acc-name">
                  Your full name
                </label>
                <input
                  ref={nameRef}
                  className="input input-lg"
                  id="acc-name"
                  placeholder={p.contact_name}
                  autoComplete="name"
                  maxLength={200}
                  value={name}
                  disabled={blocked}
                  onChange={(e) => setName(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void requestCode();
                  }}
                />
              </div>
              <p className="fine" style={{ marginTop: 12 }}>
                By continuing you agree to Contract Terms <span className="c-accent w-600">{termsLink}</span>. The record stores your name, email, time, IP
                and the fingerprint <span className="mono">{labels.fingerprint}</span>.
              </p>
              {errorBox}
              <div className="foot">
                <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="button" disabled={busy || blocked || name.trim().length < 3} onClick={() => void requestCode()}>
                  {busy ? (
                    <>
                      <span className="spinner" />
                      Sending code
                    </>
                  ) : (
                    <>
                      Send code
                      <Icon name="arrowR" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="acc-step" data-on="">
              <h2 id="acc-title">Enter the code</h2>
              <p className="sub">
                We emailed a 6-digit code to <span className="mono">{emailMasked}</span>. It expires in 10 minutes.
              </p>
              <div style={{ marginTop: 20 }}>
                <OtpInput value={code} onChange={onCode} disabled={busy || blocked} />
              </div>
              <p className="resend" style={{ marginTop: 12 }}>
                {resendIn > 0 && !canResendNow ? (
                  <>
                    Resend code in <span className="mono">0:{String(resendIn).padStart(2, "0")}</span>
                  </>
                ) : (
                  <button type="button" disabled={busy || blocked} onClick={() => void requestCode()}>
                    Send a new code
                  </button>
                )}
                {" · "}
                <button
                  type="button"
                  onClick={() => eps()?.toast("The code goes to the address this proposal was prepared for. If it's wrong, reply to Ehab's email.", { icon: "mail" })}
                >
                  Wrong email?
                </button>
              </p>
              {errorBox}
              <div className="foot">
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setError(null); setStep(1); }}>
                  <Icon name="arrowL" />
                  Back
                </button>
                <button className="btn btn-primary" type="button" disabled={busy || blocked || !code.every((d) => d !== "")} onClick={() => void confirm()}>
                  {busy ? (
                    <>
                      <span className="spinner" />
                      Recording acceptance
                    </>
                  ) : (
                    "Confirm and accept"
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 3 && accepted && (
            <div className="acc-step" data-on="">
              <div className="done">
                <svg className="check-anim" viewBox="0 0 72 72" aria-hidden="true">
                  <circle cx="36" cy="36" r="32" />
                  <path d="M22 37l9 9 19-20" />
                </svg>
                <h2 id="acc-title">Accepted</h2>
                <p className="sub">
                  {accepted.stamp} · {accepted.name}
                </p>
                <div className="box">
                  {accepted.invoice && (
                    <div className="line">
                      <Icon name="receipt" />
                      <span className="grow">
                        Deposit invoice <span className="mono">{accepted.invoice.number}</span>
                      </span>
                      <Money value={accepted.invoice.total} currency={accepted.invoice.currency} />
                    </div>
                  )}
                  <div className="line">
                    <Icon name="mail" className={accepted.portalSent === false ? "pending" : undefined} />
                    <span className="grow">{accepted.portalSent === false ? "Portal login: Ehab will send it shortly" : "Portal access sent"}</span>
                    <span className="c-3 t-12">{accepted.emailMasked}</span>
                  </div>
                  <div className="line">
                    <Icon name="shield" />
                    <span className="grow">
                      Record <span className="mono">{accepted.record}</span> · Terms {accepted.termsVersion}
                    </span>
                  </div>
                </div>
                <p className="fine">
                  Deposit: {depositPct}% of the total. The invoice is in your portal{accepted.portalSent === false ? " once your login arrives" : ""}.
                </p>
                <div className="foot" style={{ justifyContent: "center" }}>
                  <a className="btn btn-primary btn-lg" href="/login">
                    Open the portal
                    <Icon name="arrowR" />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
