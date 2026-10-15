// Loading skeletons for the admin loading.tsx files (system.css .skel shimmer), shaped like each page's first screen.
// aria-busy on the wrapper; the shimmer stops under reduced motion (system.css).

const W = ["w-70", "w-50", "w-30", "w-60", "w-40"];

export function SkelPage({ children, label = "Loading" }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="skel-page" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

/** Page header: optional breadcrumb line, a title and a subtitle line, an action on the right. */
export function SkelHead({ crumbs, action = true }: { crumbs?: boolean; action?: boolean }) {
  return (
    <div className="skel-head">
      <div className="grow">
        {crumbs && <div className="skel line w-30" />}
        <div className="skel title" />
        <div className="skel line w-50" />
      </div>
      {action && <div className="skel btn-s" />}
    </div>
  );
}

/** A row of KPI-like tiles. */
export function SkelTiles({ n = 4, tall }: { n?: number; tall?: boolean }) {
  return (
    <div className="skel-tiles" style={{ ["--n" as string]: n }}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`panel skel-tile${tall ? " tall" : ""}`}>
          <div className="skel line w-40" />
          <div className="skel num" />
          <div className="skel line w-60" />
        </div>
      ))}
    </div>
  );
}

/** A panel with a head and `n` list rows (tables, queues, timelines). */
export function SkelRows({ n = 6, head = true }: { n?: number; head?: boolean }) {
  return (
    <div className="panel skel-rows">
      {head && <div className="skel line w-30 skel-ph" />}
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skel-row">
          <div className="skel ic" />
          <div className="grow">
            <div className={`skel line ${W[i % W.length]}`} />
            <div className="skel line sm w-30" />
          </div>
          <div className="skel line sm w-10" />
        </div>
      ))}
    </div>
  );
}

/** A plain panel of a given height. */
export function SkelPanel({ h = 160 }: { h?: number }) {
  return <div className="panel skel-panel" style={{ height: h }}><div className="skel line w-30" /></div>;
}
