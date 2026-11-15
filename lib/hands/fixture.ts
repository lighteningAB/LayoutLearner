// Hand-written ANSI 60% QWERTY fixture used by the hands dev harness (and as a
// fallback while the real layout parser is unavailable). Geometry, finger
// assignment and home keys follow standard touch typing.

import type { Finger, FingerId, Hand, LayoutKey, ParsedLayout } from "../types";

type Spec = [label: string, code: string, finger: string, w?: number];

const F = (s: string): FingerId => {
  const hand = s[0] as Hand;
  const finger = ({ p: "pinky", r: "ring", m: "middle", i: "index", t: "thumb" } as Record<string, Finger>)[s[1]];
  return { hand, finger };
};

const ROWS: Spec[][] = [
  [
    ["~\n`", "Backquote", "Lp"],
    ["!\n1", "Digit1", "Lp"],
    ["@\n2", "Digit2", "Lr"],
    ["#\n3", "Digit3", "Lm"],
    ["$\n4", "Digit4", "Li"],
    ["%\n5", "Digit5", "Li"],
    ["^\n6", "Digit6", "Ri"],
    ["&\n7", "Digit7", "Ri"],
    ["*\n8", "Digit8", "Rm"],
    ["(\n9", "Digit9", "Rr"],
    [")\n0", "Digit0", "Rp"],
    ["_\n-", "Minus", "Rp"],
    ["+\n=", "Equal", "Rp"],
    ["Backspace", "Backspace", "Rp", 2],
  ],
  [
    ["Tab", "Tab", "Lp", 1.5],
    ["Q", "KeyQ", "Lp"],
    ["W", "KeyW", "Lr"],
    ["E", "KeyE", "Lm"],
    ["R", "KeyR", "Li"],
    ["T", "KeyT", "Li"],
    ["Y", "KeyY", "Ri"],
    ["U", "KeyU", "Ri"],
    ["I", "KeyI", "Rm"],
    ["O", "KeyO", "Rr"],
    ["P", "KeyP", "Rp"],
    ["{\n[", "BracketLeft", "Rp"],
    ["}\n]", "BracketRight", "Rp"],
    ["|\n\\", "Backslash", "Rp", 1.5],
  ],
  [
    ["Caps Lock", "CapsLock", "Lp", 1.75],
    ["A", "KeyA", "Lp*"],
    ["S", "KeyS", "Lr*"],
    ["D", "KeyD", "Lm*"],
    ["F", "KeyF", "Li*"],
    ["G", "KeyG", "Li"],
    ["H", "KeyH", "Ri"],
    ["J", "KeyJ", "Ri*"],
    ["K", "KeyK", "Rm*"],
    ["L", "KeyL", "Rr*"],
    [":\n;", "Semicolon", "Rp*"],
    ['"\n\'', "Quote", "Rp"],
    ["Enter", "Enter", "Rp", 2.25],
  ],
  [
    ["Shift", "ShiftLeft", "Lp", 2.25],
    ["Z", "KeyZ", "Lp"],
    ["X", "KeyX", "Lr"],
    ["C", "KeyC", "Lm"],
    ["V", "KeyV", "Li"],
    ["B", "KeyB", "Li"],
    ["N", "KeyN", "Ri"],
    ["M", "KeyM", "Ri"],
    ["<\n,", "Comma", "Rm"],
    [">\n.", "Period", "Rr"],
    ["?\n/", "Slash", "Rp"],
    ["Shift", "ShiftRight", "Rp", 2.75],
  ],
  [
    ["Ctrl", "ControlLeft", "Lp", 1.25],
    ["Win", "MetaLeft", "Lp", 1.25],
    ["Alt", "AltLeft", "Lt", 1.25],
    ["", "Space", "Rt*", 6.25],
    ["Alt", "AltRight", "Rt", 1.25],
    ["Win", "MetaRight", "Rp", 1.25],
    ["Menu", "ContextMenu", "Rp", 1.25],
    ["Ctrl", "ControlRight", "Rp", 1.25],
  ],
];

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|CapsLock|ContextMenu)/;
const NON_CHAR = new Set(["Backspace", "Tab", "Enter"]);

function build(): ParsedLayout {
  const keys: LayoutKey[] = [];
  let width = 0;
  ROWS.forEach((row, r) => {
    let x = 0;
    row.forEach(([label, code, f, w = 1], k) => {
      const legends = label.split("\n");
      const isModifier = MODIFIER_CODES.test(code);
      let base = "";
      let shifted = "";
      if (code === "Space") {
        base = " ";
        shifted = " ";
      } else if (!isModifier && !NON_CHAR.has(code)) {
        if (legends.length === 2) {
          shifted = legends[0];
          base = legends[1];
        } else {
          shifted = legends[0];
          base = legends[0].toLowerCase();
        }
      }
      keys.push({
        id: `r${r}k${k}`,
        row: r,
        x,
        y: r,
        w,
        h: 1,
        label,
        legends,
        base,
        shifted,
        isModifier,
        code,
        finger: F(f),
        isHome: f.endsWith("*"),
      });
      x += w;
    });
    width = Math.max(width, x);
  });
  return { name: "QWERTY (ANSI 60%) fixture", keys, width, height: ROWS.length };
}

