import type { ReactNode } from "react";
import { hasSignal } from "@/lib/series";
import { RetryButton } from "./Note";
import { Sparkline } from "./Sparkline";

/** A KPI tile (design review D1/D4/D10): label, mono value, a context line, an optional delta and a sparkline that is
 *  drawn only when the series has signal (3+ non-zero points). Zero is shown as zero with its context, never hidden;
 *  only a failed query shows "–" with a Retry. */
export function KpiTile({
  label, value, context, delta, series, seriesLabel, error,
}: {
  label: string;
  value: ReactNode;
  context?: ReactNode;
  delta?: { text: string; dir: "up" | "down" | "flat" } | null;
  series?: number[];
  seriesLabel?: string;
  error?: boolean;
}) {
  const spark = !error && series && hasSignal(series);
  return (
    <div className="panel tile">
      <div className="l">
        <div className="k">{label}</div>
        <div className="v big num">{error ? "–" : value}</div>
        <div className="d">
          {error ? (
            <>
              Couldn&apos;t load · <RetryButton />
            </>
          ) : (
            <>
              {context}
              {delta && (
                <span className={`delta ${delta.dir}`}>
                  {context ? " · " : ""}
                  {delta.text}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {spark ? <Sparkline data={series} label={seriesLabel ?? `${label}, last ${series.length} days`} /> : <div className="spark spark-flat" aria-hidden="true" />}
    </div>
  );
}
