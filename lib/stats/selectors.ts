// Pure derivations for the Stats page (no React, no storage access) plus, at the bottom, the
// raw-storage helpers the page needs for export / import / delete. Everything is computed from
// the shapes persisted by lib/stats/store.ts.
import { fingerIndex, FINGER_ORDER, type Hand, type LayoutKey, type ParsedLayout } from "../types";
import { keyForChar } from "../layout/keys";
import {
  STORAGE_KEYS,
  STORAGE_PREFIX,
  dayKey,
  type KeyStat,
  type KeyStats,
  type LessonProgress,
  type PersonalBest,
  type PersonalBests,
  type StoredResult,
} from "./store";

// ------------------------------------------------------------------ ranges + headline

export type RangeId = "7d" | "30d" | "all";
export const RANGE_DAYS: Record<RangeId, number | null> = { "7d": 7, "30d": 30, all: null };
const DAY_MS = 86400000;

export interface RangeSplit {
  /** Results inside the range, oldest first. */
  current: StoredResult[];
  /** Results in the equally long period just before the range (empty for "all"). */
  previous: StoredResult[];
}

/** "7d" = the last 7×24h up to `now`; the previous period is the 7×24h before that. */
export function splitByRange(results: readonly StoredResult[], range: RangeId, now: number = Date.now()): RangeSplit {
  const days = RANGE_DAYS[range];
  const sorted = results.slice().sort((a, b) => a.at - b.at);
  if (days == null) return { current: sorted, previous: [] };
  const from = now - days * DAY_MS;
  const prevFrom = from - days * DAY_MS;
  return {
    current: sorted.filter((r) => r.at > from),
    previous: sorted.filter((r) => r.at > prevFrom && r.at <= from),
  };
}

export interface Headline {
  tests: number;
  /** Highest wpm, null when there are no results. */
  bestWpm: number | null;
  /** Plain mean of per-test wpm. */
  avgWpm: number | null;
  /** Plain mean of per-test accuracy (0-100). */
  avgAccuracy: number | null;
  /** Sum of test durations. */
  timeMs: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeHeadline(results: readonly StoredResult[]): Headline {
  return {
    tests: results.length,
    bestWpm: results.length ? Math.max(...results.map((r) => r.wpm)) : null,
    avgWpm: mean(results.map((r) => r.wpm)),
    avgAccuracy: mean(results.map((r) => r.accuracy)),
    timeMs: results.reduce((a, r) => a + r.durationMs, 0),
  };
}

/** Ids of results that were the fastest so far (for the layout) when they were recorded. */
export function runningBestIds(results: readonly StoredResult[]): Set<string> {
  const out = new Set<string>();
  let best = -Infinity;
  for (const r of results.slice().sort((a, b) => a.at - b.at)) {
    if (r.wpm > best) {
      best = r.wpm;
      out.add(r.id);
    }
  }
  return out;
}

/** Centred moving average with a window that shrinks at the edges. */
export function smooth(values: readonly number[], radius?: number): number[] {
  const r = radius ?? Math.max(1, Math.round(values.length / 12));
  return values.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(values.length - 1, i + r); j++) {
      const w = r + 1 - Math.abs(i - j);
      sum += values[j] * w;
      weight += w;
    }
    return sum / weight;
  });
}