export const QWERTY_FIXTURE: ParsedLayout = build();

// ---- split, column-staggered board (3x6 + 3 rotated thumb keys per half) ----
// Dev-harness fixture for boards with two separated halves: no shared space
// bar, one resting thumb key per half, thumb clusters rotated.

const SPLIT_COLS = [0.375, 0.375, 0.125, 0, 0.125, 0.25]; // vertical stagger, outer pinky column -> inner index column
const SPLIT_GAP = 4; // key units between the halves
const SPLIT_LEFT: [string, string][][] = [
  [["Tab", "Tab"], ["Q", "KeyQ"], ["W", "KeyW"], ["E", "KeyE"], ["R", "KeyR"], ["T", "KeyT"]],
  [["Ctrl", "ControlLeft"], ["A", "KeyA"], ["S", "KeyS"], ["D", "KeyD"], ["F", "KeyF"], ["G", "KeyG"]],
  [["Shift", "ShiftLeft"], ["Z", "KeyZ"], ["X", "KeyX"], ["C", "KeyC"], ["V", "KeyV"], ["B", "KeyB"]],
];
const SPLIT_RIGHT: [string, string][][] = [
  [["Y", "KeyY"], ["U", "KeyU"], ["I", "KeyI"], ["O", "KeyO"], ["P", "KeyP"], ["Bksp", "Backspace"]],
  [["H", "KeyH"], ["J", "KeyJ"], ["K", "KeyK"], ["L", "KeyL"], [":\n;", "Semicolon"], ['"\n\'', "Quote"]],
  [["N", "KeyN"], ["M", "KeyM"], ["<\n,", "Comma"], [">\n.", "Period"], ["?\n/", "Slash"], ["Shift", "ShiftRight"]],
];
const SPLIT_FINGERS: Finger[] = ["pinky", "pinky", "ring", "middle", "index", "index"];
// thumb keys, outer -> inner: [label, code, dx from the half's inner edge, y, clockwise angle on the left half]
const SPLIT_THUMBS: [string, string, string, number, number, number][] = [
  ["Alt", "AltLeft", "MetaRight", -2.6, 3.35, 0],
  ["", "Space", "Enter", -1.55, 3.45, 15],
  ["Fn", "Fn", "AltRight", -0.5, 3.8, 30],
];

function buildSplit(): ParsedLayout {
  const keys: LayoutKey[] = [];
  const half = SPLIT_COLS.length;
  const width = half * 2 + SPLIT_GAP;
  const push = (id: string, row: number, x: number, y: number, label: string, code: string, finger: FingerId, isHome: boolean, angle = 0) => {
    const legends = label.split("\n");
    const isModifier = MODIFIER_CODES.test(code) || code === "Fn";
    let base = "";
    let shifted = "";
    if (code === "Space") base = shifted = " ";
    else if (!isModifier && !NON_CHAR.has(code)) {
      shifted = legends[0];
      base = legends.length === 2 ? legends[1] : legends[0].toLowerCase();
    }
    keys.push({
      id,
      row,
      x,
      y,
      w: 1,
      h: 1,
      label: label || (code === "Enter" ? "Enter" : ""),
      legends,
      base,
      shifted,
      isModifier,
      code,
      finger,
      isHome,
      rotation: angle ? { angle, cx: x + 0.5, cy: y + 0.5 } : undefined,
    });
  };
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < half; c++) {
      const [ll, lc] = SPLIT_LEFT[r][c];
      push(`l${r}k${c}`, r, c, r + SPLIT_COLS[c], ll, lc, { hand: "L", finger: SPLIT_FINGERS[c] }, r === 1 && c >= 1 && c <= 4);
      const [rl, rc] = SPLIT_RIGHT[r][c];
      const m = half - 1 - c; // mirrored column
      push(`r${r}k${c}`, r, half + SPLIT_GAP + c, r + SPLIT_COLS[m], rl, rc, { hand: "R", finger: SPLIT_FINGERS[m] }, r === 1 && m >= 1 && m <= 4);
    }
  }
  SPLIT_THUMBS.forEach(([label, lcode, rcode, dx, y, angle], i) => {
    push(`lt${i}`, 3, half + dx, y, label, lcode, { hand: "L", finger: "thumb" }, i === 1, angle);
    push(`rt${i}`, 3, half + SPLIT_GAP - dx - 1, y, rcode === "Enter" ? "Enter" : label, rcode, { hand: "R", finger: "thumb" }, i === 1, -angle);
  });
  return { name: "Split columnar fixture", keys, width, height: 4.8 };
}

export const SPLIT_FIXTURE: ParsedLayout = buildSplit();
