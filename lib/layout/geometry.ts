// Geometry helpers over LayoutKey / ParsedLayout. Everything here applies a key's KLE
// rotation, so callers can reason about where a key really is on the board.
import type { Hand, LayoutKey, ParsedLayout } from "../types";

export interface Point {
  x: number;
  y: number;
}

/** Rotates `p` by `angle` degrees clockwise (screen coordinates, y down) about (cx, cy). */
export function rotatePoint(p: Point, angle: number, cx = 0, cy = 0): Point {
  if (!angle) return { x: p.x, y: p.y };
  const a = (angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** Rotation of a key in degrees clockwise (0 when unrotated). */
export function keyAngle(key: LayoutKey): number {
  return key.rotation?.angle ?? 0;
}

/** Centre of the key cap in key units, with the key's rotation applied. */
export function keyCenter(key: LayoutKey): Point {
  const c = { x: key.x + key.w / 2, y: key.y + key.h / 2 };
  return key.rotation ? rotatePoint(c, key.rotation.angle, key.rotation.cx, key.rotation.cy) : c;
}

/** The four corners (top-left, top-right, bottom-right, bottom-left) with rotation applied. */
export function keyCorners(key: LayoutKey): Point[] {
  const pts: Point[] = [
    { x: key.x, y: key.y },
    { x: key.x + key.w, y: key.y },
    { x: key.x + key.w, y: key.y + key.h },
    { x: key.x, y: key.y + key.h },
  ];
  const r = key.rotation;
  return r ? pts.map((p) => rotatePoint(p, r.angle, r.cx, r.cy)) : pts;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Axis-aligned bounding box of one key (rotation applied). */
export function keyBounds(key: LayoutKey): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of keyCorners(key)) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Halves
// ---------------------------------------------------------------------------

export interface HalfSplit {
  /** x (key units) of the line between the two halves. */
  splitX: number;
  /** Width of the empty gap between the halves' main key blocks (0 for angle-detected boards). */
  gap: number;
  hand: Map<LayoutKey, Hand>;
}

const MIN_GAP = 0.75;
const angleKey = (k: LayoutKey) => Math.round(keyAngle(k) * 10) / 10;

/**
 * Detects a split board from geometry alone: a clear vertical gap (>= 0.75u) near the middle
 * of the main key block, with a comparable number of keys on each side. Rotated thumb clusters
 * are ignored when looking for the gap (they often fan into it). Boards whose two halves are
 * rotated towards each other without a gap (Atreus-style) are recognised by their two
 * opposite rotation groups. Returns null for one-piece boards.
 */
export function detectHalves(keys: readonly LayoutKey[]): HalfSplit | null {
  if (keys.length < 16) return null;

  // "Body" keys: drop rotation groups that hold only a small part of the board (thumb clusters).
  const groups = new Map<number, LayoutKey[]>();
  for (const k of keys) {
    const a = angleKey(k);
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a)!.push(k);
  }
  let body = [...groups.values()].filter((g) => g.length >= keys.length * 0.2).flat();
  if (body.length < keys.length * 0.5) body = keys.slice();

  const spans = body.map(keyBounds).sort((a, b) => a.minX - b.minX);
  const lo = spans[0].minX;
  const hi = Math.max(...spans.map((s) => s.maxX));
  let best: { from: number; to: number } | null = null;
  let reach = spans[0].maxX;
  for (const s of spans) {
    if (s.minX - reach >= MIN_GAP - 1e-6) {
      const mid = (reach + s.minX) / 2;
      const rel = (mid - lo) / (hi - lo);
      if (rel >= 0.3 && rel <= 0.7 && (!best || s.minX - reach > best.to - best.from)) best = { from: reach, to: s.minX };
    }
    reach = Math.max(reach, s.maxX);
  }

  let splitX: number | undefined;
  let gap = 0;
  if (best) {
    splitX = (best.from + best.to) / 2;
    gap = best.to - best.from;
  } else {
    // No gap: two big rotation groups of opposite sign, side by side.
    const big = [...groups.entries()].filter(([, g]) => g.length >= keys.length * 0.3);
    if (big.length === 2 && big[0][0] * big[1][0] < 0) {
      const cx = big.map(([, g]) => g.reduce((s, k) => s + keyCenter(k).x, 0) / g.length);
      if (Math.abs(cx[0] - cx[1]) >= 3) splitX = (cx[0] + cx[1]) / 2;
    }
  }
  if (splitX === undefined) return null;

  const hand = new Map<LayoutKey, Hand>();
  let left = 0;
  for (const k of keys) {
    const h: Hand = keyCenter(k).x < splitX ? "L" : "R";
    hand.set(k, h);
    if (h === "L") left++;
  }
  const right = keys.length - left;
  if (Math.min(left, right) < 8 || Math.min(left, right) / Math.max(left, right) < 0.6) return null;
  return { splitX, gap, hand };
}

export interface LayoutHalves {
  /** True when the board is physically split into two halves (see detectHalves). */
  split: boolean;
  /** x of the dividing line: the middle of the gap on split boards, else the board's centre line. */
  splitX: number;
  left: LayoutKey[];
  right: LayoutKey[];
}

const halvesCache = new WeakMap<readonly LayoutKey[], LayoutHalves>();

/**
 * The two halves of a layout. On split boards membership is geometric (side of the gap);
 * on one-piece boards it follows each key's finger hand, falling back to the centre line.
 */
export function layoutHalves(layout: ParsedLayout): LayoutHalves {
  const hit = halvesCache.get(layout.keys);
  if (hit) return hit;
  const det = detectHalves(layout.keys);
  const splitX = det ? det.splitX : layout.width / 2;
  const left: LayoutKey[] = [];
  const right: LayoutKey[] = [];
  for (const k of layout.keys) {
    const h: Hand = det ? det.hand.get(k)! : (k.finger?.hand ?? (keyCenter(k).x < splitX ? "L" : "R"));
    (h === "L" ? left : right).push(k);
  }
  const out: LayoutHalves = { split: !!det, splitX, left, right };
  halvesCache.set(layout.keys, out);
  return out;
}

/** True when the layout is a physically split board. */
export function isSplitLayout(layout: ParsedLayout): boolean {
  return layoutHalves(layout).split;
}

/** Which half of the board a key belongs to. */
export function keyHalf(layout: ParsedLayout, key: LayoutKey): Hand {
  const h = layoutHalves(layout);
  if (h.split) return keyCenter(key).x < h.splitX ? "L" : "R";
  return key.finger?.hand ?? (keyCenter(key).x < h.splitX ? "L" : "R");
}
