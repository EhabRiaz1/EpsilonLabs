import { Fragment, type ReactNode } from "react";
import { UpdateBody } from "@/app/components/UpdateBody";
import { inline, weeklyView } from "@/lib/markdown";

function Text({ t }: { t: string }) {
  return (
    <>
      {inline(t).map((x, i) => (x.bold ? <strong key={i}>{x.text}</strong> : <Fragment key={i}>{x.text}</Fragment>))}
    </>
  );
}

function Col({ title, items, need }: { title: string; items: string[]; need?: boolean }) {
  return (
    <div className={need ? "col-u need-col" : "col-u"}>
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((it, i) => (
            <li key={i}>
              <Text t={it} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="none">Nothing listed.</p>
      )}
    </div>
  );
}

/** A weekly update from Ehab (client-home mockup "This week from Ehab"): Done / Next / Needs you columns when the
 *  body has those sections, otherwise the body as written. Markdown is parsed to data, never rendered as HTML. */
export function UpdateCard({ meta, md, title, aside }: { meta: string; md: string; title?: string; aside?: ReactNode }) {
  const v = weeklyView(md);
  // "Needs you" is copper only when it holds something other than "nothing"
  const needs = v ? v.needs.filter((x) => !/^nothing\b/i.test(x.trim())) : [];
  return (
    <article className="panel upd">
      <div className="head">
        <span className="avatar" aria-hidden="true">
          ER
        </span>
        <div className="grow">
          <div className="who">{title ?? "Epsilon Labs"}</div>
          <div className="m">{title ? `Epsilon Labs · ${meta}` : meta}</div>
        </div>
        {aside}
      </div>
      {v ? (
        <div className="cols">
          <Col title="Done" items={v.done} />
          <Col title="Next" items={v.next} />
          <Col title="Needs you" items={v.needs} need={needs.length > 0} />
        </div>
      ) : (
        <div className="upd-body">
          <UpdateBody md={md} />
        </div>
      )}
    </article>
  );
}
