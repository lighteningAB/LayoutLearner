"use client";
// What you see when a test (or lesson drill) ends, drawn as a results sheet: the two numbers that
// matter as large numerals, a drafted per-second graph, the supporting stats as a ruled table,
// the keys that tripped you up and what to do next.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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

  const m = { l: 40, r: 12, t: 30, b: 26 };
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
  const baseY = m.t + ph;
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
  const tipLeft = Math.min(Math.max(hx, 76), w - 76);
  const polyline = (ps: { x: number; y: number }[]) => ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const errorTotal = pts.reduce((n, p) => n + p.errors, 0);

  return (
    <div className={cx("tt-chart", className)} data-testid="result-chart">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-5 gap-y-1">
        <h3 className="ll-lettering text-text">Speed per second</h3>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-sub" aria-label="Legend">
          <li className="inline-flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-5 bg-text" />
            wpm
          </li>
          <li className="inline-flex items-center gap-2">
            <span aria-hidden className="w-5 border-t border-dashed border-sub" />
            raw
          </li>
          <li className="inline-flex items-center gap-2">
            <svg aria-hidden width="9" height="9" viewBox="-4.5 -4.5 9 9">
              <path d="M-3.5,-3.5 L3.5,3.5 M-3.5,3.5 L3.5,-3.5" stroke="var(--error)" strokeWidth="1.5" />
            </svg>
            errors ({errorTotal})
          </li>
        </ul>
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
            {/* construction lines */}
            {yTicks.map((v) =>
              v === 0 ? null : <line key={v} x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="var(--hairline)" strokeWidth="1" strokeDasharray="1 5" />,
            )}
            {/* axes with ticks */}
            <path d={`M${m.l},${m.t - 8} V${baseY} H${w - m.r}`} fill="none" stroke="var(--line)" strokeWidth="1" />
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={m.l - 4} x2={m.l} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth="1" />
                <text x={m.l - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
                  {v}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={baseY} y2={baseY + 4} stroke="var(--line)" strokeWidth="1" />
                <text x={x(t)} y={baseY + 17} textAnchor="middle">
                  {t}
                  {t === xTicks[xTicks.length - 1] ? "s" : ""}
                </text>
              </g>
            ))}
            <text className="tt-chart-title" x={m.l + 8} y={m.t - 12}>
              wpm
            </text>

            {!single && <polyline points={polyline(rawPts)} fill="none" stroke="var(--sub)" strokeWidth="1" strokeDasharray="4 3" />}
            {!single && <polyline className="tt-draw" pathLength={1} points={polyline(wpmPts)} fill="none" stroke="var(--text)" strokeWidth="2" strokeLinejoin="miter" />}
            {wpmPts.length <= 40 &&
              wpmPts.map((p, i) => <rect key={i} x={p.x - 2.5} y={p.y - 2.5} width="5" height="5" fill="var(--bg)" stroke="var(--text)" strokeWidth="1" />)}
            {single && <rect x={rawPts[0].x - 3} y={rawPts[0].y - 3} width="6" height="6" fill="var(--bg)" stroke="var(--sub)" strokeWidth="1" />}

            {pts.map((p, i) =>
              p.errors > 0 ? (
                <g key={i} transform={`translate(${Math.max(wpmPts[i].x, m.l + 6).toFixed(1)},${(wpmPts[i].y - 13).toFixed(1)})`} data-testid="chart-error">
                  {(() => {
                    const s = p.errors > 2 ? 4.5 : 3.5;
                    return <path d={`M${-s},${-s} L${s},${s} M${-s},${s} L${s},${-s}`} stroke="var(--error)" strokeWidth={p.errors > 2 ? 2 : 1.5} />;
                  })()}
                </g>
              ) : null,
            )}

            {hp && (
              <g pointerEvents="none">
                <line x1={hx} x2={hx} y1={m.t - 8} y2={baseY} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
                <rect x={hx - 3.5} y={rawPts[hover as number].y - 3.5} width="7" height="7" fill="var(--bg)" stroke="var(--sub)" strokeWidth="1.5" />
                <rect x={hx - 3.5} y={wpmPts[hover as number].y - 3.5} width="7" height="7" fill="var(--text)" />
              </g>
            )}
          </svg>
        )}
        {hp && (
          <div
            role="status"
            data-testid="chart-tooltip"
            className="pointer-events-none absolute top-0 z-10 w-[144px] -translate-x-1/2 border border-line bg-bg px-2.5 py-2 font-mono text-[12px] leading-[1.5] text-sub"
            style={{ left: tipLeft, top: Math.max(0, Math.min(wpmPts[hover as number].y, rawPts[hover as number].y) - 96) }}
          >
            <div className="mb-0.5 border-b border-hairline pb-0.5 text-text">{Number.isInteger(hp.t) ? hp.t : hp.t.toFixed(1)}s</div>
            <div className="flex items-center justify-between gap-2">
              <span>wpm</span>
              <span className="text-text tabular-nums">{fmt(hp.wpm)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>raw</span>
              <span className="text-text tabular-nums">{fmt(hp.raw)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>errors</span>
              <span className={cx("tabular-nums", hp.errors > 0 ? "text-error" : "text-text")}>{hp.errors}</span>
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

/** One ruled row of the results table. */
function Row({ label, value, sub, title, i, testId }: { label: string; value: ReactNode; sub?: ReactNode; title?: string; i: number; testId?: string }) {
  return (
    <div className="tt-rise grid grid-cols-[128px_minmax(0,1fr)] border-b border-border last:border-b-0" style={{ "--i": i } as CSSProperties} title={title} data-testid={testId}>
      <dt className="ll-lettering-sm border-r border-border px-3 py-2.5 text-sub">{label}</dt>
      <dd className="min-w-0 px-3 py-2">
        <span className="ll-readout block truncate text-[17px] leading-tight font-medium text-text">{value}</span>
        {sub && <span className="mt-0.5 block truncate text-[13px] leading-tight text-sub">{sub}</span>}
      </dd>
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
  const headline = "ll-numeral text-[72px] text-text sm:text-[104px]";

  return (
    <section ref={rootRef} className={cx("w-full", className)} data-testid="results" data-wpm={result.wpm} data-accuracy={result.accuracy} aria-label="Test result">
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-x-12 gap-y-4 border-b border-hairline pb-5">
            <div className="tt-rise" style={{ "--i": 0 } as CSSProperties}>
              <div className={headline} data-testid="result-wpm" title={`${result.wpm.toFixed(2)} wpm`}>
                {fmt(result.wpm)}
              </div>
              <div className="ll-lettering mt-2 text-sub">Words per minute</div>
            </div>
            <div className="tt-rise" style={{ "--i": 1 } as CSSProperties}>
              <div
                className={headline}
                data-testid="result-acc"
                title={`${result.accuracy.toFixed(2)}% (${result.keystrokes.correct} correct, ${result.keystrokes.incorrect} incorrect keystrokes)`}
              >
                {Math.floor(result.accuracy)}
                <span className="ml-1 text-[0.4em] text-sub">%</span>
              </div>
              <div className="ll-lettering mt-2 text-sub">Accuracy</div>
            </div>
          </div>
          <div className="tt-rise mt-6 min-w-0" style={{ "--i": 2 } as CSSProperties}>
            <ResultChart history={result.history} height={240} />
          </div>
        </div>

        <div className="min-w-0">
          <dl className="border border-line">
            <Row i={3} label="Raw" value={`${fmt(result.raw)} wpm`} sub="every keystroke counted" title={`${result.raw.toFixed(2)} wpm counting every keystroke`} testId="result-raw" />
            <Row i={4} label="Consistency" value={`${fmt(result.consistency)}%`} sub="steadiness, second to second" title="How steady your speed was from second to second" testId="result-consistency" />
            <Row
              i={5}
              label="Characters"
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
              sub="right / wrong / extra / missed"
            />
            <Row i={6} label="Time" value={formatDuration(result.durationMs)} sub={`${result.wordsTyped} ${result.wordsTyped === 1 ? "word" : "words"}`} testId="result-time" />
            <Row i={7} label="Test" value={label} sub={testDetail} testId="result-type" />
            <Row i={8} label="Layout" value={layoutName} testId="result-layout" />
          </dl>

          <div className="tt-rise mt-6" style={{ "--i": 9 } as CSSProperties} data-testid="result-weak-keys">
            <h3 className="ll-lettering text-text">Keys to work on</h3>
            {weak.length === 0 ? (
              <p className="mt-2 text-[15px] text-sub">None this time: a clean, even run.</p>
            ) : (
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {weak.map((k) => {
                  const g = guideForChar(layout, k.char);
                  const hasFinger = !!g && g.fingerIndex >= 0;
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
                      className="flex min-w-0 items-center gap-2 border border-border pr-2"
                    >
                      <span
                        className="inline-flex size-8 shrink-0 items-center justify-center border-r border-border font-mono text-[15px] font-semibold"
                        style={colors && hasFinger ? { backgroundColor: `var(--finger-${g.fingerIndex})`, color: "var(--finger-fg)" } : undefined}
                      >
                        {k.char}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-sub">{g?.fingerName || "any finger"}</span>
                      <span className={cx("ll-readout text-[13px]", k.misses > 0 ? "text-error" : "text-text")}>{why}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {children}

      <div className="tt-rise mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-5" style={{ "--i": 10 } as CSSProperties}>
        <Button ref={nextRef} variant="primary" iconRight="chevron-right" onClick={onNext} data-testid="result-next">
          {nextLabel}
        </Button>
        {onPracticeKeys && (
          <Button
            variant="subtle"
            icon="target"
            disabled={weakChars.length === 0}
            title={weakChars.length === 0 ? "No weak keys in this result" : `A drill built from ${weakChars.join(" ")}`}
            onClick={() => onPracticeKeys(weakChars)}
            data-testid="result-practice"
          >
            Practice weak keys
          </Button>
        )}
        {onRepeat && (
          <Button variant="ghost" icon="restart" onClick={onRepeat} data-testid="result-repeat">
            Repeat
          </Button>
        )}
        {lessonsHref && (
          <Button variant="ghost" icon="graduation" href={lessonsHref} data-testid="result-lessons">
            Lessons
          </Button>
        )}
        {actions}
        {hotkeys && (
          <p className="ml-auto hidden items-center gap-2 text-[13px] text-sub sm:flex">
            <Kbd size="sm">enter</Kbd>
            <span>{nextLabel.toLowerCase()}</span>
          </p>
        )}
      </div>
    </section>
  );
}

export default ResultsView;
