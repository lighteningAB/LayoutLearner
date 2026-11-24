import type { CSSProperties, ReactNode } from "react";
import { Badge, Card, ProgressBar, Skeleton, cx } from "@/components/ui";

/** Quiet "this part is on its way" note used under placeholder skeletons. */
export function ComingSoon({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 flex items-center justify-center gap-3 text-center text-base text-sub" data-testid="coming-soon">
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
            if (finger !== undefined) style.backgroundColor = `var(--finger-${finger})`;
            return (
              <div
                key={k}
                style={style}
                className={cx(
                  "border border-key-border",
                  compact ? "h-2.5" : "h-6 sm:h-10",
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
      <div className="flex items-center gap-4 border-y border-border px-4 py-2 text-base text-sub">
        <span className="text-main underline decoration-2 underline-offset-[6px]">time</span>
        <span>words</span>
        <span className="h-3 w-px bg-border" />
        <span>15</span>
        <span className="text-main underline decoration-2 underline-offset-[6px]">30</span>
        <span>60</span>
        <span>120</span>
      </div>
      <div aria-hidden className="mt-12 w-full space-y-4 overflow-hidden sm:mt-16 sm:space-y-5">
        {WORDS.map((line, l) => (
          <div key={l} className="flex items-center gap-3 sm:gap-4">
            {l === 0 && <span className="-mr-2 h-7 w-[3px] animate-caret bg-caret sm:h-8" />}
            {line.map((n, i) => (
              <Skeleton
                key={i}
                className={cx("h-3 shrink-0 sm:h-3.5", l === 0 && i < 2 && "bg-text/[0.3]")}
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
          <Card key={n} variant={pct === 0 ? "outline" : "solid"} className={cx(pct === 0 && "border-dashed")}>
            <div className="flex h-[22px] items-center justify-between">
              <span className="ll-readout text-sm text-sub">{n}</span>
              {pct === 100 && <Badge tone="success" icon="check">done</Badge>}
            </div>
            <div className="mt-6 text-lg font-semibold text-text">{name}</div>
            <Skeleton className="mt-2 h-2.5 w-3/4" />
            <ProgressBar className="mt-6" value={pct} />
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
          <Card key={name} className={cx(i === 0 && "outline-2 outline-offset-2 outline-main")}>
            <div className="flex items-center justify-between">
              <span className="ll-lettering-lg text-text">{name}</span>
              {i === 0 && <Badge tone="main">current</Badge>}
            </div>
            <KeyboardSilhouette compact className="mt-5" />
          </Card>
        ))}
        <Card variant="outline" className="flex min-h-36 items-center justify-center border-dashed text-base text-sub">
          + custom layout (KLE JSON)
        </Card>
      </div>
      <ComingSoon>Pick a preset or paste your own layout.</ComingSoon>
    </div>
  );
}
