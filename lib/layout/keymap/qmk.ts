import { KeymapImportError, LIMITS } from "./types.ts";
import type { ImportedKey, ImportedKeymap, ImportedLayer } from "./types.ts";
import { classifyQmkSpecial, lookupQmkKey } from "./keycodes.ts";
import { parseJsonLoose } from "./json.ts";
import {
  NONE_LABEL, TRANSPARENT_LABEL, checkShape, finish, findClose, isIdent, mkKey, modLabel, newAgg,
  otherKey, parseIntLiteral, preprocess, prettifyName, splitTopLevel, stripComments,
} from "./util.ts";
import type { Agg } from "./util.ts";

/** Everything needed to turn one QMK keycode token into an ImportedKey. */
export interface QmkCtx {
  defines: Map<string, string>;
  /** Layer name -> index (enum members and numeric #defines). */
  layerIdx: Map<string, number>;
  /** Layer display names by index, for key labels. */
  labels: string[];
  agg: Agg;
}

const SHIFT_WRAP = new Set(["S", "LSFT", "RSFT"]);
const MOD_WRAP = new Set([
  "C", "A", "G", "LCTL", "LALT", "LGUI", "LCMD", "LWIN", "RCTL", "RALT", "RGUI", "RCMD", "RWIN", "ALGR",
  "HYPR", "MEH", "LCA", "LSA", "LCG", "LAG", "LSG", "RCS", "RCA", "RSA", "RCG", "RAG", "RSG", "SGUI", "LCAG", "ALL",
]);
const LAYER_TOGGLE = new Set(["TG", "TO", "TT", "OSL", "DF", "PDF"]);
const MAX_DEPTH = 6;

function layerLabel(ctx: QmkCtx, n: number): string {
  return ctx.labels[n] ?? "L" + n;
}

function resolveLayerIndex(arg: string, ctx: QmkCtx, depth = 0): number | null {
  const a = arg.trim();
  const lit = parseIntLiteral(a);
  if (lit !== null) return lit;
  const v = ctx.layerIdx.get(a);
  if (v !== undefined) return v;
  const d = ctx.defines.get(a);
  if (d !== undefined && depth < 4) return resolveLayerIndex(d, ctx, depth + 1);
  return null;
}

function safeSplit(text: string): string[] | null {
  try {
    return splitTopLevel(text);
  } catch (e) {
    if (e instanceof KeymapImportError) return null;
    throw e;
  }
}

function tapOf(tap: ImportedKey): { base: string; shifted: string } {
  return tap.kind === "char" ? { base: tap.base, shifted: tap.shifted } : { base: "", shifted: "" };
}