/** Round axis ticks covering [min, max] with about `count` steps. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

/** Big-number form of a duration: { value: "26", unit: "min" }. */
export function durationParts(ms: number): { value: string; unit: string } {
  const s = ms / 1000;
  if (s < 60) return { value: String(Math.round(s)), unit: "sec" };
  if (s < 3600) return { value: String(Math.round(s / 60)), unit: "min" };
  const h = s / 3600;
  return { value: h < 10 ? h.toFixed(1) : String(Math.round(h)), unit: h === 1 ? "hr" : "hrs" };
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

// ------------------------------------------------------------------ per-key aggregation

export interface KeyAggregate {
  key: LayoutKey;
  /** Recorded characters this key produces (base and/or shifted). */
  chars: string[];
  hits: number;
  misses: number;
  attempts: number;
  /** 0-1. */
  errorRate: number;
  /** 0-100. */
  accuracy: number;
  avgMs: number | null;
  samples: number;
  /** "typed `typed` instead of `expected`", most frequent first. */
  mistypes: { expected: string; typed: string; count: number }[];
}

export interface KeyAggregation {
  byKey: Record<string, KeyAggregate>;
  /** Recorded characters the layout has no key for. */
  unmapped: string[];
  totalAttempts: number;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function mistypesOf(expected: string, stat: KeyStat) {
  const src = stat.mistypedAs && typeof stat.mistypedAs === "object" ? stat.mistypedAs : {};
  return Object.entries(src)
    .map(([typed, count]) => ({ expected, typed, count: n(count) }))
    .filter((m) => m.count > 0);
}

/** Fold per-character stats onto the physical keys of `layout`. */
export function aggregateByKey(layout: ParsedLayout, stats: KeyStats): KeyAggregation {
  const acc = new Map<string, { key: LayoutKey; chars: string[]; hits: number; misses: number; totalMs: number; samples: number; mistypes: KeyAggregate["mistypes"] }>();
  const unmapped: string[] = [];
  let totalAttempts = 0;
  for (const [ch, s] of Object.entries(stats)) {
    if (!s || typeof s !== "object") continue;
    const hit = keyForChar(layout, ch);
    if (!hit) {
      unmapped.push(ch);
      continue;
    }
    let a = acc.get(hit.key.id);
    if (!a) {
      a = { key: hit.key, chars: [], hits: 0, misses: 0, totalMs: 0, samples: 0, mistypes: [] };
      acc.set(hit.key.id, a);
    }
    a.chars.push(ch);
    a.hits += n(s.hits);
    a.misses += n(s.misses);
    a.totalMs += n(s.totalMs);
    a.samples += n(s.samples);
    a.mistypes.push(...mistypesOf(ch, s));
    totalAttempts += n(s.hits) + n(s.misses);
  }
  const byKey: Record<string, KeyAggregate> = {};
  for (const [id, a] of acc) {
    const attempts = a.hits + a.misses;
    byKey[id] = {
      key: a.key,
      chars: a.chars.sort(),
      hits: a.hits,
      misses: a.misses,
      attempts,
      errorRate: attempts > 0 ? a.misses / attempts : 0,
      accuracy: attempts > 0 ? (a.hits / attempts) * 100 : 100,
      avgMs: a.samples > 0 ? a.totalMs / a.samples : null,
      samples: a.samples,
      mistypes: a.mistypes.sort((x, y) => y.count - x.count),
    };
  }
  return { byKey, unmapped: unmapped.sort(), totalAttempts };
}

export type HeatMetric = "errors" | "speed" | "usage";

export interface HeatScale {
  /** keyId → 0..1 for Keyboard2D's `heat` prop. */
  heat: Record<string, number>;
  /** Raw metric value at heat 0 and heat 1 (error rate 0-1, ms, attempts). */
  min: number;
  max: number;
  /** Key ids with data for this metric, hottest first. */
  ranked: string[];
}

/** Keys with fewer attempts than this are left out of the error / speed scales (too noisy). */
export const MIN_KEY_ATTEMPTS = 8;

const isSpace = (k: KeyAggregate) => k.key.base === " ";

/** Raw value of `metric` for a key, or null when the key has too little data for it. */
export function metricValue(k: KeyAggregate, metric: HeatMetric, minAttempts = MIN_KEY_ATTEMPTS): number | null {
  if (metric === "usage") return k.attempts > 0 ? k.attempts : null;
  if (k.attempts < minAttempts) return null;
  if (metric === "errors") return k.errorRate;
  return k.samples >= Math.min(minAttempts, 3) ? k.avgMs : null;
}

export function computeHeat(agg: KeyAggregation, metric: HeatMetric, minAttempts = MIN_KEY_ATTEMPTS): HeatScale {
  const rows = Object.values(agg.byKey)
    .map((k) => ({ k, v: metricValue(k, metric, minAttempts) }))
    .filter((r): r is { k: KeyAggregate; v: number } => r.v != null);
  if (rows.length === 0) return { heat: {}, min: 0, max: 0, ranked: [] };
  // The space bar is pressed ~5x more than any letter; keep it from flattening the usage scale.
  const scaleRows = metric === "usage" && rows.some((r) => !isSpace(r.k)) ? rows.filter((r) => !isSpace(r.k)) : rows;
  const values = scaleRows.map((r) => r.v);
  let min = metric === "speed" ? Math.min(...values) : 0;
  let max = Math.max(...values);
  // A layout typed almost flawlessly should not light up because of a 1% blip.
  if (metric === "errors") max = Math.max(max, 0.04);
  if (max - min < 1e-9) min = Math.max(0, max - 1);
  const heat: Record<string, number> = {};
  for (const { k, v } of rows) {
    const linear = Math.min(1, Math.max(0, (v - min) / (max - min)));
    // Latencies bunch up in the middle of the scale; a gentle curve keeps only the slow keys hot.
    const t = metric === "speed" ? Math.pow(linear, 1.5) : linear;
    if (t > 0.005) heat[k.key.id] = Math.round(t * 1000) / 1000;
  }
  const ranked = rows.sort((a, b) => b.v - a.v || b.k.attempts - a.k.attempts).map((r) => r.k.key.id);
  return { heat, min, max, ranked };
}

// ------------------------------------------------------------------ fingers + hands

export interface FingerAggregate {
  /** Index into FINGER_ORDER (= colour token --finger-N). */
  index: number;
  hand: Hand;
  finger: string;
  attempts: number;
  misses: number;
  accuracy: number;
  errorRate: number;
  avgMs: number | null;
  /** Share of all mapped keystrokes, 0-1. */
  share: number;
}

export interface FingerBreakdown {
  fingers: FingerAggregate[];
  hands: Record<Hand, { attempts: number; accuracy: number; errorRate: number; avgMs: number | null; share: number }>;
  /** Largest error rate / latency across fingers, for scaling bars. */
  maxErrorRate: number;
  maxMs: number;
}

export function aggregateByFinger(agg: KeyAggregation): FingerBreakdown {
  const slots = FINGER_ORDER.map(() => ({ hits: 0, misses: 0, totalMs: 0, samples: 0 }));
  for (const k of Object.values(agg.byKey)) {
    if (!k.key.finger) continue;
    const i = fingerIndex(k.key.finger);
    if (i < 0) continue;
    slots[i].hits += k.hits;
    slots[i].misses += k.misses;
    slots[i].totalMs += (k.avgMs ?? 0) * k.samples;
    slots[i].samples += k.samples;
  }
  const total = slots.reduce((a, s) => a + s.hits + s.misses, 0);
  const summarize = (s: { hits: number; misses: number; totalMs: number; samples: number }) => {
    const attempts = s.hits + s.misses;
    return {
      attempts,
      misses: s.misses,
      accuracy: attempts > 0 ? (s.hits / attempts) * 100 : 100,
      errorRate: attempts > 0 ? s.misses / attempts : 0,
      avgMs: s.samples > 0 ? s.totalMs / s.samples : null,
      share: total > 0 ? attempts / total : 0,
    };
  };
  const fingers = FINGER_ORDER.map((f, index) => ({ index, hand: f.hand, finger: f.finger, ...summarize(slots[index]) }));
  const handOf = (hand: Hand) =>
    summarize(
      slots
        .filter((_, i) => FINGER_ORDER[i].hand === hand)
        .reduce((a, s) => ({ hits: a.hits + s.hits, misses: a.misses + s.misses, totalMs: a.totalMs + s.totalMs, samples: a.samples + s.samples }), {
          hits: 0,
          misses: 0,
          totalMs: 0,
          samples: 0,
        }),
    );
  const used = fingers.filter((f) => f.attempts > 0);
  return {
    fingers,
    hands: { L: handOf("L"), R: handOf("R") },
    maxErrorRate: Math.max(0, ...used.map((f) => f.errorRate)),
    maxMs: Math.max(0, ...used.map((f) => f.avgMs ?? 0)),
  };
}

// ------------------------------------------------------------------ mix-ups

export interface Mixup {
  expected: string;
  typed: string;
  count: number;
}

/** Most frequent "typed X instead of Y" pairs across every character. */
export function topMixups(stats: KeyStats, limit = 6): Mixup[] {
  const out: Mixup[] = [];
  for (const [expected, s] of Object.entries(stats)) {
    if (!s || typeof s !== "object") continue;
    out.push(...mistypesOf(expected, s));
  }
  return out.sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected)).slice(0, limit);
}

