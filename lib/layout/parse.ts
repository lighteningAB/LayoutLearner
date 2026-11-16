// KLE (keyboard-layout-editor.com) raw-data parser → ParsedLayout.
// Parsing is done with JSON5 (never eval). Geometry follows KLE semantics; on top of
// that every key gets a character pair, a KeyboardEvent.code, a finger and a home flag.
import JSON5 from "json5";
import type { FingerId, LayoutKey, ParsedLayout } from "../types";
import { analyseSplit, type SplitAnalysis } from "./split";
import { MAX_CUSTOM_KEYS, MAX_LABEL_CHARS, MAX_SOURCE_BYTES, stripTagsLinear, trimTrailingSeparators } from "./scan";

export class LayoutParseError extends Error {
  /** 1-based line / column in the source, when the failure is a syntax error. */
  line?: number;
  column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = "LayoutParseError";
    this.line = line;
    this.column = column;
    Object.setPrototypeOf(this, LayoutParseError.prototype);
  }
}

const MAX_KEYS = MAX_CUSTOM_KEYS;

// ---------------------------------------------------------------------------
// Named (non-character) keys
// ---------------------------------------------------------------------------

type Side = "L" | "R" | undefined;
interface Named {
  /** Exact code, or a base that needs a Left/Right suffix when `sided`. */
  code?: string;
  sided?: boolean;
  modifier?: boolean;
  side?: Side;
}

const NAMED: Record<string, Named> = {
  esc: { code: "Escape" },
  escape: { code: "Escape" },
  tab: { code: "Tab" },
  "⇥": { code: "Tab" },
  capslock: { code: "CapsLock", modifier: true },
  caps: { code: "CapsLock", modifier: true },
  "⇪": { code: "CapsLock", modifier: true },
  enter: { code: "Enter" },
  return: { code: "Enter" },
  "⏎": { code: "Enter" },
  "↵": { code: "Enter" },
  backspace: { code: "Backspace" },
  bksp: { code: "Backspace" },
  back: { code: "Backspace" },
  bs: { code: "Backspace" },
  "⌫": { code: "Backspace" },
  shift: { code: "Shift", sided: true, modifier: true },
  "⇧": { code: "Shift", sided: true, modifier: true },
  ctrl: { code: "Control", sided: true, modifier: true },
  control: { code: "Control", sided: true, modifier: true },
  "⌃": { code: "Control", sided: true, modifier: true },
  alt: { code: "Alt", sided: true, modifier: true },
  option: { code: "Alt", sided: true, modifier: true },
  opt: { code: "Alt", sided: true, modifier: true },
  "⌥": { code: "Alt", sided: true, modifier: true },
  altgr: { code: "Alt", sided: true, modifier: true, side: "R" },
  win: { code: "Meta", sided: true, modifier: true },
  meta: { code: "Meta", sided: true, modifier: true },
  cmd: { code: "Meta", sided: true, modifier: true },
  command: { code: "Meta", sided: true, modifier: true },
  super: { code: "Meta", sided: true, modifier: true },
  os: { code: "Meta", sided: true, modifier: true },
  gui: { code: "Meta", sided: true, modifier: true },
  "⌘": { code: "Meta", sided: true, modifier: true },
  menu: { code: "ContextMenu", modifier: true },
  app: { code: "ContextMenu", modifier: true },
  fn: { modifier: true },
  lower: { modifier: true },
  raise: { modifier: true },
  hyper: { modifier: true },
  prtsc: { code: "PrintScreen" },
  prtscn: { code: "PrintScreen" },
  printscreen: { code: "PrintScreen" },
  scrolllock: { code: "ScrollLock" },
  scrlk: { code: "ScrollLock" },
  pause: { code: "Pause" },
  pausebreak: { code: "Pause" },
  insert: { code: "Insert" },
  ins: { code: "Insert" },
  home: { code: "Home" },
  pgup: { code: "PageUp" },
  pageup: { code: "PageUp" },
  delete: { code: "Delete" },
  del: { code: "Delete" },
  end: { code: "End" },
  pgdn: { code: "PageDown" },
  pagedown: { code: "PageDown" },
  "↑": { code: "ArrowUp" },
  up: { code: "ArrowUp" },
  "↓": { code: "ArrowDown" },
  down: { code: "ArrowDown" },
  "←": { code: "ArrowLeft" },
  left: { code: "ArrowLeft" },
  "→": { code: "ArrowRight" },
  right: { code: "ArrowRight" },
  numlock: { code: "NumLock" },
  space: { code: "Space" },
  spc: { code: "Space" },
  spacebar: { code: "Space" },
  "␣": { code: "Space" },
};