/** Turns one QMK/Vial keycode token into a key. Never throws for bad content. */
export function resolveQmkToken(rawToken: string, ctx: QmkCtx, depth = 0): ImportedKey {
  const tok = rawToken.trim();
  const unknown = () => otherKey(tok, tok.length > 10 ? tok.slice(0, 9) + "…" : tok || "?", ctx.agg, "unknown");
  if (depth > MAX_DEPTH) return unknown();
  if (tok === "") return mkKey("none", "", "", NONE_LABEL, tok);

  if (/^_{2,}$/.test(tok) || tok === "KC_TRNS" || tok === "KC_TRANSPARENT" || tok === "TRNS")
    return mkKey("transparent", "", "", TRANSPARENT_LABEL, tok);
  if (tok === "XXXXXXX" || tok === "XXX" || tok === "KC_NO" || tok === "NO")
    return mkKey("none", "", "", NONE_LABEL, tok);

  const paren = tok.indexOf("(");
  if (paren < 0) {
    if (!isIdent(tok)) return unknown();
    const def = ctx.defines.get(tok);
    if (def !== undefined && def !== tok) return { ...resolveQmkToken(def, ctx, depth + 1), raw: tok };
    const key = tok.startsWith("KC_") ? lookupQmkKey(tok) : null;
    if (key) return mkKey(key.kind, key.base, key.shifted, key.label, tok);
    if (tok.startsWith("KC_")) {
      const cat = classifyQmkSpecial(tok);
      return cat ? otherKey(tok, tok.slice(3), ctx.agg, cat) : unknown();
    }
    const cat = classifyQmkSpecial(tok);
    return cat ? otherKey(tok, tok, ctx.agg, cat) : unknown();
  }

  // Function-like: NAME( args )
  if (tok[tok.length - 1] !== ")") return unknown();
  const name = tok.slice(0, paren).trim();
  if (!isIdent(name)) return unknown();
  const args = safeSplit(tok.slice(paren + 1, -1));
  if (!args) return unknown();

  const layerOf = (a: string | undefined): number | null => (a === undefined ? null : resolveLayerIndex(a, ctx));

  if (name === "MO" || name === "LM") {
    const n = layerOf(args[0]);
    if (n === null) return otherKey(tok, "MO?", ctx.agg, "layerref");
    return mkKey("layer", "", "", layerLabel(ctx, n), tok, n);
  }
  if (LAYER_TOGGLE.has(name)) return otherKey(tok, name + (args[0] ? " " + args[0] : ""), ctx.agg, "layer");

  if (name === "LT" || /^LT[0-9]{1,2}$/.test(name)) {
    const vial = name !== "LT";
    const n = vial ? Number(name.slice(2)) : layerOf(args[0]);
    const tapTok = vial ? args[0] : args[1];
    if (n === null || tapTok === undefined) return otherKey(tok, "LT?", ctx.agg, "layerref");
    const tap = resolveQmkToken(tapTok, ctx, depth + 1);
    const t = tapOf(tap);
    return mkKey(tap.kind === "char" ? "char" : "layer", t.base, t.shifted, `LT${n} ${tap.label}`, tok, n);
  }

  if (name === "MT" || (name.endsWith("_T") && name.length > 2)) {
    const tapTok = name === "MT" ? args[1] : args[0];
    if (tapTok === undefined) return unknown();
    const tap = resolveQmkToken(tapTok, ctx, depth + 1);
    return { ...tap, raw: tok };
  }

  if (name === "OSM") {
    const l = modLabel(args[0] ?? "");
    return mkKey("modifier", "", "", "OS " + l, tok);
  }

  if (SHIFT_WRAP.has(name)) {
    if (args.length !== 1) return unknown();
    const inner = resolveQmkToken(args[0], ctx, depth + 1);
    if (inner.kind === "char") {
      const c = inner.shifted || inner.base;
      return mkKey("char", c, "", c.length === 1 ? c.toUpperCase() : c, tok);
    }
    if (inner.kind === "other" && inner.label) return { ...inner, raw: tok };
    return otherKey(tok, "S+", ctx.agg, "shortcut");
  }
  if (MOD_WRAP.has(name)) return otherKey(tok, name, ctx.agg, "shortcut");

  if (name === "TD") return otherKey(tok, "TD", ctx.agg, "tapdance");
  if (name === "M" || name === "DM_RSTP") return otherKey(tok, name, ctx.agg, "macro");
  return unknown();
}

// ---------- shared ----------

function checkSize(n: number): void {
  if (n > LIMITS.maxKeysPerLayer)
    throw new KeymapImportError(
      `This file has ${n} keys per layer; the most we can read is ${LIMITS.maxKeysPerLayer}.`,
    );
}

function buildKeymap(
  format: ImportedKeymap["format"], keyboard: string, layoutName: string,
  named: { name: string; tokens: string[] }[], ctx: QmkCtx, extra: string[],
): ImportedKeymap {
  checkShape(named.map((l) => l.tokens.length));
  const layers: ImportedLayer[] = named.map((l) => ({
    name: l.name,
    keys: l.tokens.map((t) => resolveQmkToken(t, ctx)),
  }));
  const warnings = finish(layers, ctx.agg, extra);
  return { format, keyboard, layoutName, layers, warnings };
}

function emptyCtx(): QmkCtx {
  return { defines: new Map(), layerIdx: new Map(), labels: [], agg: newAgg() };
}

function asString(x: unknown): string {
  return typeof x === "string" ? x : x === null || x === undefined ? "" : String(x);
}

// ---------- qmk-json ----------

