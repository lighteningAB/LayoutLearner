import { CardDescription, CardTitle, cx } from "@/components/ui";
import type { Hand } from "@/lib/types";
import type { FingerAggregate, FingerBreakdown as Breakdown } from "@/lib/stats/selectors";

const HAND_NAME: Record<Hand, string> = { L: "Left hand", R: "Right hand" };

function FingerRow({ f, maxErrorRate, maxMs }: { f: FingerAggregate; maxErrorRate: number; maxMs: number }) {
  const color = `var(--finger-${f.index})`;
  const used = f.attempts > 0;
  const errW = used && maxErrorRate > 0 ? Math.max(2, (f.errorRate / maxErrorRate) * 100) : 0;
  const msW = used && f.avgMs != null && maxMs > 0 ? Math.max(2, (f.avgMs / maxMs) * 100) : 0;
  return (
    <li
      data-testid="finger-row"
      data-finger={`${f.hand}-${f.finger}`}
      data-accuracy={used ? f.accuracy.toFixed(2) : ""}
      className={cx("grid grid-cols-[68px_minmax(0,1fr)_auto] items-center gap-x-4", !used && "opacity-45")}
    >
      <span className="flex items-center gap-1.5 text-[13px] text-text">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        {f.finger}
      </span>
      <span className="flex flex-col gap-1" aria-hidden>
        <span className="h-2 rounded-full bg-text/[0.07]">
          <span className="block h-full rounded-full" style={{ width: `${errW}%`, background: color }} />
        </span>
        <span className="h-1 rounded-full bg-text/[0.07]">
          <span className="block h-full rounded-full" style={{ width: `${msW}%`, background: color, opacity: 0.5 }} />
        </span>
      </span>
      <span className="flex w-[118px] justify-end gap-3 font-mono text-xs tabular-nums">
        {used ? (
          <>
            <span className="text-text">{f.accuracy.toFixed(1)}%</span>
            <span className="w-[52px] text-right text-sub">{f.avgMs != null ? `${Math.round(f.avgMs)} ms` : "–"}</span>
          </>
        ) : (
          <span className="text-sub">no data</span>
        )}
      </span>
    </li>
  );
}

/** Per-finger error rate (thick bar) and latency (thin bar) in the finger colours, split by hand. */
export function FingerBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const { hands, fingers, maxErrorRate, maxMs } = breakdown;
  const total = hands.L.attempts + hands.R.attempts;
  const leftPct = total > 0 ? Math.round(hands.L.share * 100) : 50;
  return (
    <div data-testid="finger-breakdown">
      <CardTitle>Fingers and hands</CardTitle>
      <CardDescription>Thick bar: error rate. Thin bar: average latency. Longer means weaker.</CardDescription>

      {total === 0 ? (
        <p className="mt-5 text-sm text-sub">No per-key data yet.</p>
      ) : (
        <>
          <div className="mt-5" data-testid="hand-balance" data-left={leftPct}>
            <div className="flex justify-between text-xs text-sub">
              <span>
                left <span className="font-mono text-text tabular-nums">{leftPct}%</span>
              </span>
              <span>share of keystrokes</span>
              <span>
                <span className="font-mono text-text tabular-nums">{100 - leftPct}%</span> right
              </span>
            </div>
            <div className="mt-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full">
              <span className="rounded-l-full bg-finger-3" style={{ width: `${leftPct}%` }} />
              <span className="flex-1 rounded-r-full bg-finger-6" />
            </div>
          </div>

          <div className="mt-6 space-y-6">
            {(["L", "R"] as const).map((hand) => {
              const h = hands[hand];
              const list = fingers.filter((f) => f.hand === hand);
              return (
                <div key={hand} data-testid={`hand-${hand}`} data-accuracy={h.attempts ? h.accuracy.toFixed(2) : ""}>
                  <div className="flex items-baseline justify-between gap-2 border-b border-border/70 pb-2">
                    <h4 className="text-[13px] font-semibold text-text">{HAND_NAME[hand]}</h4>
                    <span className="font-mono text-xs text-sub tabular-nums">
                      {h.attempts ? `${h.accuracy.toFixed(1)}% · ${h.avgMs != null ? `${Math.round(h.avgMs)} ms` : "–"}` : "no data"}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-2.5">
                    {list.map((f) => (
                      <FingerRow key={f.index} f={f} maxErrorRate={maxErrorRate} maxMs={maxMs} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
