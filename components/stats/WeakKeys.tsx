"use client";

import { Button, CardDescription, CardTitle } from "@/components/ui";
import type { KeyStatSummary } from "@/lib/stats/store";
import { MIN_KEY_ATTEMPTS, charLabel, type Mixup } from "@/lib/stats/selectors";

function Cap({ ch, large }: { ch: string; large?: boolean }) {
  return (
    <kbd
      className={
        large
          ? "inline-flex size-9 shrink-0 items-center justify-center rounded-ui-sm border border-b-[3px] border-key-border bg-key-bg font-mono text-[15px] font-medium text-key-text"
          : "inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-b-2 border-key-border bg-key-bg px-1.5 font-mono text-[11px] font-medium text-key-text"
      }
    >
      {charLabel(ch)}
    </kbd>
  );
}

export interface WeakKeysProps {
  weakest: KeyStatSummary[];
  mixups: Mixup[];
  /** Average latency over every key, to tell "slow" keys from "missed" ones. */
  overallMs: number | null;
  /** Show a character's key in the heatmap. */
  onInspect: (char: string) => void;
}

export function WeakKeys({ weakest, mixups, overallMs, onInspect }: WeakKeysProps) {
  const worst = Math.max(0.0001, ...weakest.map((k) => k.score));
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <CardTitle>Weakest keys</CardTitle>
          <CardDescription>Ranked by errors and slowness, {MIN_KEY_ATTEMPTS}+ presses.</CardDescription>
        </div>
        {weakest.length > 0 && (
          <Button href="/?practice=weak" variant="primary" size="sm" icon="target" data-testid="practice-weak">
            Practice these
          </Button>
        )}
      </div>

      <div data-testid="weak-keys" data-chars={weakest.map((k) => k.char).join("")} className="mt-4">
        {weakest.length === 0 ? (
          <p className="text-sm text-sub">No weak keys yet. They show up once a key has at least {MIN_KEY_ATTEMPTS} presses and some misses or hesitation.</p>
        ) : (
          <ul className="-mx-2">
            {weakest.map((k) => {
              const attempts = k.hits + k.misses;
              const slowBy = k.avgMs != null && overallMs ? k.avgMs / overallMs : 1;
              // A key is on this list for its misses, for being slow, or both: say which.
              const slow = slowBy >= 1.25 && k.misses / attempts < 0.08;
              return (
              <li key={k.char}>
                <button
                  type="button"
                  data-testid="weak-key"
                  data-char={k.char}
                  data-reason={slow ? "slow" : "errors"}
                  onClick={() => onInspect(k.char)}
                  title="Show on the heatmap"
                  className="flex w-full items-center gap-3 rounded-ui px-2 py-1.5 text-left transition-colors hover:bg-text/[0.05]"
                >
                  <Cap ch={k.char} large />
                  <span className="min-w-0 flex-1">
                    <span className="block h-1.5 rounded-full bg-text/[0.07]">
                      <span className={slow ? "block h-full rounded-full bg-finger-1" : "block h-full rounded-full bg-error"} style={{ width: `${Math.max(4, (k.score / worst) * 100)}%` }} />
                    </span>
                    <span className="mt-1.5 block truncate text-xs text-sub">
                      {slow ? (
                        <>slow: {slowBy.toFixed(1)}× your average latency</>
                      ) : (
                        <>
                          {k.misses} of {attempts} missed
                          {k.mostMistypedAs != null && <> · usually typed {charLabel(k.mostMistypedAs)}</>}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="w-[68px] shrink-0 text-right font-mono text-xs leading-tight tabular-nums">
                    <span className="block text-text">{k.accuracy.toFixed(1)}%</span>
                    <span className="block text-sub">{k.avgMs != null ? `${k.avgMs} ms` : "–"}</span>
                  </span>
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-5 border-t border-border/70 pt-4" data-testid="mixups">
        <h4 className="text-[13px] font-semibold text-text">Common mix-ups</h4>
        {mixups.length === 0 ? (
          <p className="mt-2 text-sm text-sub">No mistypes recorded yet.</p>
        ) : (
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {mixups.map((m) => (
              <li key={`${m.expected}>${m.typed}`} data-testid="mixup" className="flex items-center gap-1.5 text-[13px] text-sub">
                typed <Cap ch={m.typed} /> instead of <Cap ch={m.expected} />
                <span className="ml-auto font-mono text-text tabular-nums">×{m.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
