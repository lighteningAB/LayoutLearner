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
