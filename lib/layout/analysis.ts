// Layout analysis: how the work of typing English is spread over rows, fingers and
// hands on a given layout, and how the layout differs from QWERTY.
//
// The corpus is the built-in English word list (lib/typing/data/english), which is
// ordered roughly by frequency. Words are weighted with a Zipf–Mandelbrot curve so the
// letter / bigram mix resembles running text rather than a dictionary.
import type { LayoutKey, ParsedLayout } from "../types";
import { fingerIndex } from "../types";
import { ENGLISH_1K } from "../typing/data/english";
import { parseLayout } from "./parse";
import { getPreset } from "./presets";

export const LETTERS = "abcdefghijklmnopqrstuvwxyz";

export interface Corpus {
  /** Number of distinct words sampled. */
  words: number;
  /** char → share of all characters (sums to 1). */
  chars: Map<string, number>;
  /** two-character string → share of all in-word bigrams (sums to 1). */
  bigrams: Map<string, number>;
}

/** Builds a weighted character / bigram frequency table. Words are assumed most-frequent first. */
export function buildCorpus(words: readonly string[]): Corpus {
  const chars = new Map<string, number>();
  const bigrams = new Map<string, number>();
  let charTotal = 0;
  let bigramTotal = 0;
  words.forEach((word, rank) => {
    const weight = 1 / (rank + 2.7);
    const cs = Array.from(word.toLowerCase());
    cs.forEach((c, i) => {
      chars.set(c, (chars.get(c) ?? 0) + weight);
      charTotal += weight;
      if (i > 0) {
        const bg = cs[i - 1] + c;
        bigrams.set(bg, (bigrams.get(bg) ?? 0) + weight);
        bigramTotal += weight;
      }
    });
  });
  if (charTotal > 0) for (const [k, v] of chars) chars.set(k, v / charTotal);
  if (bigramTotal > 0) for (const [k, v] of bigrams) bigrams.set(k, v / bigramTotal);
  return { words: words.length, chars, bigrams };
}

let englishCorpus: Corpus | undefined;
/** Corpus over the built-in English 1k list (computed once). */
export function getEnglishCorpus(): Corpus {
  return (englishCorpus ??= buildCorpus(ENGLISH_1K));
}

export interface RowShares {
  /** Row above the home row. */
  top: number;
  home: number;
  /** Row below the home row. */
  bottom: number;
  /** Number row and anything further away. */
  other: number;
}

export interface LayoutAnalysis {
  /** Share (0..1) of corpus characters this layout can type at all. */
  coverage: number;
  /** Shares (0..1, sum 1) of typed characters per row; null when the home row is unknown. */
  rows: RowShares | null;
  /** Share per finger in FINGER_ORDER (length 10, sums to `fingerCoverage`). */
  fingers: number[];
  /** Share of typed characters that land on a key with a known finger. */
  fingerCoverage: number;
  /** Left / right hand shares (sum 1); null when no fingers are assigned. */
  hands: { left: number; right: number } | null;
  /** Share (0..1) of bigrams typed by one finger on two different keys; null without fingers. */
  sfb: number | null;
  /** Worst same-finger bigrams, most frequent first. `share` is of all bigrams. */
  topSfb: { bigram: string; share: number }[];
}

/** The unshifted key for each character (main block wins over numpad duplicates). */
function baseKeyMap(layout: ParsedLayout): Map<string, LayoutKey> {
  const map = new Map<string, LayoutKey>();
  const numpad = (k: LayoutKey) => !!k.code && k.code.startsWith("Numpad");
  for (const k of layout.keys) if (k.base && !numpad(k) && !map.has(k.base)) map.set(k.base, k);
  for (const k of layout.keys) if (k.base && !map.has(k.base)) map.set(k.base, k);
  return map;
}

/** y (key units) of the home row, from the home keys other than the space bar. */
export function homeRowY(layout: ParsedLayout): number | null {
  const counts = new Map<number, number>();
  for (const k of layout.keys) {
    if (!k.isHome || k.base === " " || k.finger?.finger === "thumb" || k.rotation) continue;
    const y = Math.round(k.y * 4) / 4;
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [y, n] of counts) if (n > bestN) [best, bestN] = [y, n];
  return best;
}

/** Ids of every character key sitting on the home row (not only the eight resting keys). */
export function homeRowKeyIds(layout: ParsedLayout): string[] {
  const y = homeRowY(layout);
  if (y === null) return layout.keys.filter((k) => k.isHome && k.base !== " ").map((k) => k.id);
  return layout.keys
    .filter((k) => !!k.base && k.base !== " " && !k.rotation && Math.abs(k.y - y) < 0.3 && k.h < 1.5 && !(k.code && k.code.startsWith("Numpad")))
    .map((k) => k.id);
}

