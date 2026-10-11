"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { Icon } from "./Icon";
import { EMPTY_CODE, OtpInput } from "./OtpInput";

type Enrolment = { factorId: string; qr: string; secret: string };

/**
 * Admin second factor (F11): Supabase MFA TOTP with Google Authenticator.
 * verifiedFactorId set  -> verify a code against it.
 * not set               -> enrol a new factor (QR + secret), then verify the first code to activate it.
 */
export function MfaForm({ verifiedFactorId }: { verifiedFactorId: string | null }) {
  const router = useRouter();
  const [enrol, setEnrol] = useState<Enrolment | null>(null);
  const [code, setCode] = useState<string[]>([...EMPTY_CODE]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (verifiedFactorId || started.current) return;
    started.current = true; // React dev double-invokes effects; enrol exactly once
    (async () => {
      const supabase = createClient();
      // An earlier abandoned enrolment leaves an unverified factor behind; clear it so names don't collide.
      const listed = await supabase.auth.mfa.listFactors();
      for (const f of listed.data?.all ?? []) {
        if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: e } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      });
      if (e || !data) {
        setError("Couldn't start set-up. Reload the page to try again.");
        return;
      }
      setEnrol({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, [verifiedFactorId]);

  const factorId = verifiedFactorId ?? enrol?.factorId ?? null;
  const complete = code.every((d) => d !== "");

  async function verify(digits: string[] = code) {
    if (!factorId || !digits.every((d) => d !== "") || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: digits.join("") });
    if (e) {
      setBusy(false);
      setCode([...EMPTY_CODE]);
      setError(
        e.status === 429
          ? "Too many attempts. Wait a minute, then try again."
          : "That code didn't match. Codes change every 30 seconds; use the newest one.",
      );
      return;
    }
    router.replace("/");
    router.refresh();
  }

  // verify as soon as the sixth digit lands
  function onCode(next: string[]) {
    setCode(next);
    if (next.every((d) => d !== "")) void verify(next);
  }

  return (
    <>
      <span className="pill pill-accent">
        <Icon name="shield" className="i-sm" />
        Second factor
      </span>
      <h1 className="auth-title" style={{ marginTop: 12 }}>
        {verifiedFactorId ? "Enter your 6-digit code" : "Set up Google Authenticator"}
      </h1>
      <p className="auth-sub">
        {verifiedFactorId
          ? "Open Google Authenticator (or 1Password) and type the code for Epsilon admin."
          : "Admin needs a second factor. Scan the code with Google Authenticator, then type the 6 digits it shows. Add a second device as well: there are no recovery codes."}
      </p>
      {!verifiedFactorId && (
        <div className="mfa-qr">
          {enrol ? (
            // Supabase returns the QR as an SVG data URL; next/image adds nothing for it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={enrol.qr} width={176} height={176} alt="QR code for Google Authenticator" />
          ) : (
            <div className="skel" style={{ width: 176, height: 176, borderRadius: 16 }} aria-label="Preparing QR code" />
          )}
          <div className="grow">
            <div className="eyebrow">Can&apos;t scan?</div>
            <p className="t-13 c-2" style={{ marginTop: 4 }}>
              Enter this key by hand, time-based:
            </p>
            <code className="mfa-secret">{enrol ? enrol.secret.replace(/(.{4})/g, "$1 ").trim() : "…"}</code>
          </div>
        </div>
      )}
      <div style={{ marginTop: 22 }}>
        <OtpInput value={code} onChange={onCode} disabled={busy || !factorId} />
      </div>
      {error && (
        <p className="auth-error" role="alert" style={{ marginTop: 14 }}>
          <Icon name="alert" className="i-sm" />
          {error}
        </p>
      )}
      <button
        className="btn btn-primary btn-lg btn-block"
        style={{ marginTop: 18 }}
        type="button"
        disabled={!complete || busy || !factorId}
        onClick={() => verify()}
      >
        {busy ? (
          <>
            <span className="spinner" />
            Verifying
          </>
        ) : verifiedFactorId ? (
          "Verify"
        ) : (
          "Verify and turn on"
        )}
      </button>
    </>
  );
}
