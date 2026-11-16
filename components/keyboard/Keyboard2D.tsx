"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import type { LayerKeyChars, LayoutKey, LayoutLayer, ParsedLayout } from "@/lib/types";
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
  /**
   * Makes the keys focusable buttons (one tab stop, arrow keys move between keys, Enter / Space
   * activate). Without it the board is a plain image and nothing changes.
   */
  onKeyClick?: (keyId: string) => void;
  /** Keys drawn with a selection ring (e.g. the key being edited). */
  selectedKeyIds?: string[];
  /** Keys drawn with a small "customised" marker. */
  markedKeyIds?: string[];
  /**
   * Show this layer's legends instead of the base ones: keys with an entry show its characters, other
   * character keys are dimmed and blank, the layer's activator keys keep their label. Null / absent = the board as usual.
   */
  layer?: LayoutLayer | null;
  /** Describes a key for assistive tech when `onKeyClick` is set (default: its legend). */
  keyLabel?: (key: LayoutKey) => string;
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

/** Legends of a key while a layer is shown: its base character, with the Shift one muted. */
function layerLegends(c: LayerKeyChars, compact: boolean): LegendSpec[] {
  const out: LegendSpec[] = [{ text: c.base, size: compact ? 0.44 : 0.38 }];
  if (c.shifted) out.unshift({ text: c.shifted, size: compact ? 0.3 : 0.26, muted: true });
  return out;
}

interface KeyCapProps {
  k: LayoutKey;
  /** Characters on the layer being shown, when this key has some. */
  layerChars?: LayerKeyChars;
  /** A layer is shown and this key is neither on it nor its activator: draw it blank. */
  layerBlank?: boolean;
  state: KeyVisualState;
  heat: number | undefined;
  fingerColors: boolean;
  showHome: boolean;
  compact: boolean;
  interactive: boolean;
  selected: boolean;
  marked: boolean;
  focusable: boolean;
  ariaLabel?: string;
  onActivate?: (id: string) => void;
}

function defaultKeyLabel(k: LayoutKey): string {
  const text = displayLegends(k.label).join(" ").trim();
  return text || (k.base === " " ? "Space" : "Key");
}

const u = (n: number) => `calc(var(--u) * ${Math.round(n * 1000) / 1000})`;

const KeyCap = memo(function KeyCap({ k, layerChars, layerBlank, state, heat, fingerColors, showHome, compact, interactive, selected, marked, focusable, ariaLabel, onActivate }: KeyCapProps) {
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
      data-selected={selected ? "" : undefined}
      data-marked={marked ? "" : undefined}
      data-layer-legend={layerChars ? "" : undefined}
      {...(interactive
        ? {
            role: "button",
            tabIndex: focusable ? 0 : -1,
            "aria-label": ariaLabel,
            "aria-pressed": selected,
            onClick: () => onActivate?.(k.id),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate?.(k.id);
              }
            },
          }
        : null)}
    >
      <div className={capClass} style={capStyle}>
        {marked && <span className={styles.mark} aria-hidden />}
        {(layerChars ? layerLegends(layerChars, compact) : layerBlank ? [] : legendsFor(k, compact)).map((l, i) => (
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
  onKeyClick,
  selectedKeyIds,
  markedKeyIds,
  keyLabel,
  layer,
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

  const selected = useMemo(() => new Set(selectedKeyIds), [selectedKeyIds]);
  const marked = useMemo(() => new Set(markedKeyIds), [markedKeyIds]);
  const interactive = !!onKeyClick;
  const layerActivators = useMemo(() => new Set(layer?.activatorIds), [layer]);
  // Roving tab stop: the selected key, else the one last focused, else the first.
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabStop =
    (selectedKeyIds?.find((id) => layout.keys.some((k) => k.id === id)) ?? (focusId && layout.keys.some((k) => k.id === focusId) ? focusId : null)) ??
    layout.keys[0]?.id;

  const compact = unit !== null && unit < COMPACT_BELOW;

  const onBoardKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive) return;
    const dir = e.key === "ArrowRight" ? [1, 0] : e.key === "ArrowLeft" ? [-1, 0] : e.key === "ArrowDown" ? [0, 1] : e.key === "ArrowUp" ? [0, -1] : null;
    const fromId = (e.target as HTMLElement).closest<HTMLElement>("[data-key-id]")?.dataset.keyId;
    const from = layout.keys.find((k) => k.id === fromId);
    if (!dir || !from) return;
    e.preventDefault();
    const cx = from.x + from.w / 2;
    const cy = from.y + from.h / 2;
    let best: LayoutKey | undefined;
    let bestScore = Infinity;
    for (const k of layout.keys) {
      if (k === from) continue;
      const dx = k.x + k.w / 2 - cx;
      const dy = k.y + k.h / 2 - cy;
      const along = dx * dir[0] + dy * dir[1];
      if (along < 0.25) continue;
      const score = along + 2.5 * Math.abs(dx * dir[1] + dy * dir[0]);
      if (score < bestScore) [best, bestScore] = [k, score];
    }
    if (!best) return;
    setFocusId(best.id);
    rootRef.current?.querySelector<HTMLElement>(`[data-key-id="${best.id}"]`)?.focus();
  };

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
      role={interactive ? "group" : "img"}
      aria-label={interactive ? `${layout.name} keyboard, choose a key` : `${layout.name} keyboard`}
      onKeyDown={interactive ? onBoardKeyDown : undefined}
      onFocusCapture={
        interactive
          ? (e) => {
              const id = (e.target as HTMLElement).closest<HTMLElement>("[data-key-id]")?.dataset.keyId;
              if (id) setFocusId(id);
            }
          : undefined
      }
    >
      <div className={styles.board} style={boardStyle}>
        {layout.keys.map((k) => {
          const layerChars = layer ? layer.keys[k.id] : undefined;
          const layerOff = !!layer && !layerChars && !layerActivators.has(k.id);
          const state: KeyVisualState = error.has(k.id)
            ? "error"
            : pressed.has(k.id)
              ? "pressed"
              : highlight.has(k.id)
                ? "highlight"
                : dim.has(k.id) || layerOff
                  ? "dim"
                  : "idle";
          return (
            <KeyCap
              key={k.id}
              k={k}
              layerChars={layerChars}
              layerBlank={layerOff && !!k.base && k.base !== " "}
              state={state}
              heat={heat?.[k.id]}
              fingerColors={fingerColors}
              showHome={showHomeMarkers}
              compact={compact}
              interactive={interactive}
              selected={selected.has(k.id)}
              marked={marked.has(k.id)}
              focusable={k.id === tabStop}
              ariaLabel={interactive ? (keyLabel ? keyLabel(k) : defaultKeyLabel(k)) : undefined}
              onActivate={onKeyClick}
            />
          );
        })}
      </div>
    </div>
  );
}

export default Keyboard2D;
