// Structural analysis of split / ergonomic boards (columnar stagger, thumb clusters).
// Works from geometry: halves -> columns -> logical rows -> finger per column, thumb cluster,
// home keys. Legends are only consulted to tell "produces a character" rows from the number
// row and modifier rows, never for which letter sits where, so any letter arrangement works.
import type { Finger, Hand, LayoutKey } from "../types";
import { detectHalves, keyAngle, keyCenter, rotatePoint, type Point } from "./geometry";

export interface SplitKeyInfo {
  hand: Hand;
  finger: Finger;
  /** Logical row within the half: 0 = topmost row of the main block; thumb keys come last. */
  row: number;
  /** Row relative to the home row (-2 number row, -1 top, 0 home, 1 bottom). Unset for thumb keys. */
  rel?: number;
  /**
   * Finger-column index counted from the centre gap: 0 = inner index column (QWERTY T/G/B or
   * Y/H/N), 1 = index home column, 2 = middle, 3 = ring, 4 = pinky, 5+ = outer columns.
   * Negative for extra columns inside the index columns. Unset for thumb keys.
   */
  col?: number;
  isHome: boolean;
}

export interface SplitAnalysis {
  splitX: number;
  info: Map<LayoutKey, SplitKeyInfo>;
}

const COLUMN_TOLERANCE = 0.3;
/** How much farther than the nearest thumb key (key units) the resting thumb key may be. */
const THUMB_REACH = 1.3;
/** Space, Enter, Backspace or a character: a key the thumb actually types with. */
const isThumbTypingKey = (k: LayoutKey) => k.base !== "" || /^(space|enter|return|bksp|backspace|bspc)$/i.test(k.label.trim());
const isCharKey = (k: LayoutKey) => k.base !== "" && k.base !== " ";
const isLetterKey = (k: LayoutKey) => /^\p{L}$/u.test(k.base);
const isDigitKey = (k: LayoutKey) => /^\d$/.test(k.base);

interface Column {
  x: number;
  keys: LayoutKey[];
  /** Index among the regular columns, counted from the centre gap (-1: not regular). */
  regular: number;
}

const FINGER_BY_COLUMN: Finger[] = ["index", "index", "middle", "ring", "pinky"];
const fingerForColumn = (col: number): Finger => FINGER_BY_COLUMN[Math.max(0, Math.min(col, 4))];