/** Characters on the home row, left to right (character keys only). */
export function homeRowChars(layout: ParsedLayout): string[] {
  const ids = new Set(homeRowKeyIds(layout));
  return layout.keys
    .filter((k) => ids.has(k.id) && k.base && k.base !== " ")
    .sort((a, b) => a.x - b.x)
    .map((k) => k.base);
}

export function analyzeLayout(layout: ParsedLayout, corpus: Corpus = getEnglishCorpus()): LayoutAnalysis {
  const keyOf = baseKeyMap(layout);
  const homeY = homeRowY(layout);

  let covered = 0;
  const rowSum: RowShares = { top: 0, home: 0, bottom: 0, other: 0 };
  const fingers = new Array<number>(10).fill(0);
  let fingered = 0;
  let left = 0;
  let right = 0;

  for (const [ch, share] of corpus.chars) {
    const key = keyOf.get(ch);
    if (!key) continue;
    covered += share;
    if (homeY !== null) {
      const d = Math.round(key.y - homeY);
      if (d === 0) rowSum.home += share;
      else if (d === -1) rowSum.top += share;
      else if (d === 1) rowSum.bottom += share;
      else rowSum.other += share;
    }
    if (key.finger) {
      const fi = fingerIndex(key.finger);
      if (fi >= 0) fingers[fi] += share;
      fingered += share;
      if (key.finger.hand === "L") left += share;
      else right += share;
    }
  }

  const norm = (n: number) => (covered > 0 ? n / covered : 0);
  const rows: RowShares | null =
    homeY === null || covered === 0
      ? null
      : { top: norm(rowSum.top), home: norm(rowSum.home), bottom: norm(rowSum.bottom), other: norm(rowSum.other) };

  let sfbSum = 0;
  let bigramCovered = 0;
  const offenders: { bigram: string; share: number }[] = [];
  for (const [bg, share] of corpus.bigrams) {
    const [a, b] = Array.from(bg);
    const ka = keyOf.get(a);
    const kb = keyOf.get(b);
    if (!ka || !kb || !ka.finger || !kb.finger) continue;
    bigramCovered += share;
    if (ka.id !== kb.id && fingerIndex(ka.finger) === fingerIndex(kb.finger)) {
      sfbSum += share;
      offenders.push({ bigram: bg, share });
    }
  }
  offenders.sort((x, y) => y.share - x.share);

  return {
    coverage: covered,
    rows,
    fingers: fingers.map(norm),
    fingerCoverage: norm(fingered),
    hands: fingered > 0 ? { left: left / fingered, right: right / fingered } : null,
    sfb: bigramCovered > 0 ? sfbSum / bigramCovered : null,
    topSfb: offenders.slice(0, 5).map((o) => ({ bigram: o.bigram, share: bigramCovered > 0 ? o.share / bigramCovered : 0 })),
  };
}

// ---------------------------------------------------------------------------
// Difference from QWERTY
// ---------------------------------------------------------------------------

let qwertyByCode: Map<string, string> | undefined;
/** KeyboardEvent.code → unshifted character on the QWERTY preset. */
function qwertyChars(): Map<string, string> {
  if (qwertyByCode) return qwertyByCode;
  const map = new Map<string, string>();
  const preset = getPreset("qwerty");
  if (preset) for (const k of parseLayout(preset.source, preset.name).keys) if (k.code && k.base) map.set(k.code, k.base);
  return (qwertyByCode = map);
}

export interface QwertyDiff {
  /** False when no key of the layout could be matched to a physical QWERTY position. */
  comparable: boolean;
  /** Letters (a–z) that sit on a different physical key than on QWERTY, alphabetical. */
  movedLetters: string[];
  /** Letters the layout does not have at all. */
  missingLetters: string[];
  /** Character keys whose character differs from QWERTY at that position. */
  movedKeyIds: string[];
  /** Every other key (same character as QWERTY, or not a character key). */
  sameKeyIds: string[];
}

/** Compares each key with what QWERTY has at the same physical position (KeyboardEvent.code). */
export function diffFromQwerty(layout: ParsedLayout): QwertyDiff {
  const ref = qwertyChars();
  const movedKeyIds: string[] = [];
  const sameKeyIds: string[] = [];
  let matched = 0;
  for (const k of layout.keys) {
    const expected = k.code ? ref.get(k.code) : undefined;
    if (expected !== undefined) matched++;
    // Character keys at positions QWERTY has no character for (or with no known position) count as moved
    // only when the position is known to hold something else.
    if (k.base && k.base !== " " && expected !== undefined && expected !== k.base) movedKeyIds.push(k.id);
    else sameKeyIds.push(k.id);
  }

  const keyOf = baseKeyMap(layout);
  const movedLetters: string[] = [];
  const missingLetters: string[] = [];
  for (const letter of LETTERS) {
    const key = keyOf.get(letter);
    if (!key) missingLetters.push(letter);
    else if (key.code !== `Key${letter.toUpperCase()}`) movedLetters.push(letter);
  }
  return { comparable: matched > 0, movedLetters, missingLetters, movedKeyIds, sameKeyIds };
}