const stripTags = stripTagsLinear;

/** Non-empty, tag-stripped legends of a KLE label, in KLE order. */
export function displayLegends(label: string): string[] {
  return label
    .split("\n")
    .map(stripTags)
    .filter((s) => s.length > 0);
}

function lookupNamed(label: string): Named | undefined {
  const norm = displayLegends(label).join("").toLowerCase().replace(/[\s._-]/g, "");
  if (!norm) return undefined;
  const direct = NAMED[norm];
  if (direct) return direct;
  if (/^f([1-9]|1\d|2[0-4])$/.test(norm)) return { code: "F" + norm.slice(1) };
  // "LShift", "R Ctrl", "Left Alt" …
  const m = /^(l|r|left|right)(.+)$/.exec(norm);
  if (m && NAMED[m[2]]?.sided) return { ...NAMED[m[2]], side: m[1][0] === "l" ? "L" : "R" };
  return undefined;
}

/**
 * What a non-character key does in the typing test, judged from its label
 * (so a layout that relabels Caps Lock as "Backspace" behaves that way under emulation).
 */
export function keyAction(key: LayoutKey): "backspace" | "enter" | "tab" | "escape" | undefined {
  if (key.base) return undefined;
  switch (lookupNamed(key.label)?.code) {
    case "Backspace":
      return "backspace";
    case "Enter":
      return "enter";
    case "Tab":
      return "tab";
    case "Escape":
      return "escape";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const isChar = (s: string) => {
  const cps = Array.from(s);
  return cps.length === 1 && (/^[\x21-\x7e]$/.test(s) || /^\p{L}$/u.test(s));
};

function charsFor(label: string, w: number): { base: string; shifted: string } {
  const legends = displayLegends(label);
  const named = lookupNamed(label);
  if (named?.code === "Space") return { base: " ", shifted: " " };
  if (legends.length === 0) return w >= 1.75 ? { base: " ", shifted: " " } : { base: "", shifted: "" };
  if (named) return { base: "", shifted: "" };
  if (legends.length === 1) {
    const l = legends[0];
    if (!isChar(l)) return { base: "", shifted: "" };
    const lower = l.toLowerCase();
    const upper = l.toUpperCase();
    if (lower !== upper && lower.length === 1 && upper.length === 1) return { base: lower, shifted: upper };
    return { base: l, shifted: "" };
  }
  if (isChar(legends[0]) && isChar(legends[1])) return { shifted: legends[0], base: legends[1] };
  return { base: "", shifted: "" };
}

// ---------------------------------------------------------------------------
// ANSI reference geometry (relative to the top-left of the number row)
// ---------------------------------------------------------------------------

const ANSI_REF = new Map<string, string>();
const refKey = (dx: number, dy: number) => `${Math.round(dx * 4)},${Math.round(dy * 4)}`;
function addRef(dy: number, x: number, codes: string[], step = 1) {
  codes.forEach((c, i) => ANSI_REF.set(refKey(x + i * step, dy), c));
}
const K = (s: string) => s.split("").map((c) => "Key" + c);
const D = (s: string) => s.split("").map((c) => "Digit" + c);
addRef(0, 0, ["Backquote", ...D("1234567890"), "Minus", "Equal", "Backspace"]);
addRef(1, 0, ["Tab"]);
addRef(1, 1.5, [...K("QWERTYUIOP"), "BracketLeft", "BracketRight", "Backslash"]);
addRef(2, 0, ["CapsLock"]);
addRef(2, 1.75, [...K("ASDFGHJKL"), "Semicolon", "Quote", "Enter"]);
addRef(3, 0, ["ShiftLeft"]);
addRef(3, 1.25, ["IntlBackslash"]); // ISO extra key
addRef(3, 2.25, [...K("ZXCVBNM"), "Comma", "Period", "Slash", "ShiftRight"]);
addRef(0, 15.25, ["Insert", "Home", "PageUp"]);
addRef(1, 15.25, ["Delete", "End", "PageDown"]);
addRef(3, 16.25, ["ArrowUp"]);
addRef(4, 15.25, ["ArrowLeft", "ArrowDown", "ArrowRight"]);
addRef(0, 18.5, ["NumLock", "NumpadDivide", "NumpadMultiply", "NumpadSubtract"]);
addRef(1, 18.5, ["Numpad7", "Numpad8", "Numpad9", "NumpadAdd"]);
addRef(2, 18.5, ["Numpad4", "Numpad5", "Numpad6"]);
addRef(3, 18.5, ["Numpad1", "Numpad2", "Numpad3", "NumpadEnter"]);
addRef(4, 18.5, ["Numpad0"]);
addRef(4, 20.5, ["NumpadDecimal"]);

// Code sequences used for best-effort column matching on ortholinear / split boards.
const SEQ_NUM_FULL = ["Backquote", ...D("1234567890"), "Minus", "Equal"];
const SEQ_NUM = [...D("1234567890"), "Minus", "Equal"];
const SEQ_TOP = [...K("QWERTYUIOP"), "BracketLeft", "BracketRight", "Backslash"];
const SEQ_HOME = [...K("ASDFGHJKL"), "Semicolon", "Quote"];
const SEQ_BOTTOM = [...K("ZXCVBNM"), "Comma", "Period", "Slash"];

// ---------------------------------------------------------------------------
// Fingers
// ---------------------------------------------------------------------------

const FINGER_BY_CODE: Record<string, FingerId> = {};
function fingers(hand: "L" | "R", finger: FingerId["finger"], codes: string) {
  for (const c of codes.split(" ")) FINGER_BY_CODE[c] = { hand, finger };
}
fingers("L", "pinky", "Backquote Digit1 Tab KeyQ CapsLock KeyA ShiftLeft IntlBackslash KeyZ ControlLeft MetaLeft");
fingers("L", "ring", "Digit2 KeyW KeyS KeyX");
fingers("L", "middle", "Digit3 KeyE KeyD KeyC");
fingers("L", "index", "Digit4 Digit5 KeyR KeyT KeyF KeyG KeyV KeyB");
fingers("L", "thumb", "AltLeft");
fingers("R", "thumb", "Space AltRight");
fingers("R", "index", "Digit6 Digit7 KeyY KeyU KeyH KeyJ KeyN KeyM Numpad7 Numpad4 Numpad1");
fingers("R", "middle", "Digit8 KeyI KeyK Comma NumpadDivide Numpad8 Numpad5 Numpad2");
fingers("R", "ring", "Digit9 KeyO KeyL Period NumpadMultiply Numpad9 Numpad6 Numpad3 NumpadDecimal");
fingers(
  "R",
  "pinky",
  "Digit0 Minus Equal Backspace KeyP BracketLeft BracketRight Backslash Semicolon Quote Enter Slash ShiftRight " +
    "ControlRight MetaRight ContextMenu NumpadSubtract NumpadAdd NumpadEnter",
);
FINGER_BY_CODE.Numpad0 = { hand: "R", finger: "thumb" };

const HOME_CODES = new Set(["KeyA", "KeyS", "KeyD", "KeyF", "KeyJ", "KeyK", "KeyL", "Semicolon", "Space"]);

// ---------------------------------------------------------------------------
// Source → rows
// ---------------------------------------------------------------------------

type Row = unknown[];

function syntaxError(e: unknown, lineOffset = 0): LayoutParseError {
  const err = e as { message?: string; lineNumber?: number; columnNumber?: number };
  const line = typeof err.lineNumber === "number" ? err.lineNumber + lineOffset : undefined;
  const column = err.columnNumber;
  const raw = String(err.message ?? e).replace(/^JSON5: /, "");
  const where = line != null ? ` (line ${line}, column ${column})` : "";
  return new LayoutParseError(`Layout syntax error${where}: ${raw.replace(/ at \d+:\d+$/, "")}`, line, column);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function readRows(source: string): { rows: Row[]; meta?: Record<string, unknown> } {
  const text = trimTrailingSeparators((source ?? "").trim());
  if (!text) throw new LayoutParseError("Layout is empty. Paste the raw data from keyboard-layout-editor.com.");

  let data: unknown;
  let firstError: unknown;
  try {
    data = JSON5.parse(text);
  } catch (e) {
    firstError = e;
  }
  if (firstError !== undefined) {
    // Raw data without the outer brackets: `["Esc","Q"],["Tab","A"]`
    try {
      data = JSON5.parse("[" + text + "]");
    } catch (e2) {
      // Report whichever attempt got further into the text.
      const a = firstError as { lineNumber?: number; columnNumber?: number };
      const b = e2 as { lineNumber?: number; columnNumber?: number };
      const further =
        (b.lineNumber ?? 0) > (a.lineNumber ?? 0) ||
        ((b.lineNumber ?? 0) === (a.lineNumber ?? 0) && (b.columnNumber ?? 0) - (b.lineNumber === 1 ? 1 : 0) > (a.columnNumber ?? 0));
      if (further) {
        const err = syntaxError(e2);
        if (err.line === 1 && err.column != null) {
          err.column -= 1;
          err.message = err.message.replace(/column \d+/, `column ${err.column}`);
        }
        throw err;
      }
      throw syntaxError(firstError);
    }
  }

  if (isPlainObject(data)) throw new LayoutParseError("Layout must be a list of rows, e.g. [\"Q\",\"W\"],[\"A\",\"S\"].");
  if (!Array.isArray(data)) throw new LayoutParseError("Layout must be a list of rows of key labels.");

  let items: unknown[] = data;
  // A single bare row (`["Q","W","E"]`) parses as an array of strings/objects.
  const looksLikeSingleRow = items.length > 0 && items.some((i) => typeof i === "string") && !items.some(Array.isArray);
  if (looksLikeSingleRow) items = [items];

  let meta: Record<string, unknown> | undefined;
  const rows: Row[] = [];
  items.forEach((item, i) => {
    if (Array.isArray(item)) rows.push(item);
    else if (isPlainObject(item) && rows.length === 0 && !meta) meta = item;
    else
      throw new LayoutParseError(
        `Item ${i + 1} of the layout is ${describe(item)}; expected a row like ["Q","W","E"].`,
      );
  });
  return { rows, meta };
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "string") return `the text "${v.length > 20 ? v.slice(0, 20) + "…" : v}"`;
  if (typeof v === "object") return "an object";
  return `the ${typeof v} ${String(v)}`;
}

function num(props: Record<string, unknown>, name: string, row: number): number | undefined {
  const v = props[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new LayoutParseError(`Row ${row + 1}: property "${name}" must be a number, got ${describe(v)}.`);
  return v;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function parseLayout(source: string, name?: string): ParsedLayout {
  // Bytes are at least UTF-16 length, so this cheap test rejects oversize input
  // before any encoding work; the exact byte check follows for multibyte text.
  if (
    (source ?? "").length > MAX_SOURCE_BYTES ||
    (typeof TextEncoder !== "undefined" && new TextEncoder().encode(source ?? "").length > MAX_SOURCE_BYTES)
  ) {
    throw new LayoutParseError(`Layout is larger than ${MAX_SOURCE_BYTES / 1000} KB.`);
  }
  const { rows, meta } = readRows(source);

  const keys: LayoutKey[] = [];
  let x = 0;
  let y = 0;
  let w = 1;
  let h = 1;
  let angle = 0;
  let rx = 0;
  let ry = 0;

  rows.forEach((row, r) => {
    let k = 0;
    for (const rawItem of row) {
      const item = typeof rawItem === "string" && rawItem.length > MAX_LABEL_CHARS ? rawItem.slice(0, MAX_LABEL_CHARS) : rawItem;
      if (typeof item === "string") {
        if (keys.length >= MAX_KEYS) throw new LayoutParseError(`Layout has more than ${MAX_KEYS} keys.`);
        const chars = charsFor(item, w);
        const key: LayoutKey = {
          id: `r${r}k${k}`,
          row: r,
          x: round(x),
          y: round(y),
          w,
          h,
          label: item,
          legends: item.split("\n"),
          base: chars.base,
          shifted: chars.shifted,
          isModifier: !!lookupNamed(item)?.modifier,
        };
        if (angle !== 0) key.rotation = { angle, cx: rx, cy: ry };
        keys.push(key);
        k++;
        x += w;
        w = 1;
        h = 1;
      } else if (isPlainObject(item)) {
        const pr = num(item, "r", r);
        const prx = num(item, "rx", r);
        const pry = num(item, "ry", r);
        if (pr !== undefined) angle = pr;
        if (prx !== undefined) {
          rx = prx;
          x = rx;
          y = ry;
        }
        if (pry !== undefined) {
          ry = pry;
          x = rx;
          y = ry;
        }
        y += num(item, "y", r) ?? 0;
        x += num(item, "x", r) ?? 0;
        const pw = num(item, "w", r);
        const ph = num(item, "h", r);
        if (pw !== undefined) {
          if (pw <= 0 || pw > 30) throw new LayoutParseError(`Row ${r + 1}: key width w:${pw} is out of range.`);
          w = pw;
        }
        if (ph !== undefined) {
          if (ph <= 0 || ph > 30) throw new LayoutParseError(`Row ${r + 1}: key height h:${ph} is out of range.`);
          h = ph;
        }
      } else {
        throw new LayoutParseError(
          `Row ${r + 1}: found ${describe(item)}; a row may only contain "labels" and {property: value} objects.`,
        );
      }
    }
    y += 1;
    x = rx;
  });

  if (keys.length === 0) throw new LayoutParseError("Layout contains no keys.");

  // Split / ergonomic boards get codes, fingers, home keys and logical rows from their
  // column structure; everything else goes through the ANSI / ortholinear heuristics.
  const split = findAnsiOrigin(keys) ? null : analyseSplit(keys);
  assignCodes(keys, split);
  if (split) applySplit(keys, split);
  else assignFingers(keys);
  const size = normalise(keys);

  const metaName = meta && typeof meta.name === "string" ? meta.name : undefined;
  return { name: name ?? metaName ?? "Custom layout", keys, width: size.width, height: size.height };
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

interface AnsiOrigin {
  x0: number;
  y0: number;
}

/** Finds a row-staggered ANSI/ISO alpha block: rows starting with 1.5u, 1.75u and 2.25u/1.25u keys. */
function findAnsiOrigin(keys: LayoutKey[]): AnsiOrigin | undefined {
  const firstByY = new Map<number, LayoutKey>();
  for (const k of keys) {
    if (k.rotation) continue;
    const cur = firstByY.get(k.y);
    if (!cur || k.x < cur.x) firstByY.set(k.y, k);
  }
  for (const [y, tab] of firstByY) {
    if (tab.w !== 1.5) continue;
    const caps = firstByY.get(round(y + 1));
    const shift = firstByY.get(round(y + 2));
    if (!caps || !shift) continue;
    if (caps.w !== 1.75 || (shift.w !== 2.25 && shift.w !== 1.25)) continue;
    if (caps.x !== tab.x || shift.x !== tab.x) continue;
    return { x0: tab.x, y0: y - 1 };
  }
  return undefined;
}

function assignCodes(keys: LayoutKey[], split: SplitAnalysis | null = null) {
  const used = new Set<string>();
  const give = (k: LayoutKey, code: string | undefined) => {
    if (!code || k.code || used.has(code)) return false;
    k.code = code;
    used.add(code);
    return true;
  };

  const ansi = findAnsiOrigin(keys);
  let centre: number;

  if (ansi) {
    centre = ansi.x0 + 7.5;
    for (const k of keys) {
      if (k.rotation) continue;
      give(k, ANSI_REF.get(refKey(k.x - ansi.x0, k.y - ansi.y0)));
    }
    // Numpad keys: with Num Lock on, the first legend is the character.
    for (const k of keys) {
      if (!k.code?.startsWith("Numpad")) continue;
      const first = displayLegends(k.label)[0] ?? "";
      const isNumChar = Array.from(first).length === 1 && /^[\x21-\x7e]$/.test(first);
      k.base = k.code === "NumpadEnter" || !isNumChar ? "" : first;
      k.shifted = "";
    }
  } else if (split) {
    centre = split.splitX;
    assignCodesBySplit(keys, split, give);
  } else {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const k of keys) {
      minX = Math.min(minX, k.x);
      maxX = Math.max(maxX, k.x + k.w);
    }
    centre = (minX + maxX) / 2;
    assignCodesByColumn(keys, give);
  }

  // Space bars.
  const spaces = keys.filter((k) => k.base === " ");
  spaces.forEach((k, i) => {
    if (i === 0) give(k, "Space");
  });

  // Everything else that has a recognisable name.
  for (const k of keys) {
    if (k.code || k.base) continue;
    const named = lookupNamed(k.label);
    if (!named?.code) continue;
    if (!named.sided) {
      give(k, named.code);
      continue;
    }
    const side: Side = named.side ?? split?.info.get(k)?.hand ?? (k.x + k.w / 2 < centre ? "L" : "R");
    const first = named.code + (side === "L" ? "Left" : "Right");
    const second = named.code + (side === "L" ? "Right" : "Left");
    if (!give(k, first) && !named.side) give(k, second);
  }
}

/** Ortholinear / split boards: match each row's run of character keys to the QWERTY columns. */
function assignCodesByColumn(keys: LayoutKey[], give: (k: LayoutKey, code: string | undefined) => boolean) {
  const byRow = new Map<number, LayoutKey[]>();
  for (const k of keys) {
    if (!byRow.has(k.row)) byRow.set(k.row, []);
    byRow.get(k.row)!.push(k);
  }
  const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, ks]) => ks.slice().sort((a, b) => a.x - b.x));
  const chars = (ks: LayoutKey[]) => ks.filter((k) => k.base !== "" && k.base !== " ");
  const letters = (ks: LayoutKey[]) => ks.filter((k) => /^\p{L}$/u.test(k.base)).length;
  const digits = (ks: LayoutKey[]) => ks.filter((k) => /^\d$/.test(k.base)).length;

  const alphaIdx = rows.map((ks, i) => (letters(ks) >= 5 ? i : -1)).filter((i) => i >= 0).slice(0, 3);
  if (alphaIdx.length === 0) return;
  const seqs = alphaIdx.length === 3 ? [SEQ_TOP, SEQ_HOME, SEQ_BOTTOM] : alphaIdx.length === 2 ? [SEQ_TOP, SEQ_HOME] : [SEQ_HOME];
  alphaIdx.forEach((ri, i) => chars(rows[ri]).forEach((k, c) => give(k, seqs[i][c])));

  const numIdx = rows.findIndex((ks, i) => i < alphaIdx[0] && digits(ks) >= 8);
  if (numIdx >= 0) {
    const run = chars(rows[numIdx]);
    const seq = /^\d$/.test(run[0].base) ? SEQ_NUM : SEQ_NUM_FULL;
    run.forEach((k, c) => give(k, seq[c]));
  }
}

// Physical QWERTY positions of a split board's finger columns, counted from the centre gap
// outwards (column 0 = inner index column), per row relative to the home row.
const SPLIT_CODES: Record<"L" | "R", Record<number, string[]>> = {
  L: {
    [-2]: [...D("54321"), "Backquote"],
    [-1]: K("TREWQ"),
    0: K("GFDSA"),
    1: K("BVCXZ"),
  },
  R: {
    [-2]: [...D("67890"), "Minus", "Equal"],
    [-1]: [...K("YUIOP"), "BracketLeft", "BracketRight", "Backslash"],
    0: [...K("HJKL"), "Semicolon", "Quote"],
    1: [...K("NM"), "Comma", "Period", "Slash"],
  },
};

/** ANSI code of the key that types each unshifted character on QWERTY. */
const QWERTY_CODE_BY_CHAR = new Map<string, string>();
[SEQ_NUM_FULL, SEQ_TOP, SEQ_HOME, SEQ_BOTTOM].forEach((seq, i) => {
  const chars = ["`1234567890-=", "qwertyuiop[]\\", "asdfghjkl;'", "zxcvbnm,./"][i];
  seq.forEach((code, c) => QWERTY_CODE_BY_CHAR.set(chars[c], code));
});

/**
 * Split boards: a character key in a letter column takes the QWERTY position of its
 * half + column + row; character keys elsewhere (outer columns, thumb cluster, extra keys)
 * take the position that types the same character on QWERTY when it is still free.
 */
function assignCodesBySplit(keys: LayoutKey[], split: SplitAnalysis, give: (k: LayoutKey, code: string | undefined) => boolean) {
  const isChar = (k: LayoutKey) => k.base !== "" && k.base !== " ";
  const positional = (minCol: number, maxCol: number) => {
    for (const k of keys) {
      const i = split.info.get(k);
      if (k.code || !i || !isChar(k) || i.col === undefined || i.rel === undefined) continue;
      if (i.col >= minCol && i.col <= maxCol) give(k, SPLIT_CODES[i.hand][i.rel]?.[i.col]);
    }
  };
  // The five letter columns of each half are purely positional…
  positional(0, 4);
  // …keys around them prefer the position their character has on QWERTY (so "'" is Quote
  // wherever it sits), then fall back to the position of their outer column.
  for (const k of keys) {
    if (!k.code && isChar(k)) give(k, QWERTY_CODE_BY_CHAR.get(k.base));
  }
  positional(5, Infinity);
}

// ---------------------------------------------------------------------------
// Fingers / home keys
// ---------------------------------------------------------------------------

/** Split boards: finger, home flag and logical row straight from the column analysis. */
function applySplit(keys: LayoutKey[], split: SplitAnalysis) {
  for (const k of keys) {
    const i = split.info.get(k);
    if (!i) continue;
    k.finger = { hand: i.hand, finger: i.finger };
    if (i.isHome) k.isHome = true;
    // KLE row order is arbitrary on columnar boards (rows are often written column by column),
    // so `row` becomes the logical row: 0 = top of the main block, thumb cluster last.
    k.row = i.row;
  }
}

function assignFingers(keys: LayoutKey[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const k of keys) {
    minX = Math.min(minX, k.x);
    maxX = Math.max(maxX, k.x + k.w);
  }
  const ansi = findAnsiOrigin(keys);
  const centre = ansi ? ansi.x0 + 7.5 : (minX + maxX) / 2;

  for (const k of keys) {
    if (k.code && FINGER_BY_CODE[k.code]) k.finger = { ...FINGER_BY_CODE[k.code] };
  }

  // Space bars: thumbs. A single bar is conventionally the right thumb; split bars go by side.
  const spaces = keys.filter((k) => k.base === " ");
  for (const k of spaces) {
    const mid = k.x + k.w / 2;
    const hand = spaces.length > 1 && mid < centre - 0.01 ? "L" : "R";
    k.finger = { hand, finger: "thumb" };
    k.isHome = true;
  }

  for (const k of keys) {
    if (k.code && HOME_CODES.has(k.code)) k.isHome = true;
  }

  // Best effort for the rest of the main block: inherit from the nearest home-row column.
  const homeRow = keys.filter(
    (k) => k.finger && k.finger.finger !== "thumb" && k.code && !k.code.startsWith("Numpad") && sameRowAsHome(k, keys),
  );
  if (homeRow.length === 0) return;
  // On ANSI boards only the 15u main block is covered (not the nav cluster / numpad).
  const lo = ansi ? ansi.x0 : -Infinity;
  const hi = ansi ? ansi.x0 + 15 : Infinity;
  for (const k of keys) {
    if (k.finger || k.rotation) continue;
    const mid = k.x + k.w / 2;
    if (mid < lo || mid > hi) continue;
    let best: LayoutKey | undefined;
    let bestD = Infinity;
    for (const hk of homeRow) {
      const d = Math.abs(hk.x + hk.w / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = hk;
      }
    }
    if (best?.finger) k.finger = { ...best.finger };
  }
}

function sameRowAsHome(k: LayoutKey, keys: LayoutKey[]): boolean {
  const anchor = keys.find((o) => o.code === "KeyF") ?? keys.find((o) => o.code === "KeyJ") ?? keys.find((o) => o.code === "KeyA");
  return !!anchor && !k.rotation && Math.abs(anchor.y - k.y) < 0.4;
}

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

function corners(k: LayoutKey): [number, number][] {
  const pts: [number, number][] = [
    [k.x, k.y],
    [k.x + k.w, k.y],
    [k.x, k.y + k.h],
    [k.x + k.w, k.y + k.h],
  ];
  if (!k.rotation) return pts;
  const a = (k.rotation.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const { cx, cy } = k.rotation;
  return pts.map(([px, py]) => [cx + (px - cx) * cos - (py - cy) * sin, cy + (px - cx) * sin + (py - cy) * cos]);
}

/** Shifts keys so the bounding box starts at (0,0); returns its size. */
function normalise(keys: LayoutKey[]): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of keys) {
    for (const [px, py] of corners(k)) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }
  if (Math.abs(minX) > 1e-6 || Math.abs(minY) > 1e-6) {
    for (const k of keys) {
      k.x = round(k.x - minX);
      k.y = round(k.y - minY);
      if (k.rotation) k.rotation = { angle: k.rotation.angle, cx: round(k.rotation.cx - minX), cy: round(k.rotation.cy - minY) };
    }
  }
  return { width: round(maxX - minX), height: round(maxY - minY) };
}
