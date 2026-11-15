import type { CSSProperties, ReactNode } from "react";
import { Badge, Card, Skeleton, cx } from "@/components/ui";

/** Quiet "this part is on its way" note used under placeholder skeletons. */
export function ComingSoon({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 flex items-center justify-center gap-3 text-center text-sm text-sub" data-testid="coming-soon">
      <Badge tone="main">soon</Badge>
      {children}
    </p>
  );
}

const ROWS: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75],
  [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25],
];
// home row: key index → finger token index
const HOME: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 7: 6, 8: 7, 9: 8, 10: 9 };

/** Static keyboard outline drawn with the key + finger tokens. Decorative. */
export function KeyboardSilhouette({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div aria-hidden className={cx("flex w-full flex-col", compact ? "gap-[3px]" : "gap-1 sm:gap-1.5", className)}>
      {ROWS.map((row, r) => (
        <div key={r} className={cx("flex", compact ? "gap-[3px]" : "gap-1 sm:gap-1.5")}>
          {row.map((w, k) => {
            const finger = r === 2 ? HOME[k] : undefined;
            const style: CSSProperties = { flex: `${w} 1 0` };
            if (finger !== undefined) {
              style.backgroundColor = `color-mix(in srgb, var(--finger-${finger}) 34%, var(--key-bg))`;
              style.borderColor = `color-mix(in srgb, var(--finger-${finger}) 55%, var(--key-border))`;
            }
            return (
              <div
                key={k}
                style={style}
                className={cx(
                  "border border-key-border bg-key-bg",
                  compact ? "h-2.5 rounded-[3px]" : "h-6 rounded-[5px] sm:h-10 sm:rounded-ui-sm",
                )}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

const WORDS = [
  [3, 5, 2, 7, 4, 6, 3, 5, 8, 2, 4],
  [6, 2, 4, 9, 3, 5, 4, 2, 7, 5],
  [4, 7, 3, 5, 2, 8, 4, 6, 3, 4, 2],
];

export function TestSkeleton() {
  return (
    <div className="mx-auto flex max-w-[880px] flex-col items-center pt-2 sm:pt-8" data-testid="test-skeleton">
      <div className="flex items-center gap-4 rounded-ui bg-bg-alt px-4 py-2 font-mono text-xs text-sub">
        <span className="text-main">time</span>
        <span>words</span>
        <span className="h-3 w-px bg-border" />
        <span>15</span>
        <span className="text-main">30</span>
        <span>60</span>
        <span>120</span>
      </div>
      <div aria-hidden className="mt-12 w-full space-y-4 overflow-hidden sm:mt-16 sm:space-y-5">
        {WORDS.map((line, l) => (
          <div key={l} className="flex items-center gap-3 sm:gap-4">
            {l === 0 && <span className="-mr-2 h-7 w-[3px] animate-caret rounded-full bg-caret sm:h-8" />}
            {line.map((n, i) => (
              <Skeleton
                key={i}
                className={cx("h-3 shrink-0 rounded-full sm:h-3.5", l === 0 && i < 2 && "bg-text/[0.22]")}
                style={{ width: `${n * 1.55}%` }}
              />
            ))}
          </div>
        ))}
      </div>
      <KeyboardSilhouette className="mt-14 max-w-[640px] sm:mt-20" />
      <ComingSoon>The typing test lands here.</ComingSoon>
    </div>
  );
}

const LESSONS = [
  ["01", "Home row", 100],
  ["02", "Index reaches", 60],
  ["03", "Top row", 20],
  ["04", "Bottom row", 0],
  ["05", "Capitals & shift", 0],
  ["06", "Numbers & symbols", 0],
] as const;

export function LearnSkeleton() {
  return (
    <div data-testid="learn-skeleton">
      <div aria-hidden className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LESSONS.map(([n, name, pct]) => (
          <Card key={n} className={cx(pct === 0 && "opacity-60")}>
            <div className="flex h-[22px] items-center justify-between">
              <span className="font-mono text-xs text-sub">{n}</span>
              {pct === 100 && <Badge tone="success" icon="check">done</Badge>}
            </div>
            <div className="mt-6 text-[15px] font-medium text-text">{name}</div>
            <Skeleton className="mt-2 h-2.5 w-3/4 rounded-full" />
            <div className="mt-6 h-1 overflow-hidden rounded-full bg-text/[0.1]">
              <div className="h-full rounded-full bg-main" style={{ width: `${pct}%` }} />
            </div>
          </Card>
        ))}
      </div>
      <ComingSoon>Guided lessons, one small set of keys at a time.</ComingSoon>
    </div>
  );
}

export function LayoutsSkeleton() {
  return (
    <div data-testid="layouts-skeleton">
      <div aria-hidden className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {["qwerty", "dvorak", "colemak"].map((name, i) => (
          <Card key={name} className={cx(i === 0 && "outline-2 outline-main")}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-text">{name}</span>
              {i === 0 && <Badge tone="main">current</Badge>}
            </div>
            <KeyboardSilhouette compact className="mt-5" />
          </Card>
        ))}
        <Card variant="outline" className="flex min-h-36 items-center justify-center border-dashed text-sm text-sub">
          + custom layout (KLE JSON)
        </Card>
      </div>
      <ComingSoon>Pick a preset or paste your own layout.</ComingSoon>
    </div>
  );
}

const BARS = [28, 34, 31, 42, 39, 47, 44, 52, 49, 58, 55, 63, 60, 66, 71, 68, 74, 72, 79, 83];

export function StatsSkeleton() {
  return (
    <div data-testid="stats-skeleton">
      <div aria-hidden>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {["wpm", "accuracy", "tests", "time typing"].map((label) => (
            <Card key={label}>
              <div className="text-sm text-sub">{label}</div>
              <div className="mt-1.5 font-mono text-4xl leading-none font-medium text-sub/50">–</div>
            </Card>
          ))}
        </div>
        <Card className="mt-3">
          <div className="flex h-48 items-end gap-1.5 sm:gap-2.5">
            {BARS.map((h, i) => (
              <div
                key={i}
                className={cx("flex-1 rounded-t-[3px]", i === BARS.length - 1 ? "bg-main" : "bg-text/[0.09]")}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </Card>
      </div>
      <ComingSoon>Speed, accuracy and per-key history will chart here.</ComingSoon>
    </div>
  );
}
