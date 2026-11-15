"use client";
// What you see when a test (or lesson drill) ends: the two numbers that matter, the supporting
// stats, a per-second chart, the keys that tripped you up and what to do next.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { HistoryPoint, TestResult } from "@/lib/typing/engine";
import type { ParsedLayout } from "@/lib/types";
import { useSettings } from "@/lib/settings";
import { Button, Kbd, cx } from "@/components/ui";
import { guideForChar } from "./KeyboardGuide";
import { weakCharsOfResult } from "./practice";
import "./typing.css";

export interface ResultsViewProps {
  result: TestResult;
  /** Layout the test was typed on (finger colours of the weak keys). */
  layout: ParsedLayout;
  layoutName: string;
  /** Headline of the "test" cell. Default: "time 30" / "words 25" from the result. */
  testLabel?: string;
  /** Second line of the "test" cell: "english 200 · punctuation". */
  testDetail?: string;
  /** Default: settings.fingerColors. */
  fingerColors?: boolean;
  /** Primary action (Enter, or Tab then Enter). */
  onNext: () => void;
  /** Label of the primary action. Default "Next test". */
  nextLabel?: string;
  /** Same words again. Hidden when omitted. */
  onRepeat?: () => void;
  /** Start a drill made of these characters (the weakest of this result). Hidden when omitted. */
  onPracticeKeys?: (chars: string[]) => void;
  /** Link of the "Lessons" action; null hides it. Default "/learn". */
  lessonsHref?: string | null;
  /** Extra buttons after the built-in actions. */
  actions?: ReactNode;
  /** Rendered between the stats and the actions (lessons: stars, goal, unlocked keys…). */
  children?: ReactNode;
  /** Enter = next, Tab = focus the primary action. Default true. */
  hotkeys?: boolean;
  className?: string;
}

const fmt = (n: number) => String(Math.round(n));

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return Number.isInteger(Math.round(s * 10) / 10) ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${String(rest).padStart(2, "0")}s`;
}

// ────────────────────────────────────────────────────────────────────────── chart

function niceStep(max: number, ticks: number): number {
  const raw = Math.max(max, 1) / ticks;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** Smooth, monotone-in-x path through the points. */
function curve(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const mx = ((a.x + b.x) / 2).toFixed(1);
    d += ` C${mx},${a.y.toFixed(1)} ${mx},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  return d;
}

export interface ResultChartProps {
  history: readonly HistoryPoint[];
  height?: number;
  className?: string;
}