/** Printable name of a character ("space" for " "). */
export function charLabel(ch: string): string {
  if (ch === " ") return "space";
  if (ch === "\n") return "enter";
  if (ch === "\t") return "tab";
  return ch;
}

// ------------------------------------------------------------------ activity calendar

export interface ActivityCell {
  day: string;
  /** Tests finished that day on the viewed layout. */
  tests: number;
  /** Practised that day at all (any layout, tests or lessons). */
  practiced: boolean;
  /** 0 nothing, 1 practised without a test on this layout, 2-4 by number of tests. */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
  /** Local noon of the day. */
  date: Date;
}

export interface ActivityGrid {
  /** Columns = weeks (oldest first), each Monday → Sunday. */
  weeks: ActivityCell[][];
  /** Column index → month label for columns where a month starts. */
  monthLabels: { week: number; label: string }[];
  activeDays: number;
  totalTests: number;
}

export function buildActivity(results: readonly StoredResult[], practicedDays: readonly string[], weeks = 12, now: number = Date.now()): ActivityGrid {
  const perDay = new Map<string, number>();
  for (const r of results) perDay.set(dayKey(r.at), (perDay.get(dayKey(r.at)) ?? 0) + 1);
  const practiced = new Set(practicedDays);
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - mondayOffset - (weeks - 1) * 7);
  const grid: ActivityCell[][] = [];
  const monthLabels: ActivityGrid["monthLabels"] = [];
  let activeDays = 0;
  let totalTests = 0;
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const col: ActivityCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const day = dayKey(date);
      const future = date.getTime() > today.getTime();
      const tests = future ? 0 : (perDay.get(day) ?? 0);
      const wasPracticed = !future && (practiced.has(day) || tests > 0);
      const level = tests >= 4 ? 4 : tests >= 2 ? 3 : tests === 1 ? 2 : wasPracticed ? 1 : 0;
      if (wasPracticed) activeDays++;
      totalTests += tests;
      col.push({ day, tests, practiced: wasPracticed, level, future, date });
    }
    const month = col[0].date.getMonth();
    if (month !== lastMonth) {
      monthLabels.push({ week: w, label: col[0].date.toLocaleDateString(undefined, { month: "short" }) });
      lastMonth = month;
    }
    grid.push(col);
  }
  // A partial first month would sit on top of the next label: keep the later one.
  const spaced = monthLabels.filter((m, i) => i === monthLabels.length - 1 || monthLabels[i + 1].week - m.week >= 3);
  return { weeks: grid, monthLabels: spaced, activeDays, totalTests };
}