function analyseHalf(keys: LayoutKey[], hand: Hand): Map<LayoutKey, SplitKeyInfo> | null {
  const inward = hand === "L" ? 1 : -1;

  // The half's own frame: undo the rotation most of its keys share (0 on most boards).
  const angleCount = new Map<number, number>();
  for (const k of keys) angleCount.set(keyAngle(k), (angleCount.get(keyAngle(k)) ?? 0) + 1);
  const bodyAngle = [...angleCount.entries()].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]))[0][0];
  const pos = new Map<LayoutKey, Point>();
  for (const k of keys) pos.set(k, rotatePoint(keyCenter(k), -bodyAngle));
  const px = (k: LayoutKey) => pos.get(k)!.x;
  const py = (k: LayoutKey) => pos.get(k)!.y;
  const top = (k: LayoutKey) => py(k) - k.h / 2;

  const body = keys.filter((k) => keyAngle(k) === bodyAngle);
  const offAngle = keys.filter((k) => keyAngle(k) !== bodyAngle);

  // ---- columns: clusters of body keys sharing a centre x
  const columns: Column[] = [];
  for (const k of body.slice().sort((a, b) => px(a) - px(b))) {
    const last = columns[columns.length - 1];
    if (last && Math.abs(px(k) - last.x) <= COLUMN_TOLERANCE) {
      last.keys.push(k);
      last.x = last.keys.reduce((s, q) => s + px(q), 0) / last.keys.length;
    } else columns.push({ x: px(k), keys: [k], regular: -1 });
  }
  for (const c of columns) c.keys.sort((a, b) => py(a) - py(b));
  const major = columns.filter((c) => c.keys.length >= 3);
  if (major.length < 4) return null;

  // ---- logical rows. Neighbouring full columns are staggered by less than a key, so their
  // top keys share a row; a column that starts a whole key lower starts a row lower.
  const rowOf = new Map<LayoutKey, number>();
  const base = new Map<Column, number>();
  major.forEach((c, i) => {
    if (i === 0) base.set(c, 0);
    else {
      const d = top(c.keys[0]) - top(major[i - 1].keys[0]);
      base.set(c, base.get(major[i - 1])! + Math.sign(d) * Math.floor(Math.abs(d) + 0.125));
    }
    for (const k of c.keys) rowOf.set(k, base.get(c)! + Math.round(top(k) - top(c.keys[0])));
  });
  const nearestOf = (list: Column[], x: number) => list.reduce((b, c) => (Math.abs(c.x - x) < Math.abs(b.x - x) ? c : b));
  for (const c of columns) {
    if (major.includes(c)) continue;
    const m = nearestOf(major, c.x);
    for (const k of c.keys) rowOf.set(k, base.get(m)! + Math.round(top(k) - top(m.keys[0])));
  }
  const minRow = Math.min(...rowOf.values());
  for (const [k, r] of rowOf) rowOf.set(k, r - minRow);

  const rows = new Map<number, LayoutKey[]>();
  for (const k of body) {
    const r = rowOf.get(k)!;
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r)!.push(k);
  }
  const rowIds = [...rows.keys()].sort((a, b) => a - b);

  // ---- alpha rows: up to three consecutive rows of character keys holding the most letters
  const count = (r: number, pred: (k: LayoutKey) => boolean) => (rows.get(r) ?? []).filter(pred).length;
  const candidate = (r: number) => {
    const chars = count(r, (k) => isCharKey(k) && !isDigitKey(k));
    return chars >= 3 && chars * 2 >= (rows.get(r) ?? []).length;
  };
  let alpha: number[] = [];
  let bestLetters = -1;
  for (const start of rowIds) {
    if (!candidate(start)) continue;
    const win = [start];
    while (win.length < 3 && candidate(win[win.length - 1] + 1)) win.push(win[win.length - 1] + 1);
    const letters = win.reduce((s, r) => s + count(r, isLetterKey), 0);
    if (letters > bestLetters) {
      bestLetters = letters;
      alpha = win;
    }
  }
  if (alpha.length === 0) {
    // Blank or unreadable legends: take the full-width rows, skipping a number row when there are 4+.
    const longest = Math.max(...rowIds.map((r) => rows.get(r)!.length));
    const full = rowIds.filter((r) => rows.get(r)!.length >= Math.max(3, longest * 0.6));
    alpha = full.length >= 4 ? full.slice(1, 4) : full.slice(0, 3);
    if (alpha.length === 0) return null;
  }
  const homeRow = alpha[Math.min(1, alpha.length - 1)];
  const lastAlpha = alpha[alpha.length - 1];

  // ---- regular columns: a normal-height key in every alpha row
  const keyAt = (c: Column, r: number) => c.keys.find((k) => rowOf.get(k) === r);
  const regular = columns
    .filter((c) => alpha.every((r) => (keyAt(c, r)?.h ?? 9) <= 1.25))
    .sort((a, b) => inward * (b.x - a.x));
  if (regular.length < 4) return null;
  // Seven or more: an innermost column without characters is an extra column, not the index column.
  const extraInner = regular.length >= 7 && !alpha.some((r) => isCharKey(keyAt(regular[0], r)!)) ? 1 : 0;
  regular.forEach((c, i) => (c.regular = i - extraInner));
  const colIndex = (c: Column): number => {
    if (regular.includes(c)) return c.regular;
    const n = nearestOf(regular, c.x);
    // Columns beyond either edge extend that edge; ones in between share the nearest column.
    if (inward * (c.x - regular[0].x) > 0) return Math.min(n.regular, 0) - 1;
    if (inward * (c.x - regular[regular.length - 1].x) < 0) return n.regular + 1;
    return n.regular;
  };

  const info = new Map<LayoutKey, SplitKeyInfo>();
  const thumbs: LayoutKey[] = [];
  const belowAlpha: { key: LayoutKey; col: number }[] = [];

  for (const c of columns) {
    const ci = colIndex(c);
    const isRegular = regular.includes(c);
    const lastKey = isRegular ? keyAt(c, lastAlpha) : undefined;
    for (const k of c.keys) {
      const r = rowOf.get(k)!;
      if (r > lastAlpha) {
        // Below the letters: a thumb key unless it continues a finger column without a break.
        const continues = !!lastKey && top(k) - (top(lastKey) + lastKey.h) - (r - lastAlpha - 1) <= 0.3;
        if (!continues) {
          thumbs.push(k);
          continue;
        }
        belowAlpha.push({ key: k, col: ci });
      }
      info.set(k, { hand, finger: fingerForColumn(ci), row: r, rel: r - homeRow, col: ci, isHome: false });
    }
  }

  // Keys rotated differently from the main block: the thumb cluster when they sit below the
  // letters, otherwise (splayed columns) they follow the nearest finger column.
  for (const k of offAngle) {
    const c = nearestOf(regular, px(k));
    const lastKey = keyAt(c, lastAlpha)!;
    if (py(k) > py(lastKey) + 0.6) {
      thumbs.push(k);
      continue;
    }
    const near = c.keys.reduce((b, q) => (Math.abs(py(q) - py(k)) < Math.abs(py(b) - py(k)) ? q : b));
    const r = rowOf.get(near)!;
    info.set(k, { hand, finger: fingerForColumn(c.regular), row: r, rel: r - homeRow, col: c.regular, isHome: false });
  }

  // No rotated thumb cluster (flat, Ferris / Atreus-style halves): the keys under the two index
  // columns are pressed by the thumb, together with any lone key beyond them.
  if (offAngle.length === 0) {
    for (const b of belowAlpha) {
      if (b.col <= 1) {
        thumbs.push(b.key);
        info.delete(b.key);
      }
    }
  } else {
    // A rotated cluster often starts with one unrotated key tucked under the index column (the
    // outer thumb key of a Corne). It belongs to the thumb, not to the finger above it, when it
    // sits right next to a key of the rotated cluster.
    const rotated = [...thumbs];
    for (const b of belowAlpha) {
      if (b.col > 1) continue;
      const near = rotated.some((t) => Math.hypot(px(t) - px(b.key), py(t) - py(b.key)) <= 1.5);
      if (near) {
        thumbs.push(b.key);
        info.delete(b.key);
      }
    }
  }

  // ---- home keys: index-home, middle, ring, pinky columns on the home row
  let indexHome: LayoutKey | undefined;
  for (const c of regular) {
    if (c.regular < 1 || c.regular > 4) continue;
    const k = keyAt(c, homeRow);
    if (!k) continue;
    info.get(k)!.isHome = true;
    if (c.regular === 1) indexHome = k;
  }

  // ---- thumbs: every key of the cluster, one of them the resting key
  const thumbRow = Math.max(...[...info.values()].map((i) => i.row), lastAlpha) + 1;
  for (const k of thumbs) info.set(k, { hand, finger: "thumb", row: thumbRow, isHome: false });
  if (thumbs.length > 0) {
    // A relaxed thumb sits a little inside of, and a good two keys below, the index home key.
    const anchor = indexHome ?? keyAt(regular[Math.min(1, regular.length - 1)], homeRow) ?? regular[0].keys[0];
    const target = { x: px(anchor) + inward * 0.75, y: py(anchor) + 2.3 };
    const d = (k: LayoutKey) => Math.hypot(px(k) - target.x, py(k) - target.y);
    const nearest = thumbs.reduce((b, k) => (d(k) < d(b) - 1e-6 ? k : b));
    // Typists rest the thumb on the main thumb key, not on a layer key that happens to be closest:
    // among the keys within easy reach of the nearest one prefer a bigger key, then one that
    // types something (space, enter, backspace or a character), then simply the nearest.
    const reach = thumbs.filter((k) => d(k) <= d(nearest) + THUMB_REACH);
    const pick = (pool: LayoutKey[]) => pool.reduce((b, k) => (d(k) < d(b) - 1e-6 ? k : b));
    const big = reach.filter((k) => Math.max(k.w, k.h) > 1.2);
    const typing = reach.filter(isThumbTypingKey);
    // Space and Enter outrank Backspace, which is a reach key rather than a resting one.
    const main = typing.filter((k) => !/^(bksp|backspace|bspc)$/i.test(k.label.trim()));
    const rest = big.length > 0 ? pick(big) : main.length > 0 ? pick(main) : typing.length > 0 ? pick(typing) : nearest;
    info.get(rest)!.isHome = true;
  }

  return info;
}

