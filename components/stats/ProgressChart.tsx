"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Badge } from "@/components/ui";
import type { StoredResult } from "@/lib/stats/store";
import { niceTicks, smooth } from "@/lib/stats/selectors";

export interface ProgressChartProps {
  /** Oldest first. */
  results: StoredResult[];
  /** Results that were the fastest so far when recorded. */
  bestIds: Set<string>;
}

const M = { top: 14, right: 46, bottom: 30, left: 38 };

const fmtDay = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtFull = (at: number) =>
  new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const modeLabel = (r: Pick<StoredResult, "mode" | "modeValue">) => (r.mode === "time" ? `time ${r.modeValue}s` : `words ${r.modeValue}`);

function LegendItem({ children, swatch }: { children: string; swatch: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <svg width="18" height="10" aria-hidden className="shrink-0 overflow-visible">
        {swatch}
      </svg>
      {children}
    </span>
  );
}

/** Hand-built SVG: wpm per test (dots), smoothed trend, accuracy on a secondary axis, new-best markers. */
export function ProgressChart({ results, bestIds }: ProgressChartProps) {
  const empty = results.length === 0;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // The empty placeholder and the chart are different elements: re-attach when that flips.
  }, [empty]);

  // A range / layout switch changes the points under the cursor.
  useEffect(() => setActive(null), [results]);

  const count = results.length;
  const height = width > 0 && width < 520 ? 230 : 290;
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;

  const model = useMemo(() => {
    if (count === 0) return null;
    const wpm = results.map((r) => r.wpm);
    const trend = smooth(wpm);
    const lo = Math.min(...wpm);
    const hi = Math.max(...wpm);
    const pad = Math.max(2, (hi - lo) * 0.08);
    const wpmTicks = niceTicks(Math.max(0, lo - pad), hi + pad, 4);
    const accLo = Math.min(95, Math.floor(Math.min(...results.map((r) => r.accuracy)) / 5) * 5);
    const accTicks = [accLo, (accLo + 100) / 2, 100];
    return { wpm, trend, wpmTicks, accLo, accTicks };
  }, [results, count]);

  if (count === 0 || !model) {
    return (
      <div ref={wrapRef} data-testid="progress-chart" data-points={0} className="flex h-40 items-center justify-center rounded-ui border border-dashed border-border text-sm text-sub">
        No tests in this period. Try a longer range.
      </div>
    );
  }

  const { wpm, trend, wpmTicks, accLo, accTicks } = model;
  const y0 = wpmTicks[0];
  const y1 = wpmTicks[wpmTicks.length - 1];
  const x = (i: number) => M.left + (count === 1 ? plotW / 2 : (i / (count - 1)) * plotW);
  const y = (v: number) => M.top + plotH - ((v - y0) / (y1 - y0)) * plotH;
  const ya = (v: number) => M.top + plotH - ((v - accLo) / (100 - accLo)) * plotH;
  const path = (vals: number[], f: (v: number) => number) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${f(v).toFixed(1)}`).join("");

  // One x label per day (at that day's first test), thinned so labels never collide.
  const xLabels: { i: number; text: string }[] = [];
  let lastDay = "";
  let lastX = -Infinity;
  results.forEach((r, i) => {
    const day = fmtDay(r.at);
    if (day === lastDay) return;
    lastDay = day;
    if (x(i) - lastX < 62) return;
    xLabels.push({ i, text: day });
    lastX = x(i);
  });

  const nearest = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || count === 0) return null;
    if (count === 1) return 0;
    const t = (clientX - rect.left - M.left) / plotW;
    return Math.min(count - 1, Math.max(0, Math.round(t * (count - 1))));
  };
  const onMove = (e: MouseEvent) => setActive(nearest(e.clientX));
  const onKeyDown = (e: KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = active == null ? count - 1 : Math.min(count - 1, active + 1);
    else if (e.key === "ArrowLeft") next = active == null ? count - 1 : Math.max(0, active - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next == null) return;
    e.preventDefault();
    setActive(next);
  };

  // Shrink the markers when the points get crowded (phones, long histories).
  const dense = count > 1 && plotW / (count - 1) < 12;
  const a = active != null && active < count ? results[active] : null;
  // Tooltip sits beside the guide line (flipping sides past the middle), clamped to the chart.
  const TIP_W = 176;
  const TIP_H = 136;
  const tipOnLeft = active != null && x(active) + 14 + TIP_W > width;
  const tipLeft = active != null ? Math.max(0, tipOnLeft ? x(active) - 14 - TIP_W : x(active) + 14) : 0;
  const tipTop = a ? Math.min(Math.max(y(a.wpm) - TIP_H / 2, 0), height - TIP_H) : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-sub" aria-hidden>
        <LegendItem swatch={<circle cx="9" cy="5" r="3" fill="var(--main)" opacity="0.6" />}>wpm per test</LegendItem>
        <LegendItem swatch={<path d="M0 5h18" stroke="var(--main)" strokeWidth="2.25" strokeLinecap="round" />}>trend</LegendItem>
        <LegendItem swatch={<path d="M0 5h18" stroke="var(--text)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.55" />}>accuracy</LegendItem>
        <LegendItem swatch={<circle cx="9" cy="5" r="3.5" fill="var(--bg-alt)" stroke="var(--success)" strokeWidth="2" />}>new best</LegendItem>
      </div>
      <div
        ref={wrapRef}
        data-testid="progress-chart"
        data-points={count}
        data-active={active ?? undefined}
        tabIndex={0}
        role="group"
        aria-label={`Progress chart with ${count} test${count === 1 ? "" : "s"}. Use the left and right arrow keys to inspect each test.`}
        className="relative w-full rounded-ui outline-none focus-visible:ring-2 focus-visible:ring-main/60"
        style={{ height }}
        onMouseMove={onMove}
        onMouseLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Words per minute and accuracy per test" className="block select-none">
            {/* grid + left axis (wpm) */}
            {wpmTicks.map((t) => (
              <g key={`w${t}`}>
                <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" opacity={t === y0 ? 1 : 0.6} />
                <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--sub)" fontFamily="var(--font-mono)">
                  {t}
                </text>
              </g>
            ))}
            {/* right axis (accuracy) */}
            {accTicks.map((t) => (
              <text key={`a${t}`} x={M.left + plotW + 8} y={ya(t)} dy="0.32em" fontSize="11" fill="var(--sub)" fontFamily="var(--font-mono)" opacity="0.8">
                {Number.isInteger(t) ? t : t.toFixed(1)}%
              </text>
            ))}
            {/* x labels */}
            {xLabels.map((l) => (
              <text
                key={l.i}
                x={x(l.i)}
                y={height - 9}
                textAnchor={count === 1 ? "middle" : x(l.i) < M.left + 24 ? "start" : x(l.i) > M.left + plotW - 24 ? "end" : "middle"}
                fontSize="11"
                fill="var(--sub)"
              >
                {l.text}
              </text>
            ))}
            {/* accuracy */}
            {count > 1 && (
              <path d={path(results.map((r) => r.accuracy), ya)} fill="none" stroke="var(--text)" strokeWidth="1.25" strokeDasharray="3 3" strokeLinejoin="round" opacity="0.4" data-series="accuracy" />
            )}
            {count === 1 && <circle cx={x(0)} cy={ya(results[0].accuracy)} r="2.5" fill="var(--text)" opacity="0.45" />}
            {/* trend */}
            {count > 2 && <path d={path(trend, y)} fill="none" stroke="var(--main)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" data-series="trend" />}
            {/* active guide */}
            {active != null && a && <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--sub)" strokeWidth="1" opacity="0.5" />}
            {/* points */}
            {results.map((r, i) => {
              const best = bestIds.has(r.id);
              const on = i === active;
              return best ? (
                <circle key={r.id} data-testid="chart-point" data-best="" cx={x(i)} cy={y(r.wpm)} r={on ? 6 : dense ? 3.25 : 4.5} fill="var(--bg-alt)" stroke="var(--success)" strokeWidth={dense ? 1.5 : 2} />
              ) : (
                <circle key={r.id} data-testid="chart-point" cx={x(i)} cy={y(r.wpm)} r={on ? 5 : dense ? 2.25 : 3} fill="var(--main)" opacity={on ? 1 : 0.6} />
              );
            })}
          </svg>
        )}
        {a && active != null && (
          <div
            role="status"
            data-testid="chart-tooltip"
            className="pointer-events-none absolute z-10 rounded-ui border border-border bg-bg px-3 py-2.5 text-xs shadow-pop"
            style={{ left: tipLeft, top: tipTop, width: TIP_W }}
          >
            <div className="flex items-center justify-between gap-2 text-sub">
              <span>{fmtFull(a.at)}</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="font-mono text-2xl leading-none font-medium text-main tabular-nums">{Math.round(a.wpm)}</span>
              <span className="text-sub">wpm</span>
              {bestIds.has(a.id) && (
                <Badge tone="success" icon="trophy" className="ml-auto">
                  best
                </Badge>
              )}
            </div>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sub">
              <dt>accuracy</dt>
              <dd className="text-right font-mono text-text tabular-nums">{a.accuracy.toFixed(1)}%</dd>
              <dt>raw</dt>
              <dd className="text-right font-mono text-text tabular-nums">{Math.round(a.raw)}</dd>
              <dt>consistency</dt>
              <dd className="text-right font-mono text-text tabular-nums">{Math.round(a.consistency)}%</dd>
              <dt>mode</dt>
              <dd className="text-right font-mono text-text">{modeLabel(a)}</dd>
            </dl>
          </div>
        )}
      </div>
      {count <= 2 && (
        <p className="mt-3 text-xs text-sub">
          {count === 1 ? "One test so far." : "Two tests so far."} The trend line appears once there are a few more.
        </p>
      )}
    </div>
  );
}