// ------------------------------------------------------------------ lessons

export interface LessonSummary {
  total: number;
  completed: number;
  started: number;
  stars: number;
  maxStars: number;
}

/** `lessonIds` = the ids of the layout's curriculum; progress for unknown ids is ignored. */
export function summarizeLessons(progress: LessonProgress, lessonIds: readonly string[]): LessonSummary {
  let completed = 0;
  let started = 0;
  let stars = 0;
  for (const id of lessonIds) {
    const p = progress[id];
    if (!p) continue;
    started++;
    if (p.completedAt != null || n(p.stars) > 0) completed++;
    stars += Math.min(3, Math.max(0, n(p.stars)));
  }
  return { total: lessonIds.length, completed, started, stars, maxStars: lessonIds.length * 3 };
}

// ------------------------------------------------------------------ raw storage: export / import / delete

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function readRaw(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Write (or remove, with `undefined`) a raw ll:v1:* key and make the stores re-read it. The
 * stats and settings stores both refresh on a `storage` event, which browsers only fire in
 * OTHER tabs, so it is dispatched here by hand.
 */
export function writeRawKey(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

/** Every layout id that has any stored stats (results, key stats or lesson progress). */
export function layoutIdsWithData(results: readonly StoredResult[], allKeyStats: unknown, allLessons: unknown): string[] {
  const ids = new Set<string>();
  for (const r of results) ids.add(r.layoutId);
  for (const src of [allKeyStats, allLessons]) {
    if (!isObject(src)) continue;
    for (const [id, v] of Object.entries(src)) if (isObject(v) && Object.keys(v).length > 0) ids.add(id);
  }
  return [...ids];
}

/** Reads the raw key-stat / lesson maps to find layouts with data (client only). */
export function readLayoutIdsWithData(results: readonly StoredResult[]): string[] {
  if (typeof window === "undefined") return [];
  return layoutIdsWithData(results, readRaw(STORAGE_KEYS.keyStats), readRaw(STORAGE_KEYS.lessons));
}

export const EXPORT_FORMAT = "layoutlearner-export";
export const EXPORT_VERSION = 1;

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  /** Raw localStorage values by key ("ll:v1:results", "ll:v1:settings", …), already JSON-parsed. */
  data: Record<string, unknown>;
}

/** Snapshot of every ll:v1:* key (stats and settings, including custom layouts). */
export function buildExport(): ExportFile {
  const data: Record<string, unknown> = {};
  if (typeof window !== "undefined") {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
        const v = readRaw(k);
        if (v != null) data[k] = v;
      }
    } catch {
      // storage unavailable: export what we have (nothing)
    }
  }
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), data };
}

export interface ImportSummary {
  results: number;
  layouts: string[];
  hasSettings: boolean;
  keys: string[];
}

export type ImportCheck = { ok: true; file: ExportFile; summary: ImportSummary } | { ok: false; error: string };

const SETTINGS_KEY = `${STORAGE_PREFIX}settings`;

