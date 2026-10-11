"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type FanCard = {
  key: string;
  kind: "project" | "invoice";
  tone: "" | "tone-ink" | "tone-amber";
  pill: { label: string; tone: string; live?: boolean };
  corner: string;
  title: string;
  sub: string;
  footKey: string;
  footVal: string;
  big: { whole: string; dec: string } | null;
  href?: string;
};

/** The fanned 3D card deck (client home): projects and open invoices. Click a side card to bring it forward; the
 *  front card opens what it shows. */
export function FanDeck({ cards, initial = 0 }: { cards: FanCard[]; initial?: number }) {
  const router = useRouter();
  const [front, setFront] = useState(Math.max(0, Math.min(initial, cards.length - 1)));
  if (!cards.length) return null;
  function pick(i: number) {
    if (i === front) {
      const href = cards[i].href;
      if (href) router.push(href);
    } else setFront(i);
  }
  return (
    <>
      <section className="fan" aria-label="Your projects and invoices">
        {cards.map((c, i) => {
          const pos = Math.max(-2, Math.min(2, i - front));
          return (
            <article
              key={c.key}
              className={`fcard ${c.tone}`}
              data-pos={pos}
              style={{ ["--dx" as string]: pos * 140, ["--rot" as string]: pos * 5 }}
              tabIndex={0}
              aria-label={`${c.title}${i === front && c.href ? ", open" : ""}`}
              onClick={() => pick(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(i);
                } else if (e.key === "ArrowRight") setFront((f) => Math.min(cards.length - 1, f + 1));
                else if (e.key === "ArrowLeft") setFront((f) => Math.max(0, f - 1));
              }}
            >
              <div className="top">
                <span className={`pill ${c.pill.tone}`} style={c.tone === "tone-amber" ? { background: "rgba(255,255,255,.55)", color: "#4A3A0C" } : undefined}>
                  <span className={`dot${c.pill.live ? " live" : ""}`} />
                  {c.pill.label}
                </span>
                <span className="c-3 t-12 truncate">{c.corner}</span>
              </div>
              <div className="title truncate">{c.title}</div>
              <div className="sub c-3 truncate">{c.sub}</div>
              <div className="bottom">
                <div style={{ minWidth: 0 }}>
                  <div className="c-3 t-11">{c.footKey}</div>
                  <div className="t-13 w-600 truncate">{c.footVal}</div>
                </div>
                {c.big && (
                  <div className="big">
                    {c.big.whole}
                    <span className="dec">{c.big.dec}</span>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </section>
      {cards.length > 1 && (
        <div className="fan-dots" role="group" aria-label="Cards">
          {cards.map((c, i) => (
            <button key={c.key} type="button" aria-pressed={i === front} aria-label={c.title} onClick={() => setFront(i)} />
          ))}
        </div>
      )}
    </>
  );
}
