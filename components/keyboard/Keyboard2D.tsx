"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutKey, ParsedLayout } from "@/lib/types";
import { fingerIndex } from "@/lib/types";
import { displayLegends } from "@/lib/layout/parse";
import styles from "./Keyboard2D.module.css";

export type KeyVisualState = "idle" | "highlight" | "pressed" | "error" | "dim";

export interface Keyboard2DProps {
  layout: ParsedLayout;
  /** Next key(s) to press — the most prominent state. */
  highlightKeyIds?: string[];
  /** Keys currently held down. */
  pressedKeyIds?: string[];
  /** Keys that were just hit by mistake. */
  errorKeyIds?: string[];
  /** Tint keys by the finger that presses them (--finger-0 … --finger-9). */
  fingerColors?: boolean;
  /** keyId → 0..1 heat-map intensity. */
  heat?: Record<string, number>;
  /** Show a bump on the home keys (default true). */
  showHomeMarkers?: boolean;
  /** keyIds to dim (e.g. keys not yet introduced in a lesson). */
  dimUnused?: string[];
  /** Largest size of one key unit in px (default 60). The board never exceeds its container. */
  maxUnit?: number;
  className?: string;
}

/** Below this unit size (px) long key names are swapped for glyphs. */
const COMPACT_BELOW = 30;

const GLYPHS: Record<string, string> = {
  backspace: "⌫",
  bksp: "⌫",
  tab: "⇥",
  capslock: "⇪",
  enter: "⏎",
  return: "⏎",
  shift: "⇧",
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  win: "◆",
  menu: "☰",
  esc: "⎋",
  insert: "ins",
  delete: "del",
  home: "hm",
  end: "end",
  pgup: "pg↑",
  pgdn: "pg↓",
  prtsc: "prt",
  scrolllock: "scr",
  pausebreak: "pau",
  numlock: "num",
  lower: "▽",
  raise: "△",
};

interface LegendSpec {
  text: string;
  /** Font size in key units. */
  size: number;
  muted?: boolean;
  name?: boolean;
  wrap?: boolean;
}

const cpLen = (s: string) => Array.from(s).length;

/** Font size (in units) that fits `text` in a key `w` units wide, allowing wraps at spaces. */
function fitName(text: string, w: number, max: number): number {
  const longest = Math.max(...text.split(/\s+/).map(cpLen), 1);
  return Math.max(0.12, Math.min(max, (w - 0.22) / (longest * 0.6)));
}

function legendsFor(key: LayoutKey, compact: boolean): LegendSpec[] {
  const disp = displayLegends(key.label);
  if (disp.length === 0) return [];

  if (disp.length === 1) {
    const t = disp[0];
    if (cpLen(t) === 1) return [{ text: t, size: compact ? 0.44 : 0.38 }];
    if (compact) {
      const g = GLYPHS[t.toLowerCase().replace(/\s/g, "")];
      if (g) return [{ text: g, size: cpLen(g) === 1 ? 0.42 : fitName(g, key.w, 0.3), name: true }];
      return [{ text: t, size: fitName(t, key.w, 0.3), name: true, wrap: true }];
    }
    return [{ text: t, size: fitName(t, key.w, 0.23), name: true, wrap: true }];
  }

  // Multi-legend: the legend that is the unshifted character is primary, the rest are muted.
  const primaryIdx = disp.findIndex((l) => key.base !== "" && l.toLowerCase() === key.base);
  if (primaryIdx < 0) {
    if (compact) {
      const g = GLYPHS[disp.join("").toLowerCase().replace(/\s/g, "")];
      if (g) return [{ text: g, size: fitName(g, key.w, 0.3), name: true }];
    }
    return disp.slice(0, 2).map((t) => ({ text: t, size: fitName(t, key.w, compact ? 0.26 : 0.2), name: true }));
  }
  const out: LegendSpec[] = [];
  disp.slice(0, 2).forEach((t, i) => {
    if (i === primaryIdx) out.push({ text: t, size: compact ? 0.38 : 0.32 });
    else if (cpLen(t) === 1) out.push({ text: t, size: compact ? 0.32 : 0.26, muted: true });
    else if (!compact) out.push({ text: t, size: fitName(t, key.w, 0.15), muted: true, name: true });
  });
  return out;
}

interface KeyCapProps {
  k: LayoutKey;
  state: KeyVisualState;
  heat: number | undefined;
  fingerColors: boolean;
  showHome: boolean;
  compact: boolean;
}