export function parseQmkJson(text: string): ImportedKeymap {
  const obj = parseJsonLoose(text) as { keyboard?: unknown; layout?: unknown; layers?: unknown } | undefined;
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    throw new KeymapImportError("This file is not valid JSON, or it is cut off. Re-export it and try again.");
  if (!Array.isArray(obj.layers))
    throw new KeymapImportError("This JSON file has no \"layers\" list, so it does not look like a QMK keymap.");
  const raw = obj.layers as unknown[];
  if (raw.length > LIMITS.maxLayers) checkShape(new Array(raw.length).fill(1));
  const named = raw.map((l, i) => {
    if (!Array.isArray(l)) throw new KeymapImportError(`Layer ${i + 1} in this file is not a list of keys.`);
    checkSize(l.length);
    return { name: `Layer ${i}`, tokens: l.map(asString) };
  });
  return buildKeymap("qmk-json", asString(obj.keyboard), asString(obj.layout), named, emptyCtx(), []);
}

// ---------- vial ----------

export function parseVial(text: string): ImportedKeymap {
  const obj = parseJsonLoose(text) as { layout?: unknown } | undefined;
  if (!obj || typeof obj !== "object" || Array.isArray(obj))
    throw new KeymapImportError("This file is not valid JSON, or it is cut off. Re-export it from Vial and try again.");
  if (!Array.isArray(obj.layout))
    throw new KeymapImportError("This file has no \"layout\" list, so it does not look like a Vial keymap.");
  const raw = obj.layout as unknown[];
  if (raw.length > LIMITS.maxLayers) checkShape(new Array(raw.length).fill(1));
  const named = raw.map((layer, i) => {
    if (!Array.isArray(layer)) throw new KeymapImportError(`Layer ${i + 1} in this file is not a grid of keys.`);
    const tokens: string[] = [];
    for (const row of layer) {
      if (!Array.isArray(row)) throw new KeymapImportError(`Layer ${i + 1} in this file is not a grid of keys.`);
      for (const code of row) {
        if (code === -1) continue;
        tokens.push(typeof code === "number" ? "#" + code : asString(code));
        if (tokens.length > LIMITS.maxKeysPerLayer) checkSize(tokens.length);
      }
    }
    return { name: `Layer ${i}`, tokens };
  });
  return buildKeymap("vial", "", "", named, emptyCtx(), [
    "Vial lists keys in the order of the keyboard's wiring grid, which may not match how the keys look on split boards. Check the preview before using it.",
  ]);
}

// ---------- qmk-c ----------

function parseEnums(text: string, out: Map<string, number>): void {
  let pos = 0;
  while (pos < text.length) {
    const at = text.indexOf("enum", pos);
    if (at < 0) return;
    pos = at + 4;
    const before = at > 0 ? text[at - 1] : " ";
    if (/[A-Za-z0-9_]/.test(before) || /[A-Za-z0-9_]/.test(text[pos] ?? " ")) continue;
    let j = pos;
    while (j < text.length && /\s/.test(text[j])) j++;
    while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== "{") continue;
    const end = text.indexOf("}", j);
    if (end < 0) return;
    pos = end + 1;
    let next: number | null = 0;
    const members = text.slice(j + 1, end).split(",");
    for (const m of members.slice(0, 1000)) {
      const eq = m.indexOf("=");
      const nm = (eq < 0 ? m : m.slice(0, eq)).trim();
      if (!isIdent(nm)) continue;
      if (eq >= 0) next = parseIntLiteral(m.slice(eq + 1));
      if (next !== null) {
        out.set(nm, next);
        next++;
      }
    }
  }
}

function findKeymapsOpen(text: string): number {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf("keymaps", from);
    if (at < 0) return -1;
    from = at + 7;
    if (at > 0 && /[A-Za-z0-9_]/.test(text[at - 1])) continue;
    let j = from;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== "[") continue;
    const eq = text.indexOf("=", j);
    if (eq < 0) return -1;
    let k = eq + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] === "{") return k;
  }
  return -1;
}

