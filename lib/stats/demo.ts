"use client";
// Sample data for the Stats page, so it can be explored (and verified) before any real test
// has been typed. Never runs on its own: only /stats?demo=1, the "Load sample data" action and
// the /dev/stats harness call it. Everything is written through the store's public record
// functions; what was there before is remembered so clearDemoData() can put it back.
import type { ParsedLayout } from "../types";
import type { CharStats, HistoryPoint, Mistypes, TestMode, TestResult } from "../typing/engine";
import { buildCurriculum } from "../lessons/curriculum";
import { keyForChar } from "../layout/keys";
import { STORAGE_KEYS, STORAGE_PREFIX, dayKey, getResults, recordLessonResult, recordResult } from "./store";
import { writeRawKey } from "./selectors";

export const DEMO_MARKER_KEY = `${STORAGE_PREFIX}demo`;

/** The deliberate weak spots of the sample data (expected characters). */
export const DEMO_WEAK = {
  /** Often mistyped (error rate ~20-30% vs ~3% elsewhere). */
  errors: ["b", "y", "c"],
  /** Typed correctly but slowly (~1.6-1.9x the average latency). */
  slow: ["p", "w", "m"],
  /** Simply the commonest English letters. */
  usage: ["e", "t", "a"],
} as const;

export interface SeedDemoOptions {
  /** Parsed layout of `layoutId`: makes mistypes land on neighbouring keys and seeds lesson progress. */
  layout?: ParsedLayout;
  /** "Now" in epoch ms (default Date.now()). */
  now?: number;
  /** Number of test results (default 40). */
  count?: number;
  seed?: number;
}

interface DemoMarkerEntry {
  resultIds: string[];
  /** Layout's data before seeding (undefined = had none). */
  prev: { keyStats?: unknown; bests?: unknown; lessons?: unknown };
  addedDays: string[];
}
type DemoMarker = Record<string, DemoMarkerEntry>;

const DAY_MS = 86400000;
// Days ago that have practice; the holes (16, 11, 6-5) are the "missed days".
const ACTIVE_DAYS = [20, 19, 18, 17, 15, 14, 13, 12, 10, 9, 8, 7, 4, 3, 2, 1, 0];
const FREQ: Record<string, number> = {
  " ": 17.5, e: 10.4, t: 7.4, a: 6.7, o: 6.2, i: 5.8, n: 5.7, s: 5.3, r: 5.0, h: 4.9, l: 3.4, d: 3.4, u: 2.4, c: 2.6, m: 2.2, w: 2.0,
  f: 1.9, g: 1.7, y: 1.8, p: 1.7, b: 1.4, v: 0.9, k: 0.7, x: 0.2, j: 0.15, q: 0.1, z: 0.1,
};
const FREQ_TOTAL = Object.values(FREQ).reduce((a, b) => a + b, 0);
const FALLBACK_CONFUSION: Record<string, string[]> = { b: ["v", "n"], y: ["t", "u"], c: ["x", "v"] };

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function readMarker(): DemoMarker {
  return asRecord(readJson(DEMO_MARKER_KEY)) as DemoMarker;
}

/** True when sample data is currently loaded for the layout (any layout when omitted). */
export function hasDemoData(layoutId?: string): boolean {
  if (typeof window === "undefined") return false;
  const marker = readMarker();
  return layoutId == null ? Object.keys(marker).length > 0 : !!marker[layoutId];
}

/** Characters on the keys left / right of the key that types `ch` (same row). */
function neighbours(layout: ParsedLayout | undefined, ch: string): string[] {
  const hit = layout ? keyForChar(layout, ch) : undefined;
  if (!layout || !hit) return FALLBACK_CONFUSION[ch] ?? [];
  const cx = hit.key.x + hit.key.w / 2;
  const cy = hit.key.y + hit.key.h / 2;
  return layout.keys
    .filter((k) => k.id !== hit.key.id && /^[a-z]$/.test(k.base))
    .map((k) => ({ k, d: Math.hypot(k.x + k.w / 2 - cx, (k.y + k.h / 2 - cy) * 1.6) }))
    .filter((o) => o.d < 1.7)
    .sort((a, b) => a.d - b.d)
    .slice(0, 2)
    .map((o) => o.k.base);
}

/**
 * Write ~40 plausible test results spread over the last 3 weeks (speed improving, accuracy
 * noisy, a few missed days), per-key stats with the DEMO_WEAK spots and, when `opts.layout` is
 * given, some lesson progress. Returns the number of results written. Calling it again for a
 * layout that already has sample data replaces that sample data.
 */
