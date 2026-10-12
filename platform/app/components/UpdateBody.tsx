import { Fragment } from "react";
import { inline, parseBlocks } from "@/lib/markdown";

/** A weekly / manual update's body: the safe markdown subset, parsed to data and rendered as React (never raw HTML). */
export function UpdateBody({ md }: { md: string }) {
  const blocks = parseBlocks(md);
  const text = (t: string) =>
    inline(t).map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : <Fragment key={i}>{x.text}</Fragment>));
  return (
    <div className="update-body stack" style={{ gap: 8 }}>
      {blocks.map((b, i) =>
        b.type === "h" ? (
          <h3 key={i} className="t-13 w-600" style={{ marginTop: i ? 6 : 0 }}>
            {b.text}
          </h3>
        ) : b.type === "ul" ? (
          <ul key={i} style={{ margin: 0, paddingLeft: 20 }}>
            {b.items.map((it, j) => (
              <li key={j} className="c-2">
                {text(it)}
              </li>
            ))}
          </ul>
        ) : b.type === "quote" ? (
          <p key={i} className="c-3 t-13">
            {text(b.text)}
          </p>
        ) : (
          <p key={i} className="c-2">
            {text(b.text)}
          </p>
        ),
      )}
    </div>
  );
}
