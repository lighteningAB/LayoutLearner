import { KeymapImportError, LIMITS } from "./types.ts";
import type { ImportedKey, ImportedLayer } from "./types.ts";

// ---------- warning aggregation ----------

export type Agg = Map<string, number>;

const WHAT: [string, string][] = [
  ["layer", "toggle or one-shot layers"],
  ["macro", "macros"],
  ["tapdance", "tap dance"],
  ["mouse", "mouse keys"],
  ["media", "media or system keys"],
  ["rgb", "lighting keys"],
  ["bluetooth", "Bluetooth or output keys"],
  ["boot", "reset or bootloader keys"],
  ["shortcut", "shortcuts such as Ctrl plus a key"],
  ["layerref", "layer names that could not be worked out"],
  ["unknown", "codes this importer does not recognise"],
];

export function newAgg(): Agg {
  return new Map();
}

export function bump(agg: Agg, cat: string): void {
  agg.set(cat, (agg.get(cat) ?? 0) + 1);
}

export function aggWarnings(agg: Agg): string[] {
  const out: string[] = [];
  for (const [cat, what] of WHAT) {
    const n = agg.get(cat);
    if (!n) continue;
    const one = n === 1;
    out.push(
      `${n} ${one ? "key uses" : "keys use"} ${what}, which ${one ? "is" : "are"} not supported yet; ${one ? "it was" : "they were"} skipped.`,
    );
  }
  return out;
}

// ---------- key helpers ----------

export function mkKey(
  kind: ImportedKey["kind"], base: string, shifted: string, label: string, raw: string, holdLayer?: number,
): ImportedKey {
  const k: ImportedKey = { base, shifted, kind, label, raw };
  if (holdLayer !== undefined) k.holdLayer = holdLayer;
  return k;
}

export const TRANSPARENT_LABEL = "▽";
export const NONE_LABEL = "✕";

/** An unsupported key. `cat` undefined = silent (ordinary non-printing key like Enter). */
export function otherKey(raw: string, label: string, agg: Agg, cat?: string): ImportedKey {
  if (cat) bump(agg, cat);
  return mkKey("other", "", "", label, raw);
}

export function modLabel(name: string): string {
  const s = name.toUpperCase();
  if (s.includes("CTL") || s.includes("CTRL")) return "Ctrl";
  if (s.includes("SFT") || s.includes("SHFT") || s.includes("SHIFT")) return "Shift";
  if (s.includes("ALT") || s.includes("OPT")) return "Alt";
  if (s.includes("GUI") || s.includes("CMD") || s.includes("WIN")) return "Gui";
  return "Mod";
}

export function parseIntLiteral(s: string): number | null {
  const t = s.trim();
  if (/^[0-9]{1,6}$/.test(t)) return Number(t);
  if (/^0[xX][0-9a-fA-F]{1,6}$/.test(t)) return parseInt(t, 16);
  return null;
}

export function isIdent(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/** "_LOWER_LAYER" -> "Lower Layer" */
export function prettifyName(s: string): string {
  const words = s.split("_").filter(Boolean);
  if (!words.length) return s;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ---------- text scanning (hand-written, linear) ----------

/** Removes // and block comments, keeping string and char literals intact. */
export function stripComments(src: string): string {
  const out: string[] = [];
  const n = src.length;
  let i = 0;
  let start = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      out.push(src.slice(start, i));
      const nl = src.indexOf("\n", i);
      i = start = nl < 0 ? n : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      out.push(src.slice(start, i), " ");
      const end = src.indexOf("*/", i + 2);
      i = start = end < 0 ? n : end + 2;
      continue;
    }
    i++;
  }
  out.push(src.slice(start));
  return out.join("");
}

const DIRECTIVES = new Set([
  "define", "include", "if", "ifdef", "ifndef", "elif", "else", "endif", "undef", "pragma", "error", "warning",
]);

/**
 * Collects simple object-like `#define NAME value` lines and removes preprocessor
 * lines. (`#binding-cells` and friends are not directives and are kept.)
 */
