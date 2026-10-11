"use client";

import { useRef } from "react";

/** Six-box code input with the system's .otp styling (React port of Eps.otp: paste, backspace, arrows). */
export const EMPTY_CODE: readonly string[] = ["", "", "", "", "", ""];

export function OtpInput({ value, onChange, disabled }: { value: readonly string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  function setFrom(i: number, raw: string) {
    const v = raw.replace(/\D/g, "");
    const next = digits.slice();
    if (v.length > 1) {
      for (let j = 0; j < v.length && i + j < 6; j++) next[i + j] = v[j];
      refs.current[Math.min(5, i + v.length)]?.focus();
    } else {
      next[i] = v;
      if (v && i < 5) refs.current[i + 1]?.focus();
    }
    onChange(next);
  }

  return (
    <div className="otp" aria-label="6-digit code">
      {digits.map((d, i) => (
        <span key={i} style={{ display: "contents" }}>
          {i === 3 && <span className="gap" />}
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={d ? "filled" : undefined}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={i === 0 ? 6 : 1}
            aria-label={`Digit ${i + 1}`}
            value={d}
            disabled={disabled}
            autoFocus={i === 0}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setFrom(i, e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !d && i > 0) {
                const next = digits.slice();
                next[i - 1] = "";
                onChange(next);
                refs.current[i - 1]?.focus();
              }
              if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
              if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
            }}
          />
        </span>
      ))}
    </div>
  );
}