export function parseQmkC(source: string): ImportedKeymap {
  const stripped = stripComments(source);
  const { text, defines, conditionals } = preprocess(stripped);
  const ctx = emptyCtx();
  ctx.defines = defines;
  parseEnums(text, ctx.layerIdx);
  for (const [k, v] of defines) {
    const n = parseIntLiteral(v);
    if (n !== null && !ctx.layerIdx.has(k)) ctx.layerIdx.set(k, n);
  }

  const open = findKeymapsOpen(text);
  if (open < 0)
    throw new KeymapImportError("Could not find the keymaps list in this file. Expected something like keymaps[] = { [0] = LAYOUT(...) }.");
  const close = findClose(text, open, "{", "}");
  if (close < 0) throw new KeymapImportError("The keymaps list in this file is not closed, so the file may be cut off.");

  const entries: { expr: string; args: string; layout: string }[] = [];
  let i = open + 1;
  while (i < close) {
    const c = text[i];
    if (/\s/.test(c) || c === ",") {
      i++;
      continue;
    }
    if (c !== "[")
      throw new KeymapImportError("Could not read the keymaps list; expected a layer like [_BASE] = LAYOUT(...).");
    const rb = text.indexOf("]", i);
    if (rb < 0 || rb > close) throw new KeymapImportError("A layer name in this file is missing its closing bracket.");
    const expr = text.slice(i + 1, rb).trim();
    let j = rb + 1;
    while (j < close && /\s/.test(text[j])) j++;
    if (text[j] !== "=") throw new KeymapImportError(`Layer ${expr} in this file is missing its "=" sign.`);
    j++;
    while (j < close && /\s/.test(text[j])) j++;
    let e = j;
    while (e < close && /[A-Za-z0-9_]/.test(text[e])) e++;
    const layout = text.slice(j, e);
    while (e < close && /\s/.test(text[e])) e++;
    if (!layout || text[e] !== "(") throw new KeymapImportError(`Layer ${expr} in this file does not use a LAYOUT(...) block.`);
    const end = findClose(text, e, "(", ")");
    if (end < 0 || end > close) throw new KeymapImportError(`Layer ${expr} in this file has brackets that are not closed.`);
    entries.push({ expr, args: text.slice(e + 1, end), layout });
    if (entries.length > LIMITS.maxLayers)
      throw new KeymapImportError(`This file has more than ${LIMITS.maxLayers} layers, which is more than we can read.`);
    i = end + 1;
  }
  if (!entries.length) throw new KeymapImportError("No layers were found in this file.");

  // Layer order: by enum value when they form 0..n-1, else file order.
  const idxOf = entries.map((en) => resolveEntryIndex(en.expr, ctx));
  const sorted = [...idxOf].sort((a, b) => (a ?? -1) - (b ?? -1));
  const perm = sorted.every((v, n) => v === n);
  const extra: string[] = [];
  let order = entries.map((_, n) => n);
  if (perm) order = order.sort((a, b) => (idxOf[a] as number) - (idxOf[b] as number));
  else if (idxOf.some((v, n) => v !== null && v !== n))
    extra.push("The layer numbers in this file are not in order, so layer positions were taken from the order they are written.");
  const ordered = order.map((n) => entries[n]);
  const names = ordered.map((en, n) => {
    const nm = parseIntLiteral(en.expr) !== null || !isIdent(en.expr) ? `Layer ${n}` : prettifyName(en.expr.replace(/^_+|_+$/g, ""));
    return nm || `Layer ${n}`;
  });
  ctx.labels = names;
  // Make sure names used as layer references point at the final positions.
  ordered.forEach((en, n) => {
    if (isIdent(en.expr)) ctx.layerIdx.set(en.expr, n);
  });

  const named = ordered.map((en, n) => {
    const tokens = splitTopLevel(en.args);
    checkSize(tokens.length);
    return { name: names[n], tokens };
  });
  if (conditionals)
    extra.push("This file has #if sections; every branch was read as if it were enabled, so the result may not match your build.");
  const km = buildKeymap("qmk-c", "", ordered[0].layout, named, ctx, extra);
  return km;
}

function resolveEntryIndex(expr: string, ctx: QmkCtx): number | null {
  return resolveLayerIndex(expr, ctx);
}
