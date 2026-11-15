"use client";

import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { CardDescription, CardTitle, IconButton, SegmentedControl, cx } from "@/components/ui";
import { fingerIndex, type ParsedLayout } from "@/lib/types";
import type { KeyStats } from "@/lib/stats/store";
import {
  MIN_KEY_ATTEMPTS,
  aggregateByKey,
  charLabel,
  computeHeat,
  metricValue,
  type HeatMetric,
  type KeyAggregate,
} from "@/lib/stats/selectors";
import styles from "./stats.module.css";

export interface KeyHeatmapProps {
  layout: ParsedLayout;
  keyStats: KeyStats;
  /** Key pinned from outside (e.g. the weakest-keys list) or by clicking a key. */
  pinnedKeyId: string | null;
  onPinKey: (keyId: string | null) => void;
}

const METRICS: { value: HeatMetric; label: string }[] = [
  { value: "errors", label: "error rate" },
  { value: "speed", label: "slowness" },
  { value: "usage", label: "usage" },
];

/** Heat colour + legend colour on hot keys, per metric (tokens only). */
const METRIC_COLOR: Record<HeatMetric, { color: string; fg: string | null; noun: string; rank: string }> = {
  errors: { color: "var(--error)", fg: null, noun: "error rate", rank: "error rate" },
  speed: { color: "var(--finger-1)", fg: "var(--bg)", noun: "average latency", rank: "latency" },
  usage: { color: "var(--main)", fg: "var(--main-fg)", noun: "presses", rank: "presses" },
};

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const ms = (v: number | null) => (v == null ? "–" : `${Math.round(v)} ms`);
const compact = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));

function formatMetric(metric: HeatMetric, v: number): string {
  return metric === "errors" ? pct(v, v < 0.1 ? 1 : 0) : metric === "speed" ? `${Math.round(v)} ms` : compact(Math.round(v));
}

function keyName(k: { base: string; shifted: string; label: string }): string {
  if (k.base === " ") return "space";
  if (k.base && /[a-z]/.test(k.base)) return k.base.toUpperCase();
  if (k.base) return k.shifted && k.shifted !== k.base ? `${k.base} ${k.shifted}` : k.base;
  return k.label.replace(/\n/g, " ").trim() || "key";
}

function Char({ ch }: { ch: string }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[5px] border border-b-2 border-key-border bg-key-bg px-1.5 font-mono text-[11px] font-medium text-key-text">
      {charLabel(ch)}
    </kbd>
  );
}