export function seedDemoData(layoutId: string, opts: SeedDemoOptions = {}): number {
  if (typeof window === "undefined") return 0;
  if (hasDemoData(layoutId)) clearDemoData(layoutId);

  const now = opts.now ?? Date.now();
  const count = Math.max(1, Math.round(opts.count ?? 40));
  const rng = mulberry32(hash(layoutId) + (opts.seed ?? 1));
  const noise = (amp: number) => (rng() + rng() - 1) * amp;

  const prevDays = new Set(Array.isArray(readJson(STORAGE_KEYS.activity)) ? (readJson(STORAGE_KEYS.activity) as string[]) : []);
  const entry: DemoMarkerEntry = {
    resultIds: [],
    prev: {
      keyStats: asRecord(readJson(STORAGE_KEYS.keyStats))[layoutId],
      bests: asRecord(readJson(STORAGE_KEYS.bests))[layoutId],
      lessons: asRecord(readJson(STORAGE_KEYS.lessons))[layoutId],
    },
    addedDays: [],
  };

  // Timestamps: 2-3 tests on each active day, oldest first, never in the future.
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const times: number[] = [];
  const perDay = ACTIVE_DAYS.map((_, i) => 2 + ((i * 7 + 1) % 3 === 0 ? 1 : 0) + (i % 4 === 1 ? 1 : 0));
  ACTIVE_DAYS.forEach((ago, i) => {
    for (let k = 0; k < perDay[i]; k++) {
      const at = midnight.getTime() - ago * DAY_MS + (8 + k * 3.4 + rng() * 1.5) * 3600000;
      times.push(at);
    }
  });
  times.sort((a, b) => a - b);
  // Keep the newest `count`, and pull anything "later today" back before now.
  const picked = times.slice(-count).map((t, i, arr) => (t > now ? now - (arr.length - i) * 7 * 60000 : t));
  picked.sort((a, b) => a - b);

  const confusion: Record<string, string[]> = {};
  for (const ch of Object.keys(FREQ)) if (ch !== " ") confusion[ch] = neighbours(opts.layout, ch);

  picked.forEach((at, idx) => {
    const p = picked.length > 1 ? idx / (picked.length - 1) : 1;
    const roll = rng();
    const [mode, modeValue]: [TestMode, number] = roll < 0.55 ? ["time", 30] : roll < 0.7 ? ["time", 60] : roll < 0.9 ? ["words", 25] : ["words", 50];
    const wpm = round2(clamp(27 + 25 * Math.pow(p, 0.85) + noise(5) + (mode === "words" ? 1.5 : 0), 12, 140));
    const accuracy = round2(clamp(90 + 5.5 * p + noise(3.2), 80, 99.8));
    const raw = round2(wpm / Math.pow(accuracy / 100, 1.4) + rng() * 1.5);
    const consistency = round2(clamp(58 + 20 * p + noise(8), 30, 96));
    const durationMs = mode === "time" ? modeValue * 1000 : Math.round(((modeValue * 5.6) / 5 / wpm) * 60000);
    const minutes = durationMs / 60000;
    const correct = Math.round(wpm * 5 * minutes);
    const typed = Math.max(correct, Math.round(raw * 5 * minutes));
    const incorrect = Math.max(0, Math.round(typed * (1 - accuracy / 100)));
    const expectedTotal = correct + incorrect;
    const baseMs = 60000 / (raw * 5);
    const baseErr = clamp((1 - accuracy / 100) * 0.55, 0.005, 0.2);

    const charStats: CharStats = {};
    const mistypes: Mistypes = {};
    let spaces = 0;
    Object.keys(FREQ).forEach((ch, ci) => {
      const exact = (expectedTotal * FREQ[ch]) / FREQ_TOTAL;
      const attempts = Math.floor(exact) + (rng() < exact % 1 ? 1 : 0);
      if (attempts === 0) return;
      const weakIdx = (DEMO_WEAK.errors as readonly string[]).indexOf(ch);
      const errRate = weakIdx >= 0 ? (0.34 - weakIdx * 0.05) * (1.15 - 0.35 * p) : baseErr * (0.35 + ((ci * 37) % 10) / 30);
      let misses = 0;
      for (let i = 0; i < attempts; i++) if (rng() < errRate) misses++;
      const hits = attempts - misses;
      const slowIdx = (DEMO_WEAK.slow as readonly string[]).indexOf(ch);
      const factor = slowIdx >= 0 ? 1.95 - slowIdx * 0.15 : 0.86 + ((ci * 53) % 11) / 40;
      const samples = hits;
      charStats[ch] = { hits, misses, totalMs: Math.round(samples * baseMs * factor * (1 + noise(0.06))), samples };
      if (ch === " ") spaces = hits;
      if (misses > 0) {
        const options = confusion[ch]?.length ? confusion[ch] : ch === " " ? ["n", "m"] : [" "];
        const m: Record<string, number> = {};
        for (let i = 0; i < misses; i++) {
          const typedCh = options[rng() < 0.72 ? 0 : Math.min(1, options.length - 1)];
          m[typedCh] = (m[typedCh] ?? 0) + 1;
        }
        mistypes[ch] = m;
      }
    });

    const seconds = Math.max(1, Math.round(durationMs / 1000));
    const history: HistoryPoint[] = [];
    for (let s = 1; s <= seconds; s++) {
      const ramp = 0.8 + 0.2 * Math.min(1, s / 4);
      history.push({ t: s, wpm: round2(wpm * ramp + noise(2)), raw: round2(raw * ramp + noise(7)), errors: rng() < (incorrect / seconds) * 0.9 ? 1 : 0 });
    }

    const result: TestResult = {
      mode,
      modeValue,
      wpm,
      raw,
      accuracy,
      consistency,
      chars: { correct, incorrect, extra: 0, missed: 0, spaces },
      durationMs,
      history,
      charStats,
      mistypes,
      keystrokes: { correct, incorrect },
      wordsTyped: Math.round(expectedTotal / 5.6),
    };
    const { entry: stored } = recordResult({ layoutId, result, at });
    entry.resultIds.push(stored.id);
    if (!prevDays.has(dayKey(at)) && !entry.addedDays.includes(dayKey(at))) entry.addedDays.push(dayKey(at));
  });

  // Lesson progress: the first lessons done with a spread of stars, one attempted without passing.
  if (opts.layout) {
    const starPlan = [3, 3, 2, 3, 2, 2, 1, 1, 0];
    const blank = { chars: { correct: 0, incorrect: 0, extra: 0, missed: 0, spaces: 0 }, durationMs: 30000, history: [], charStats: {}, mistypes: {}, keystrokes: { correct: 0, incorrect: 0 }, wordsTyped: 0 };
    buildCurriculum(opts.layout)
      .slice(0, starPlan.length)
      .forEach((lesson, i) => {
        const stars = starPlan[i];
        const mult = stars === 3 ? 1.6 : stars === 2 ? 1.3 : stars === 1 ? 1.05 : 0.7;
        const acc = stars === 3 ? 98.6 : stars === 2 ? 96 : stars === 1 ? Math.min(99, lesson.goal.accuracy + 0.5) : Math.max(50, lesson.goal.accuracy - 6);
        const at = picked[Math.min(picked.length - 1, Math.floor((i / starPlan.length) * picked.length * 0.7))] + 5 * 60000;
        recordLessonResult(
          layoutId,
          lesson,
          { ...blank, mode: "words", modeValue: 20, wpm: round2(lesson.goal.wpm * mult), raw: round2(lesson.goal.wpm * mult + 2), accuracy: acc, consistency: 70 },
          Math.min(at, now),
        );
      });
  }

  writeRawKey(DEMO_MARKER_KEY, { ...readMarker(), [layoutId]: entry });
  return entry.resultIds.length;
}