/**
 * Analyses a split board. Returns null when the keys do not form two recognisable halves
 * (one-piece boards, or halves without at least four finger columns).
 */
export function analyseSplit(keys: LayoutKey[]): SplitAnalysis | null {
  const halves = detectHalves(keys);
  if (!halves) return null;
  const info = new Map<LayoutKey, SplitKeyInfo>();
  for (const hand of ["L", "R"] as const) {
    const part = analyseHalf(keys.filter((k) => halves.hand.get(k) === hand), hand);
    if (!part) return null;
    for (const [k, v] of part) info.set(k, v);
  }
  // Keep row numbers comparable across halves: line the home rows up.
  const homeRowOf = (hand: Hand) => {
    for (const v of info.values()) if (v.hand === hand && v.rel === 0) return v.row;
    return 0;
  };
  const shift = homeRowOf("L") - homeRowOf("R");
  if (shift !== 0) {
    const moved: Hand = shift > 0 ? "R" : "L";
    for (const v of info.values()) if (v.hand === moved) v.row += Math.abs(shift);
  }
  const thumbRow = Math.max(...[...info.values()].filter((v) => v.finger !== "thumb").map((v) => v.row)) + 1;
  for (const v of info.values()) if (v.finger === "thumb") v.row = thumbRow;
  return { splitX: halves.splitX, info };
}