/** wpm (cumulative) and raw (that second alone) per second on one shared axis, with error marks. */
export function ResultChart({ history, height = 200, className }: ResultChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = { l: 36, r: 10, t: 28, b: 24 };
  const w = Math.max(width, 120);
  const pw = w - m.l - m.r;
  const ph = height - m.t - m.b;

  const model = useMemo(() => {
    const pts = history.filter((h) => Number.isFinite(h.t) && Number.isFinite(h.wpm) && Number.isFinite(h.raw));
    if (pts.length === 0) return null;
    const tMin = Math.min(1, pts[0].t);
    const tMax = pts[pts.length - 1].t;
    // A wild final half-second must not flatten the rest of the chart.
    const sortedRaw = pts.map((p) => p.raw).sort((a, b) => a - b);
    const typicalRaw = sortedRaw[Math.floor((sortedRaw.length - 1) * 0.9)];
    const peak = Math.max(...pts.map((p) => p.wpm), typicalRaw * 1.15, 10);
    const step = niceStep(peak, 4);
    const yMax = Math.ceil(peak / step) * step;
    const x = (t: number) => (tMax === tMin ? m.l + pw / 2 : m.l + ((t - tMin) / (tMax - tMin)) * pw);
    const y = (v: number) => m.t + ph - (Math.min(v, yMax) / yMax) * ph;
    const yTicks: number[] = [];
    for (let v = 0; v <= yMax + 1e-6; v += step) yTicks.push(Math.round(v * 100) / 100);
    const span = Math.max(1, Math.floor(tMax));
    const xStep = Math.max(1, niceStep(span, Math.max(2, Math.min(8, Math.floor(pw / 56)))));
    const xTicks: number[] = [];
    for (let t = Math.ceil(tMin / xStep) * xStep || xStep; t <= tMax + 1e-6; t += xStep) xTicks.push(Math.round(t));
    if (xTicks.length === 0) xTicks.push(Math.round(tMax * 10) / 10);
    return { pts, x, y, yTicks, xTicks, yMax };
  }, [history, pw, ph, m.l, m.t]);

  if (!model) {
    return (
      <div ref={boxRef} className={cx("flex items-center justify-center text-sm text-sub", className)} style={{ height }}>
        Not enough data for a chart.
      </div>
    );
  }

  const { pts, x, y, yTicks, xTicks } = model;
  const wpmPts = pts.map((p) => ({ x: x(p.t), y: y(p.wpm) }));
  const rawPts = pts.map((p) => ({ x: x(p.t), y: y(p.raw) }));
  const wpmPath = curve(wpmPts);
  const baseY = m.t + ph;
  const areaPath = wpmPts.length > 1 ? `${wpmPath} L${wpmPts[wpmPts.length - 1].x.toFixed(1)},${baseY} L${wpmPts[0].x.toFixed(1)},${baseY} Z` : "";
  const single = pts.length === 1;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    wpmPts.forEach((p, i) => {
      const d = Math.abs(p.x - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover != null ? pts[hover] : null;
  const hx = hover != null ? wpmPts[hover].x : 0;
  const tipLeft = Math.min(Math.max(hx, 70), w - 70);

  return (
    <div className={cx("tt-chart", className)} data-testid="result-chart">
      <div className="mb-1 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 pr-2 text-xs text-sub">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-[3px] w-4 rounded-full bg-main" />
          wpm
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-[2px] w-4 rounded-full bg-sub" />
          raw
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="9" height="9" viewBox="-4.5 -4.5 9 9">
            <path d="M-3,-3 L3,3 M-3,3 L3,-3" stroke="var(--error)" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          errors
        </span>
      </div>
      <div ref={boxRef} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg
            width={w}
            height={height}
            viewBox={`0 0 ${w} ${height}`}
            role="img"
            aria-label="Words per minute and raw speed for every second of the test"
            className="block touch-none"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--main)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--main)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth="1" strokeDasharray={v === 0 ? undefined : "2 4"} />
                <text x={m.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
                  {v}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t} x={x(t)} y={height - 6} textAnchor="middle">
                {t}
                {t === xTicks[xTicks.length - 1] ? "s" : ""}
              </text>
            ))}

            {areaPath && <path d={areaPath} fill={`url(#${gradId})`} />}
            {!single && <path d={curve(rawPts)} fill="none" stroke="var(--sub)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />}
            {!single && (
              <path className="tt-draw" pathLength={1} d={wpmPath} fill="none" stroke="var(--main)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {single && (
              <>
                <circle cx={rawPts[0].x} cy={rawPts[0].y} r="4" fill="var(--sub)" stroke="var(--bg)" strokeWidth="2" />
                <circle cx={wpmPts[0].x} cy={wpmPts[0].y} r="4.5" fill="var(--main)" stroke="var(--bg)" strokeWidth="2" />
              </>
            )}

            {pts.map((p, i) =>
              p.errors > 0 ? (
                <g key={i} transform={`translate(${Math.max(wpmPts[i].x, m.l + 5).toFixed(1)},${m.t - 16})`} data-testid="chart-error">
                  {(() => {
                    const s = p.errors > 2 ? 3.6 : 2.8;
                    return <path d={`M${-s},${-s} L${s},${s} M${-s},${s} L${s},${-s}`} stroke="var(--error)" strokeWidth={p.errors > 2 ? 2 : 1.6} strokeLinecap="round" />;
                  })()}
                </g>
              ) : null,
            )}

            {hp && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={m.t - 2} y2={baseY} stroke="var(--sub)" strokeWidth="1" opacity="0.6" />
                <circle cx={hx} cy={rawPts[hover as number].y} r="4" fill="var(--sub)" stroke="var(--bg)" strokeWidth="2" />
                <circle cx={hx} cy={wpmPts[hover as number].y} r="4.5" fill="var(--main)" stroke="var(--bg)" strokeWidth="2" />
              </g>
            )}
          </svg>
        )}
        {hp && (
          <div
            role="status"
            data-testid="chart-tooltip"
            className="pointer-events-none absolute top-0 z-10 w-[132px] -translate-x-1/2 rounded-ui-sm border border-border bg-bg-alt px-2.5 py-2 font-mono text-[11px] leading-[1.5] text-sub shadow-pop"
            style={{ left: tipLeft, top: Math.max(0, Math.min(wpmPts[hover as number].y, rawPts[hover as number].y) - 84) }}
          >
            <div className="mb-0.5 text-text">{Number.isInteger(hp.t) ? hp.t : hp.t.toFixed(1)}s</div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-main" />
                wpm
              </span>
              <span className="text-text tabular-nums">{fmt(hp.wpm)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-sub" />
                raw
              </span>
              <span className="text-text tabular-nums">{fmt(hp.raw)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-error">×</span>
                errors
              </span>
              <span className="text-text tabular-nums">{hp.errors}</span>
            </div>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Speed per second</caption>
        <thead>
          <tr>
            <th>second</th>
            <th>wpm</th>
            <th>raw</th>
            <th>errors</th>
          </tr>
        </thead>
        <tbody>
          {pts.map((p) => (
            <tr key={p.t}>
              <td>{p.t}</td>
              <td>{fmt(p.wpm)}</td>
              <td>{fmt(p.raw)}</td>
              <td>{p.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────── view

function Small({ label, value, sub, title, i, testId, dense }: { label: string; value: ReactNode; sub?: ReactNode; title?: string; i: number; testId?: string; dense?: boolean }) {
  return (
    <div className="tt-rise min-w-0" style={{ "--i": i } as CSSProperties} title={title} data-testid={testId}>
      <div className="text-xs text-sub lowercase">{label}</div>
      <div className={cx("mt-1 flex h-8 items-center truncate font-mono leading-tight font-medium text-text tabular-nums", dense ? "text-lg tracking-tight sm:text-xl" : "text-xl sm:text-2xl")}>
        <span className="truncate">{value}</span>
      </div>
      {sub && <div className="mt-0.5 text-xs whitespace-nowrap text-sub">{sub}</div>}
    </div>
  );
}

export function ResultsView({
  result,
  layout,
  layoutName,
  testLabel,
  testDetail,
  fingerColors,
  onNext,
  nextLabel = "Next test",
  onRepeat,
  onPracticeKeys,
  lessonsHref = "/learn",
  actions,
  children,
  hotkeys = true,
  className,
}: ResultsViewProps) {
  const [settings] = useSettings();
  const colors = fingerColors ?? settings.fingerColors;
  const rootRef = useRef<HTMLElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;

  const weak = useMemo(() => weakCharsOfResult(result, 6), [result]);
  const weakChars = useMemo(() => weak.map((k) => k.char), [weak]);

  useEffect(() => {
    if (!hotkeys) return;
    const mountedAt = performance.now();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (document.querySelector('[data-ll-modal], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Tab" && !e.shiftKey) {
        // Tab from anywhere outside the results lands on the primary action (so Tab, Enter = next).
        if (t && rootRef.current?.contains(t) && t !== rootRef.current) return;
        e.preventDefault();
        nextRef.current?.focus();
      } else if (e.key === "Enter") {
        if (t && t.closest("button, a[href], [role='button'], summary")) return; // the control handles it
        if (performance.now() - mountedAt < 350) return; // still mid-flow from the test
        e.preventDefault();
        onNextRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotkeys]);

  const { chars } = result;
  const label = testLabel ?? `${result.mode} ${result.modeValue}`;

  return (
    <section
      ref={rootRef}
      className={cx("mx-auto w-full max-w-[980px]", className)}
      data-testid="results"
      data-wpm={result.wpm}
      data-accuracy={result.accuracy}
      aria-label="Test result"
    >
      <div className="grid items-center gap-x-10 gap-y-6 md:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-end gap-10 md:flex-col md:items-start md:gap-6">
          <div className="tt-rise" style={{ "--i": 0 } as CSSProperties}>
            <div className="flex h-6 items-center text-sm text-sub">wpm</div>
            <div
              className="mt-1 font-mono text-[64px] leading-none font-medium tracking-tight text-main tabular-nums sm:text-[80px]"
              data-testid="result-wpm"
              title={`${result.wpm.toFixed(2)} wpm`}
            >
              {fmt(result.wpm)}
            </div>
          </div>
          <div className="tt-rise" style={{ "--i": 1 } as CSSProperties}>
            <div className="flex h-6 items-center text-sm text-sub">accuracy</div>
            <div
              className="mt-1 font-mono text-[64px] leading-none font-medium tracking-tight text-main tabular-nums sm:text-[80px]"
              data-testid="result-acc"
              title={`${result.accuracy.toFixed(2)}% (${result.keystrokes.correct} correct, ${result.keystrokes.incorrect} incorrect keystrokes)`}
            >
              {Math.floor(result.accuracy)}
              <span className="ml-0.5 text-[0.45em] font-normal text-sub">%</span>
            </div>
          </div>
        </div>
        <div className="tt-rise min-w-0" style={{ "--i": 2 } as CSSProperties}>
          <ResultChart history={result.history} />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
        <Small i={3} label="raw" value={fmt(result.raw)} title={`${result.raw.toFixed(2)} wpm counting every keystroke`} testId="result-raw" />
        <Small i={4} label="consistency" value={`${fmt(result.consistency)}%`} title="How steady your speed was from second to second" testId="result-consistency" />
        <Small
          i={5}
          label="characters"
          dense
          testId="result-chars"
          title="correct / incorrect / extra / missed"
          value={
            <>
              {chars.correct}
              <span className="text-sub">/</span>
              <span className={chars.incorrect ? "text-error" : undefined}>{chars.incorrect}</span>
              <span className="text-sub">/</span>
              {chars.extra}
              <span className="text-sub">/</span>
              {chars.missed}
            </>
          }
          sub="right/wrong/extra/missed"
        />
        <Small i={6} label="time" value={formatDuration(result.durationMs)} sub={`${result.wordsTyped} ${result.wordsTyped === 1 ? "word" : "words"}`} testId="result-time" />
        <Small i={7} label="test" value={label} sub={testDetail} testId="result-type" />
        <Small i={8} label="layout" value={layoutName} testId="result-layout" />
      </div>

      <div className="tt-rise mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border pt-6" style={{ "--i": 9 } as CSSProperties} data-testid="result-weak-keys">
        <div className="text-sm text-sub">Keys to work on</div>
        {weak.length === 0 ? (
          <div className="text-sm text-text">None this time: a clean, even run.</div>
        ) : (
          <ul className="flex flex-wrap items-center gap-2">
            {weak.map((k) => {
              const g = guideForChar(layout, k.char);
              const fc = colors && g && g.fingerIndex >= 0 ? `var(--finger-${g.fingerIndex})` : "var(--key-border)";
              const why = k.misses > 0 ? `${Math.round(k.accuracy)}%` : k.avgMs != null ? `${k.avgMs}ms` : "";
              return (
                <li
                  key={k.char}
                  data-testid="weak-key"
                  data-char={k.char}
                  title={
                    `${k.char}: ${k.misses} ${k.misses === 1 ? "miss" : "misses"} in ${k.hits + k.misses}` +
                    (k.mostMistypedAs ? `, usually typed as ${k.mostMistypedAs === " " ? "space" : k.mostMistypedAs}` : "") +
                    (k.avgMs != null ? `, ${k.avgMs} ms on average` : "") +
                    (g?.fingerName ? ` (${g.fingerName})` : "")
                  }
                  className="flex items-center gap-1.5 rounded-ui-sm bg-text/[0.05] py-1 pr-2 pl-1"
                >
                  <span
                    className="inline-flex size-7 items-center justify-center rounded-[6px] border border-b-[3px] border-key-border bg-key-bg font-mono text-sm font-medium text-text"
                    style={{ borderBottomColor: fc }}
                  >
                    {k.char}
                  </span>
                  <span className={cx("font-mono text-xs tabular-nums", k.misses > 0 ? "text-error" : "text-sub")}>{why}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {children}

      <div className="tt-rise mt-8 flex flex-wrap items-center justify-center gap-2" style={{ "--i": 10 } as CSSProperties}>
        <Button ref={nextRef} variant="primary" iconRight="chevron-right" onClick={onNext} data-testid="result-next">
          {nextLabel}
        </Button>
        {onRepeat && (
          <Button variant="ghost" icon="restart" onClick={onRepeat} data-testid="result-repeat">
            Repeat
          </Button>
        )}
        {onPracticeKeys && (
          <Button
            variant="ghost"
            icon="target"
            disabled={weakChars.length === 0}
            title={weakChars.length === 0 ? "No weak keys in this result" : `A drill built from ${weakChars.join(" ")}`}
            onClick={() => onPracticeKeys(weakChars)}
            data-testid="result-practice"
          >
            Practice weak keys
          </Button>
        )}
        {lessonsHref && (
          <Button variant="ghost" icon="graduation" href={lessonsHref} data-testid="result-lessons">
            Lessons
          </Button>
        )}
        {actions}
      </div>
      {hotkeys && (
        <p className="tt-rise mt-4 hidden items-center justify-center gap-1.5 text-xs text-sub sm:flex" style={{ "--i": 11 } as CSSProperties}>
          <Kbd size="sm">enter</Kbd>
          <span className="mr-2">{nextLabel.toLowerCase()}</span>
        </p>
      )}
    </section>
  );
}

export default ResultsView;
