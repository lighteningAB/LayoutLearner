// Hand-made ANSI ParsedLayout fixtures for the dev harness and for checking the curriculum
// without depending on the real parser in lib/layout. Not meant for production pages.
import type { Finger, FingerId, LayoutKey, ParsedLayout } from "@/lib/types";

/** [base, shifted] pairs per row: number row, top, home, bottom. */
type RowSpec = [string, string][];

const pairs = (base: string, shifted: string): RowSpec => base.split("").map((b, i) => [b, shifted[i]] as [string, string]);

// Standard touch-typing finger per column of the 10 main columns, plus the right-pinky overflow.
const COLUMN_FINGERS: FingerId[] = [
  { hand: "L", finger: "pinky" },
  { hand: "L", finger: "ring" },
  { hand: "L", finger: "middle" },
  { hand: "L", finger: "index" },
  { hand: "L", finger: "index" },
  { hand: "R", finger: "index" },
  { hand: "R", finger: "index" },
  { hand: "R", finger: "middle" },
  { hand: "R", finger: "ring" },
  { hand: "R", finger: "pinky" },
];
const HOME_COLUMNS = new Set([0, 1, 2, 3, 6, 7, 8, 9]);

function fingerForColumn(col: number): FingerId {
  return COLUMN_FINGERS[Math.min(col, COLUMN_FINGERS.length - 1)];
}

/**
 * Build an ANSI-staggered layout. `number` row starts at the backtick key (so its column 0 is
 * left of "1"); the three letter rows start right after Tab / Caps / Shift.
 */
export function makeAnsiLayout(name: string, rows: { number: RowSpec; top: RowSpec; home: RowSpec; bottom: RowSpec }): ParsedLayout {
  const keys: LayoutKey[] = [];
  const push = (row: number, x: number, w: number, label: string, base: string, shifted: string, extra: Partial<LayoutKey> = {}) => {
    const k: LayoutKey = {
      id: `r${row}k${keys.filter((q) => q.row === row).length}`,
      row,
      x,
      y: row,
      w,
      h: 1,
      label,
      legends: label.split("\n"),
      base,
      shifted,
      isModifier: false,
      ...extra,
    };
    keys.push(k);
  };
  const mod = (row: number, x: number, w: number, label: string, finger: Finger, hand: "L" | "R") =>
    push(row, x, w, label, "", "", { isModifier: /shift|ctrl|alt|caps|win/i.test(label), finger: { hand, finger } });
  const charKey = (row: number, x: number, [base, shifted]: [string, string], finger: FingerId, isHome = false) =>
    push(row, x, 1, base === shifted.toLowerCase() && base !== shifted ? shifted : `${shifted}\n${base}`, base, shifted, { finger, isHome });

  // Row 0: ` 1 … = Backspace. Digit n sits one column right of the letter column it belongs to.
  rows.number.forEach((p, i) => charKey(0, i, p, fingerForColumn(Math.max(0, i - 1))));
  mod(0, rows.number.length, 2, "Backspace", "pinky", "R");
  // Row 1: Tab + top row (+ brackets, backslash)
  mod(1, 0, 1.5, "Tab", "pinky", "L");
  rows.top.forEach((p, i) => charKey(1, 1.5 + i, p, fingerForColumn(i)));
  // Row 2: Caps + home row + Enter
  mod(2, 0, 1.75, "Caps Lock", "pinky", "L");
  rows.home.forEach((p, i) => charKey(2, 1.75 + i, p, fingerForColumn(i), HOME_COLUMNS.has(i)));
  mod(2, 1.75 + rows.home.length, 2.25, "Enter", "pinky", "R");
  // Row 3: Shift + bottom row + Shift
  mod(3, 0, 2.25, "Shift", "pinky", "L");
  rows.bottom.forEach((p, i) => charKey(3, 2.25 + i, p, fingerForColumn(i)));
  mod(3, 2.25 + rows.bottom.length, 2.75, "Shift", "pinky", "R");
  // Row 4: space
  push(4, 4, 6.25, "", " ", " ", { finger: { hand: "R", finger: "thumb" }, isHome: true });

  return { name, keys, width: 15, height: 5 };
}

const NUMBER_ROW = pairs("`1234567890-=", "~!@#$%^&*()_+");

export const DEV_QWERTY: ParsedLayout = makeAnsiLayout("QWERTY (dev fixture)", {
  number: NUMBER_ROW,
  top: pairs("qwertyuiop[]\\", "QWERTYUIOP{}|"),
  home: pairs("asdfghjkl;'", 'ASDFGHJKL:"'),
  bottom: pairs("zxcvbnm,./", "ZXCVBNM<>?"),
});

export const DEV_DVORAK: ParsedLayout = makeAnsiLayout("Dvorak (dev fixture)", {
  number: pairs("`1234567890[]", "~!@#$%^&*(){}"),
  top: pairs("',.pyfgcrl/=\\", '"<>PYFGCRL?+|'),
  home: pairs("aoeuidhtns-", "AOEUIDHTNS_"),
  bottom: pairs(";qjkxbmwvz", ":QJKXBMWVZ"),
});

export const DEV_COLEMAK: ParsedLayout = makeAnsiLayout("Colemak (dev fixture)", {
  number: NUMBER_ROW,
  top: pairs("qwfpgjluy;[]\\", "QWFPGJLUY:{}|"),
  home: pairs("arstdhneio'", 'ARSTDHNEIO"'),
  bottom: pairs("zxcvbkm,./", "ZXCVBKM<>?"),
});

export const DEV_LAYOUTS: Record<string, ParsedLayout> = {
  qwerty: DEV_QWERTY,
  dvorak: DEV_DVORAK,
  colemak: DEV_COLEMAK,
};