/** Parse + validate an export file. Never throws. */
export function validateImport(text: string): ImportCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!isObject(parsed) || parsed.format !== EXPORT_FORMAT) return { ok: false, error: "That is not a LayoutLearner export file." };
  if (typeof parsed.version !== "number" || parsed.version > EXPORT_VERSION) return { ok: false, error: "This export comes from a newer version of LayoutLearner." };
  if (!isObject(parsed.data)) return { ok: false, error: "The export file has no data section." };
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (!k.startsWith(STORAGE_PREFIX)) return { ok: false, error: `Unexpected key "${k.slice(0, 40)}" in the export file.` };
    data[k] = v;
  }
  const results = data[STORAGE_KEYS.results];
  if (results !== undefined) {
    if (!Array.isArray(results)) return { ok: false, error: "The results in this file are not a list." };
    const bad = results.findIndex((r) => !isObject(r) || typeof r.id !== "string" || typeof r.layoutId !== "string" || typeof r.wpm !== "number" || typeof r.at !== "number");
    if (bad >= 0) return { ok: false, error: `Result #${bad + 1} in this file is malformed.` };
  }
  for (const key of [STORAGE_KEYS.keyStats, STORAGE_KEYS.lessons, STORAGE_KEYS.bests]) {
    if (data[key] !== undefined && !isObject(data[key])) return { ok: false, error: `"${key}" in this file has the wrong shape.` };
  }
  const activity = data[STORAGE_KEYS.activity];
  if (activity !== undefined && !(Array.isArray(activity) && activity.every((d) => typeof d === "string"))) {
    return { ok: false, error: "The activity days in this file are malformed." };
  }
  if (data[SETTINGS_KEY] !== undefined && !isObject(data[SETTINGS_KEY])) return { ok: false, error: "The settings in this file are malformed." };
  if (Object.keys(data).length === 0) return { ok: false, error: "The export file is empty." };
  const list = Array.isArray(results) ? (results as StoredResult[]) : [];
  return {
    ok: true,
    file: { format: EXPORT_FORMAT, version: parsed.version, exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : "", data },
    summary: {
      results: list.length,
      layouts: layoutIdsWithData(list, data[STORAGE_KEYS.keyStats], data[STORAGE_KEYS.lessons]),
      hasSettings: data[SETTINGS_KEY] !== undefined,
      keys: Object.keys(data),
    },
  };
}

/** Replace all stored stats (and settings, when the file has them) with a validated export. */
export function applyImport(file: ExportFile): void {
  if (typeof window === "undefined") return;
  // Stats keys missing from the file are cleared so the result equals the file.
  for (const key of Object.values(STORAGE_KEYS)) writeRawKey(key, file.data[key]);
  for (const [key, value] of Object.entries(file.data)) {
    if (!(Object.values(STORAGE_KEYS) as string[]).includes(key)) writeRawKey(key, value);
  }
}

/** Personal bests of one layout recomputed from its results (first result wins ties, as in the store). */
export function recomputeBests(results: readonly StoredResult[], layoutId: string): PersonalBests {
  const out: Record<string, PersonalBest> = {};
  for (const r of results.slice().sort((a, b) => a.at - b.at)) {
    if (r.layoutId !== layoutId) continue;
    const key = `${r.mode}:${r.modeValue}`;
    if (!out[key] || r.wpm > out[key].wpm) out[key] = { wpm: r.wpm, accuracy: r.accuracy, at: r.at, resultId: r.id };
  }
  return out;
}

/** Remove one test from the history and fix the layout's personal bests. Key stats are cumulative and stay. */
export function deleteResult(id: string): void {
  const all = readRaw(STORAGE_KEYS.results);
  if (!Array.isArray(all)) return;
  const target = all.find((r) => isObject(r) && r.id === id) as StoredResult | undefined;
  if (!target) return;
  const next = all.filter((r) => !(isObject(r) && r.id === id)) as StoredResult[];
  writeRawKey(STORAGE_KEYS.results, next);
  const bests = readRaw(STORAGE_KEYS.bests);
  writeRawKey(STORAGE_KEYS.bests, { ...(isObject(bests) ? bests : {}), [target.layoutId]: recomputeBests(next, target.layoutId) });
}

/** Raw practised days ("YYYY-MM-DD", any layout) from storage; the store only exposes the streak. */
export function readPracticedDays(): string[] {
  if (typeof window === "undefined") return [];
  const days = readRaw(STORAGE_KEYS.activity);
  return Array.isArray(days) ? days.filter((d): d is string => typeof d === "string") : [];
}