const u = (n: number) => `calc(var(--u) * ${Math.round(n * 1000) / 1000})`;

const KeyCap = memo(function KeyCap({ k, state, heat, fingerColors, showHome, compact }: KeyCapProps) {
  const fi = fingerColors && k.finger ? fingerIndex(k.finger) : -1;
  const hasHeat = heat !== undefined && heat > 0;
  const capClass = [
    styles.cap,
    fi >= 0 ? styles.finger : "",
    fi >= 0 ? styles[`f${fi}`] : "",
    // Space bars carry no bump, but a key-sized thumb rest on a split board does.
    showHome && k.isHome && (k.base !== " " || k.w < 1.75) ? styles.home : "",
    hasHeat ? styles.heat : "",
    hasHeat && heat > 0.6 ? styles.heatHot : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style: React.CSSProperties = { left: u(k.x), top: u(k.y), width: u(k.w), height: u(k.h) };
  if (k.rotation) {
    style.transform = `rotate(${k.rotation.angle}deg)`;
    style.transformOrigin = `${u(k.rotation.cx - k.x)} ${u(k.rotation.cy - k.y)}`;
  }
  const capStyle = hasHeat
    ? ({ "--heat-pct": `${Math.round(Math.min(1, heat) * 85)}%` } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={styles.key}
      style={style}
      data-key-id={k.id}
      data-code={k.code ?? ""}
      data-state={state}
      data-finger={k.finger ? `${k.finger.hand}-${k.finger.finger}` : undefined}
      data-home={k.isHome ? "" : undefined}
      data-heat={hasHeat ? heat.toFixed(2) : undefined}
    >
      <div className={capClass} style={capStyle}>
        {legendsFor(k, compact).map((l, i) => (
          <span
            key={i}
            className={[styles.legend, l.muted ? styles.muted : "", l.name ? styles.name : "", l.wrap ? styles.wrap : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ fontSize: u(l.size) }}
          >
            {l.text}
          </span>
        ))}
      </div>
    </div>
  );
});

export function Keyboard2D({
  layout,
  highlightKeyIds,
  pressedKeyIds,
  errorKeyIds,
  fingerColors = false,
  heat,
  showHomeMarkers = true,
  dimUnused,
  maxUnit = 60,
  className,
}: Keyboard2DProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // null until measured: CSS container units size the board for SSR / first paint.
  const [unit, setUnit] = useState<number | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = (width: number) => {
      if (width <= 0) return;
      const next = Math.floor(Math.min(maxUnit, width / layout.width) * 100) / 100;
      setUnit((prev) => (prev === next ? prev : next));
    };
    measure(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) measure(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.width, maxUnit]);

  const highlight = useMemo(() => new Set(highlightKeyIds), [highlightKeyIds]);
  const pressed = useMemo(() => new Set(pressedKeyIds), [pressedKeyIds]);
  const error = useMemo(() => new Set(errorKeyIds), [errorKeyIds]);
  const dim = useMemo(() => new Set(dimUnused), [dimUnused]);

  const compact = unit !== null && unit < COMPACT_BELOW;

  const rootStyle = {
    "--kb-w": layout.width,
    "--kb-h": layout.height,
    "--kb-max-u": `${maxUnit}px`,
  } as React.CSSProperties;
  const boardStyle = unit !== null ? ({ "--u": `${unit}px` } as React.CSSProperties) : undefined;

  return (
    <div
      ref={rootRef}
      className={className ? `${styles.root} ${className}` : styles.root}
      style={rootStyle}
      data-testid="keyboard-2d"
      data-layout={layout.name}
      data-compact={compact ? "" : undefined}
      role="img"
      aria-label={`${layout.name} keyboard`}
    >
      <div className={styles.board} style={boardStyle}>
        {layout.keys.map((k) => {
          const state: KeyVisualState = error.has(k.id)
            ? "error"
            : pressed.has(k.id)
              ? "pressed"
              : highlight.has(k.id)
                ? "highlight"
                : dim.has(k.id)
                  ? "dim"
                  : "idle";
          return (
            <KeyCap
              key={k.id}
              k={k}
              state={state}
              heat={heat?.[k.id]}
              fingerColors={fingerColors}
              showHome={showHomeMarkers}
              compact={compact}
            />
          );
        })}
      </div>
    </div>
  );
}

export default Keyboard2D;