/**
 * Remove sample data (for one layout, or every layout it was loaded for) and restore the key
 * stats / bests / lesson progress the layout had before seeding. Real tests typed while the
 * sample data was loaded keep their history rows, but their per-key stats are part of what is
 * rolled back.
 */
export function clearDemoData(layoutId?: string): void {
  if (typeof window === "undefined") return;
  const marker = readMarker();
  const ids = layoutId == null ? Object.keys(marker) : marker[layoutId] ? [layoutId] : [];
  if (ids.length === 0) return;

  const drop = new Set(ids.flatMap((id) => marker[id].resultIds ?? []));
  writeRawKey(STORAGE_KEYS.results, getResults().filter((r) => !drop.has(r.id)));

  const restore = (key: string, field: keyof DemoMarkerEntry["prev"]) => {
    const all = { ...asRecord(readJson(key)) };
    for (const id of ids) {
      const prev = marker[id].prev?.[field];
      if (prev === undefined || prev === null) delete all[id];
      else all[id] = prev;
    }
    writeRawKey(key, all);
  };
  restore(STORAGE_KEYS.keyStats, "keyStats");
  restore(STORAGE_KEYS.bests, "bests");
  restore(STORAGE_KEYS.lessons, "lessons");

  // Days that only exist because of the sample data, unless a remaining result falls on them.
  const realDays = new Set(getResults().map((r) => dayKey(r.at)));
  const added = new Set(ids.flatMap((id) => marker[id].addedDays ?? []).filter((d) => !realDays.has(d)));
  const days = readJson(STORAGE_KEYS.activity);
  if (Array.isArray(days)) writeRawKey(STORAGE_KEYS.activity, days.filter((d) => !added.has(d)));

  const rest = { ...marker };
  for (const id of ids) delete rest[id];
  writeRawKey(DEMO_MARKER_KEY, Object.keys(rest).length ? rest : undefined);
}