export function preprocess(src: string): { text: string; defines: Map<string, string>; conditionals: boolean } {
  const joined = src.replace(/\\\r?\n/g, " ");
  const defines = new Map<string, string>();
  let conditionals = false;
  const kept: string[] = [];
  for (const line of joined.split(/\r?\n/)) {
    const t = line.trimStart();
    if (t.charCodeAt(0) !== 35 /* # */) {
      kept.push(line);
      continue;
    }
    let j = 1;
    while (j < t.length && (t[j] === " " || t[j] === "\t")) j++;
    let k = j;
    while (k < t.length && /[a-z]/.test(t[k])) k++;
    const word = t.slice(j, k);
    if (!DIRECTIVES.has(word)) {
      kept.push(line);
      continue;
    }
    if (word === "define" && defines.size < 5000) {
      const rest = t.slice(k).trim();
      let e = 0;
      while (e < rest.length && /[A-Za-z0-9_]/.test(rest[e])) e++;
      const name = rest.slice(0, e);
      if (name && rest[e] !== "(") defines.set(name, rest.slice(e).trim());
    } else if (word.startsWith("if") || word === "elif" || word === "else") {
      conditionals = true;
    }
  }
  return { text: kept.join("\n"), defines, conditionals };
}

/** Index of the bracket closing the one at `openIdx`, or -1. Throws if nested too deeply. */
export function findClose(text: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === open) {
      depth++;
      if (depth > LIMITS.maxNesting) throw tooDeep();
    } else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function tooDeep(): KeymapImportError {
  return new KeymapImportError("This file has brackets nested far too deeply to be a real keymap.");
}

export function unbalanced(): KeymapImportError {
  return new KeymapImportError("A set of brackets in this file is not closed properly, so the keymap cannot be read.");
}

/** Splits on commas outside any (), [] or {}. Drops one trailing empty entry. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 40 || c === 91 || c === 123) {
      depth++;
      if (depth > LIMITS.maxNesting) throw tooDeep();
    } else if (c === 41 || c === 93 || c === 125) {
      depth--;
      if (depth < 0) throw unbalanced();
    } else if (c === 44 && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) throw unbalanced();
  parts.push(text.slice(start).trim());
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Splits on whitespace outside parentheses. */
export function splitWords(text: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ws = c === 32 || c === 9 || c === 10 || c === 13;
    if (ws && depth === 0) {
      if (start >= 0) words.push(text.slice(start, i));
      start = -1;
      continue;
    }
    if (start < 0) start = i;
    if (c === 40) {
      depth++;
      if (depth > LIMITS.maxNesting) throw tooDeep();
    } else if (c === 41) {
      depth = Math.max(0, depth - 1);
    }
  }
  if (start >= 0) words.push(text.slice(start));
  return words;
}

// ---------- shape + finishing ----------

export function checkShape(counts: number[]): void {
  if (counts.length === 0) throw new KeymapImportError("No layers were found in this file.");
  if (counts.length > LIMITS.maxLayers)
    throw new KeymapImportError(`This file has ${counts.length} layers; the most we can read is ${LIMITS.maxLayers}.`);
  const max = Math.max(...counts);
  if (max > LIMITS.maxKeysPerLayer)
    throw new KeymapImportError(
      `This file has ${max} keys per layer; the most we can read is ${LIMITS.maxKeysPerLayer}.`,
    );
  if (max === 0) throw new KeymapImportError("The layers in this file have no keys.");
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] !== counts[0])
      throw new KeymapImportError(
        `The layers in this file do not all have the same number of keys: layer 1 has ${counts[0]}, but layer ${i + 1} has ${counts[i]}.`,
      );
  }
}

/** Marks activators that point at missing layers, then builds the warning list. */
export function finish(layers: ImportedLayer[], agg: Agg, extra: string[]): string[] {
  let missing = 0;
  for (const layer of layers) {
    for (let i = 0; i < layer.keys.length; i++) {
      const k = layer.keys[i];
      if (k.holdLayer !== undefined && k.holdLayer >= layers.length) {
        missing++;
        layer.keys[i] = mkKey("other", "", "", k.label, k.raw);
      }
    }
  }
  const warnings = [...extra, ...aggWarnings(agg)];
  if (missing)
    warnings.push(
      `${missing} ${missing === 1 ? "key points" : "keys point"} to a layer that is not in this file; ${missing === 1 ? "it was" : "they were"} skipped.`,
    );
  return warnings;
}