export function KeyHeatmap({ layout, keyStats, pinnedKeyId, onPinKey }: KeyHeatmapProps) {
  const [metric, setMetric] = useState<HeatMetric>("errors");
  const [hoverKeyId, setHoverKeyId] = useState<string | null>(null);

  const agg = useMemo(() => aggregateByKey(layout, keyStats), [layout, keyStats]);
  const scale = useMemo(() => computeHeat(agg, metric), [agg, metric]);
  const overallMs = useMemo(() => {
    let total = 0;
    let samples = 0;
    for (const k of Object.values(agg.byKey)) {
      total += (k.avgMs ?? 0) * k.samples;
      samples += k.samples;
    }
    return samples > 0 ? total / samples : null;
  }, [agg]);

  const validPinned = pinnedKeyId && layout.keys.some((k) => k.id === pinnedKeyId) ? pinnedKeyId : null;
  const shownId = hoverKeyId ?? validPinned ?? scale.ranked[0] ?? null;
  const shownKey = shownId ? layout.keys.find((k) => k.id === shownId) : undefined;
  const shown: KeyAggregate | undefined = shownId ? agg.byKey[shownId] : undefined;
  const rank = shownId ? scale.ranked.indexOf(shownId) : -1;
  const hasData = Object.keys(agg.byKey).length > 0;

  // Only keys that type something are inspectable (not Shift, Ctrl, …).
  const keyIdFrom = (e: MouseEvent) => {
    const id = (e.target as HTMLElement).closest?.("[data-key-id]")?.getAttribute("data-key-id") ?? null;
    if (!id) return null;
    return agg.byKey[id] || layout.keys.some((k) => k.id === id && k.base !== "") ? id : null;
  };
  const step = (dir: 1 | -1) => {
    if (scale.ranked.length === 0) return;
    const i = rank < 0 ? (dir === 1 ? 0 : scale.ranked.length - 1) : (rank + dir + scale.ranked.length) % scale.ranked.length;
    setHoverKeyId(null);
    onPinKey(scale.ranked[i]);
  };

  const mc = METRIC_COLOR[metric];
  const wrapStyle = { "--error": mc.color, "--heat-fg": mc.fg ?? "#fff" } as CSSProperties;
  const ringId = shownId && /^[\w-]+$/.test(shownId) ? shownId : null;
  const fi = shownKey?.finger ? fingerIndex(shownKey.finger) : -1;
  const shownValue = shown ? metricValue(shown, metric) : null;

  return (
    <div data-testid="heatmap" data-metric={metric} data-hottest={scale.ranked.slice(0, 3).join(",")} data-shown={shownId ?? ""}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <CardTitle>Key heatmap</CardTitle>
          <CardDescription>Where this layout still trips you up, on the keys themselves. All-time, per key.</CardDescription>
        </div>
        <SegmentedControl data-testid="heat-metric" aria-label="Heatmap metric" size="sm" value={metric} onChange={setMetric} options={METRICS} />
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          {ringId && (
            <style>{`[data-stats-heat] [data-key-id="${ringId}"] > div{outline:2px solid var(--text);outline-offset:1px;z-index:3}`}</style>
          )}
          <div
            data-stats-heat=""
            className={cx(styles.heat, mc.fg && styles.fgFlip)}
            style={wrapStyle}
            onMouseOver={(e) => {
              const id = keyIdFrom(e);
              if (id) setHoverKeyId(id);
            }}
            onMouseLeave={() => setHoverKeyId(null)}
            onClick={(e) => {
              const id = keyIdFrom(e);
              if (id) onPinKey(id === validPinned ? null : id);
            }}
          >
            <Keyboard2D layout={layout} heat={scale.heat} maxUnit={54} />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-sub" data-testid="heat-legend">
            <div className="flex items-center gap-2">
              <span className="font-mono tabular-nums">{scale.ranked.length ? (metric === "usage" ? "rare" : formatMetric(metric, scale.min)) : "–"}</span>
              <span
                aria-hidden
                className="h-2 w-28 rounded-full sm:w-40"
                style={{ background: `linear-gradient(to right, var(--key-bg), color-mix(in srgb, ${mc.color} 85%, var(--key-bg)))`, boxShadow: "inset 0 0 0 1px var(--key-border)" }}
              />
              <span className="font-mono tabular-nums">{scale.ranked.length ? formatMetric(metric, scale.max) : "–"}</span>
              <span>{mc.noun}</span>
            </div>
            {metric !== "usage" && <span>Keys with fewer than {MIN_KEY_ATTEMPTS} presses stay blank.</span>}
          </div>
          {agg.unmapped.length > 0 && (
            <p className="mt-2 text-xs text-sub" data-testid="heat-unmapped">
              {agg.unmapped.length} recorded character{agg.unmapped.length === 1 ? "" : "s"} ({agg.unmapped.slice(0, 12).map(charLabel).join(" ")}
              {agg.unmapped.length > 12 ? " …" : ""}) {agg.unmapped.length === 1 ? "is" : "are"} not on this layout and {agg.unmapped.length === 1 ? "is" : "are"} left out.
            </p>
          )}
        </div>

        <div data-testid="key-detail" data-key-id={shownId ?? ""} aria-live="polite" className="min-w-0 rounded-ui border border-border p-4">
          {!shownKey ? (
            <p className="text-sm text-sub">{hasData ? "Hover or tap a key to see its numbers." : "No per-key data yet. It builds up as you type tests and lessons."}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className={cx("flex h-12 min-w-12 shrink-0 items-center justify-center rounded-ui border border-b-[3px] border-key-border bg-key-bg px-2.5 font-mono font-medium text-key-text", keyName(shownKey).length > 3 ? "text-[13px]" : "text-lg")}>
                  {keyName(shownKey)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] text-text">
                    {fi >= 0 && <span aria-hidden className="size-2 rounded-full" style={{ background: `var(--finger-${fi})` }} />}
                    <span className="truncate">{shownKey.finger ? `${shownKey.finger.hand === "L" ? "left" : "right"} ${shownKey.finger.finger}` : "no finger assigned"}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-sub">
                    {rank >= 0 ? `#${rank + 1} of ${scale.ranked.length} by ${mc.rank}` : shown ? "not enough presses to rank" : "no data yet"}
                  </div>
                </div>
                <div className="flex shrink-0">
                  <IconButton icon="chevron-left" size="sm" label="Previous key in ranking" onClick={() => step(-1)} disabled={scale.ranked.length === 0} />
                  <IconButton icon="chevron-right" size="sm" label="Next key in ranking" onClick={() => step(1)} disabled={scale.ranked.length === 0} />
                </div>
              </div>

              {shown ? (
                <>
                  <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-[13px]">
                    <dt className="text-sub">accuracy</dt>
                    <dd className={cx("text-right font-mono tabular-nums", shown.errorRate > 0.1 ? "text-error" : "text-text")} data-field="accuracy">
                      {shown.accuracy.toFixed(1)}%
                    </dd>
                    <dt className="text-sub">avg latency</dt>
                    <dd className="text-right font-mono text-text tabular-nums" data-field="latency">
                      {ms(shown.avgMs)}
                      {shown.avgMs != null && overallMs != null && (
                        <span className="ml-1.5 text-sub">
                          {shown.avgMs >= overallMs ? "+" : "−"}
                          {Math.abs(Math.round((shown.avgMs / overallMs - 1) * 100))}%
                        </span>
                      )}
                    </dd>
                    <dt className="text-sub">presses</dt>
                    <dd className="text-right font-mono text-text tabular-nums" data-field="attempts">
                      {shown.attempts.toLocaleString()}
                    </dd>
                    <dt className="text-sub">missed</dt>
                    <dd className="text-right font-mono text-text tabular-nums" data-field="misses">
                      {shown.misses.toLocaleString()}
                    </dd>
                    {shownValue == null && metric !== "usage" && (
                      <dd className="col-span-2 text-xs text-sub">Too few presses to colour this key.</dd>
                    )}
                  </dl>
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <div className="text-xs text-sub">most common mistypes</div>
                    {shown.mistypes.length === 0 ? (
                      <p className="mt-1.5 text-[13px] text-sub">None recorded.</p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {shown.mistypes.slice(0, 3).map((m) => (
                          <li key={`${m.expected}>${m.typed}`} className="flex items-center gap-1.5 text-[13px] text-sub" data-testid="key-mistype">
                            typed <Char ch={m.typed} /> instead of <Char ch={m.expected} />
                            <span className="ml-auto font-mono text-text tabular-nums">×{m.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-4 text-[13px] text-sub">Nothing recorded for this key yet.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
