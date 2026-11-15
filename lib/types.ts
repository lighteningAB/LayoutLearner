// Shared contract types. Every feature area (layout parser, 2D keyboard, typing
// engine, lessons, stats, 3D hands) codes against these. Change with care.

export type Hand = "L" | "R";
export type Finger = "pinky" | "ring" | "middle" | "index" | "thumb";

export interface FingerId {
  hand: Hand;
  finger: Finger;
}

/** One physical key of a parsed layout. Units: 1u = one standard key width. */
export interface LayoutKey {
  /** Stable within a layout, e.g. "r2k5" (row index, key index within row). */
  id: string;
  row: number;
  /** Top-left corner in key units. x grows right, y grows down. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Raw KLE label, legends separated by "\n". */
  label: string;
  /** label split on "\n". For two-legend keys KLE order is [shifted, base]. */
  legends: string[];
  /** Character produced unshifted ("a", "1", ";", " "). "" for non-character keys. */
  base: string;
  /** Character produced with Shift ("A", "!", ":"). "" for non-character keys. */
  shifted: string;
  /** Shift, Ctrl, Alt, Win/Meta, Caps Lock, Fn, Menu. */
  isModifier: boolean;
  /** KeyboardEvent.code of this physical position on an ANSI board, when resolvable. */
  code?: string;
  /** Finger that should press this key under standard touch typing. */
  finger?: FingerId;
  /** True if this is the resting (home) key for its finger. */
  isHome?: boolean;
  /** KLE rotation (r, rx, ry): degrees clockwise about (cx, cy) in key units. */
  rotation?: { angle: number; cx: number; cy: number };
}

export interface ParsedLayout {
  name: string;
  keys: LayoutKey[];
  /** Bounding size in key units. */
  width: number;
  height: number;
}

/** Order used for finger colour tokens --finger-0 … --finger-9 (left pinky → right pinky). */
export const FINGER_ORDER: FingerId[] = [
  { hand: "L", finger: "pinky" },
  { hand: "L", finger: "ring" },
  { hand: "L", finger: "middle" },
  { hand: "L", finger: "index" },
  { hand: "L", finger: "thumb" },
  { hand: "R", finger: "thumb" },
  { hand: "R", finger: "index" },
  { hand: "R", finger: "middle" },
  { hand: "R", finger: "ring" },
  { hand: "R", finger: "pinky" },
];

export function fingerIndex(f: FingerId): number {
  return FINGER_ORDER.findIndex((o) => o.hand === f.hand && o.finger === f.finger);
}
