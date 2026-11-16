import { KeymapImportError, LIMITS } from "./types.ts";
import type { ImportedKey, ImportedKeymap, ImportedLayer } from "./types.ts";
import { classifyZmkSpecial, lookupZmkKey } from "./keycodes.ts";
import {
  NONE_LABEL, TRANSPARENT_LABEL, checkShape, finish, isIdent, mkKey, modLabel, newAgg, otherKey, parseIntLiteral,
  preprocess, prettifyName, splitWords, stripComments, tooDeep,
} from "./util.ts";
import type { Agg } from "./util.ts";

// ---------- minimal devicetree reader ----------

interface DtNode {
  label: string;
  name: string;
  props: Map<string, string>;
  children: DtNode[];
}

const MAX_NODES = 5000;
const MAX_DT_DEPTH = 32;

function parseDt(text: string): DtNode {
  const root: DtNode = { label: "", name: "/", props: new Map(), children: [] };
  let pos = 0;
  let nodes = 0;

  const readNodeBody = (node: DtNode, depth: number): void => {
    if (depth > MAX_DT_DEPTH) throw tooDeep();
    for (;;) {
      while (pos < text.length && /\s/.test(text[pos])) pos++;
      if (pos >= text.length) {
        if (depth === 0) return;
        throw new KeymapImportError("This file ends in the middle of a section, so it may be cut off.");
      }
      if (text[pos] === "}") {
        pos++;
        while (pos < text.length && /[\s;]/.test(text[pos])) {
          if (text[pos] === ";") {
            pos++;
            break;
          }
          pos++;
        }
        if (depth === 0) throw new KeymapImportError("This file has a closing } with no matching opening {.");
        return;
      }
      // Statement: runs to ';' (property) or '{' (node), ignoring strings and <...>.
      const start = pos;
      let inStr = false;
      let inAngle = false;
      let endCh = "";
      while (pos < text.length) {
        const c = text[pos];
        if (inStr) {
          if (c === "\\") pos++;
          else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (inAngle) {
          if (c === ">") inAngle = false;
        } else if (c === "<") inAngle = true;
        else if (c === ";" || c === "{") {
          endCh = c;
          break;
        }
        pos++;
      }
      if (!endCh) throw new KeymapImportError("This file ends in the middle of a line, so it may be cut off.");
      const head = text.slice(start, pos).trim();
      pos++;
      if (endCh === "{") {
        if (++nodes > MAX_NODES) throw new KeymapImportError("This file has too many sections to read.");
        const colon = head.indexOf(":");
        const label = colon >= 0 ? head.slice(0, colon).trim() : "";
        const name = (colon >= 0 ? head.slice(colon + 1) : head).trim();
        const child: DtNode = { label, name, props: new Map(), children: [] };
        node.children.push(child);
        readNodeBody(child, depth + 1);
      } else {
        const eq = head.indexOf("=");
        if (eq >= 0) node.props.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
        else if (head) node.props.set(head, "");
      }
    }
  };
  readNodeBody(root, 0);
  return root;
}

function propString(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const a = raw.indexOf('"');
  if (a < 0) return null;
  const b = raw.indexOf('"', a + 1);
  return b < 0 ? null : raw.slice(a + 1, b);
}

/** Contents of all <...> groups joined with spaces. */
function propCells(raw: string | undefined): string {
  if (raw === undefined) return "";
  const parts: string[] = [];
  let pos = 0;
  while (pos < raw.length) {
    const a = raw.indexOf("<", pos);
    if (a < 0) break;
    const b = raw.indexOf(">", a + 1);
    if (b < 0) break;
    parts.push(raw.slice(a + 1, b));
    pos = b + 1;
  }
  return parts.join(" ");
}

function walk(node: DtNode, fn: (n: DtNode) => void): void {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

// ---------- behaviours ----------

interface BehaviourInfo {
  compat: string;
  cells: number | null;
  /** Behaviour refs listed in `bindings`, without the &. */
  refs: string[];
}

interface ZmkCtx {
  defines: Map<string, string>;
  layerIdx: Map<string, number>;
  labels: string[];
  behaviours: Map<string, BehaviourInfo>;
  agg: Agg;
}

const NO_PARAM = new Set(["trans", "none", "caps_word", "key_repeat", "sys_reset", "bootloader", "studio_unlock", "gresc"]);
const MOUSE = new Set(["mkp", "mmv", "msc"]);
const RGB = new Set(["rgb_ug", "bl", "ext_power"]);
const BLUETOOTH = new Set(["bt", "out"]);

function lookupDefine(ctx: ZmkCtx, s: string): string {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    const v = ctx.defines.get(cur);
    if (v === undefined || v === cur || v === "") return cur;
    cur = v;
  }
  return cur;
}

function layerIndex(ctx: ZmkCtx, p: string | undefined): number | null {
  if (p === undefined) return null;
  const lit = parseIntLiteral(p);
  if (lit !== null) return lit;
  const named = ctx.layerIdx.get(p);
  if (named !== undefined) return named;
  const d = lookupDefine(ctx, p);
  return parseIntLiteral(d);
}

const SHIFT_FN = new Set(["LS", "RS"]);
const MOD_FN = new Set(["LC", "LA", "LG", "RC", "RA", "RG"]);

function zmkKey(exprRaw: string | undefined, ctx: ZmkCtx, raw: string, depth = 0): ImportedKey {
  const expr = lookupDefine(ctx, (exprRaw ?? "").trim());
  const unknown = () => otherKey(raw, expr.length > 10 ? expr.slice(0, 9) + "…" : expr || "?", ctx.agg, "unknown");
  if (!expr || depth > 6) return unknown();
  const paren = expr.indexOf("(");
  if (paren >= 0) {
    if (expr[expr.length - 1] !== ")") return unknown();
    const fn = expr.slice(0, paren).trim();
    const inner = zmkKey(expr.slice(paren + 1, -1), ctx, raw, depth + 1);
    if (SHIFT_FN.has(fn)) {
      if (inner.kind === "char") {
        const c = inner.shifted || inner.base;
        return mkKey("char", c, "", c.length === 1 ? c.toUpperCase() : c, raw);
      }
      return { ...inner, raw };
    }
    if (MOD_FN.has(fn)) return otherKey(raw, fn, ctx.agg, "shortcut");
    return unknown();
  }
  if (!isIdent(expr)) return unknown();
  const def = lookupZmkKey(expr);
  if (def) return mkKey(def.kind, def.base, def.shifted, def.label, raw);
  const cat = classifyZmkSpecial(expr);
  return cat ? otherKey(raw, expr, ctx.agg, cat) : unknown();
}

function behaviourKey(ref: string, params: string[], ctx: ZmkCtx): ImportedKey {
  const raw = ("&" + ref + " " + params.join(" ")).trim();
  const layerKey = (p: string | undefined) => {
    const n = layerIndex(ctx, p);
    return n === null ? null : n;
  };
  const holdTap = (holdRef: string | undefined, tapRef: string | undefined, hold: string | undefined, tap: string | undefined) => {
    const n = holdRef === "mo" ? layerKey(hold) : null;
    const tk = tapRef === "kp" ? zmkKey(tap, ctx, raw) : null;
    const isChar = tk !== null && tk.kind === "char";
    if (n !== null) {
      const label = `LT${n} ${tk ? tk.label : ""}`.trim();
      return mkKey(isChar ? "char" : "layer", isChar ? tk!.base : "", isChar ? tk!.shifted : "", label, raw, n);
    }
    if (tk) return { ...tk, raw };
    return otherKey(raw, ref, ctx.agg, "unknown");
  };

  switch (ref) {
    case "kp":
      return zmkKey(params[0], ctx, raw);
    case "trans":
      return mkKey("transparent", "", "", TRANSPARENT_LABEL, raw);
    case "none":
      return mkKey("none", "", "", NONE_LABEL, raw);
    case "mo": {
      const n = layerKey(params[0]);
      if (n === null) return otherKey(raw, "mo?", ctx.agg, "layerref");
      return mkKey("layer", "", "", ctx.labels[n] ?? "L" + n, raw, n);
    }
    case "lt": {
      const n = layerKey(params[0]);
      if (n === null) return otherKey(raw, "lt?", ctx.agg, "layerref");
      return holdTap("mo", "kp", params[0], params[1]);
    }
    case "mt":
      return holdTap("kp", "kp", params[0], params[1]);
    case "sk":
      return mkKey("modifier", "", "", "OS " + modLabel(lookupDefine(ctx, params[0] ?? "")), raw);
    case "tog":
    case "to":
    case "sl":
      return otherKey(raw, ref, ctx.agg, "layer");
  }
  if (MOUSE.has(ref)) return otherKey(raw, ref, ctx.agg, "mouse");
  if (RGB.has(ref)) return otherKey(raw, ref, ctx.agg, "rgb");
  if (BLUETOOTH.has(ref)) return otherKey(raw, ref, ctx.agg, "bluetooth");
  if (ref === "sys_reset" || ref === "bootloader" || ref === "studio_unlock") return otherKey(raw, ref, ctx.agg, "boot");
  if (NO_PARAM.has(ref)) return otherKey(raw, ref, ctx.agg, "unknown");

  const info = ctx.behaviours.get(ref);
  if (info) {
    const c = info.compat;
    if (c === "zmk,behavior-hold-tap") return holdTap(info.refs[0], info.refs[1], params[0], params[1]);
    if (c === "zmk,behavior-tap-dance") return otherKey(raw, ref, ctx.agg, "tapdance");
    if (c.startsWith("zmk,behavior-macro")) return otherKey(raw, ref, ctx.agg, "macro");
    if (c === "zmk,behavior-sticky-key")
      return info.refs[0] === "kp"
        ? mkKey("modifier", "", "", "OS " + modLabel(lookupDefine(ctx, params[0] ?? "")), raw)
        : otherKey(raw, ref, ctx.agg, "layer");
  }
  return otherKey(raw, ref, ctx.agg, "unknown");
}

/** Groups the words of a bindings cell list into [ref, params] pairs. */
function groupBindings(words: string[]): { ref: string; params: string[] }[] {
  const out: { ref: string; params: string[] }[] = [];
  for (const w of words) {
    if (w.charCodeAt(0) === 38 /* & */) out.push({ ref: w.slice(1), params: [] });
    else if (out.length) out[out.length - 1].params.push(w);
  }
  return out;
}

export function parseZmk(source: string): ImportedKeymap {
  const stripped = stripComments(source);
  const { text, defines, conditionals } = preprocess(stripped);
  const root = parseDt(text);

  let keymap: DtNode | null = null;
  const behaviours = new Map<string, BehaviourInfo>();
  let hasCombos = false;
  walk(root, (n) => {
    const compat = propString(n.props.get("compatible")) ?? "";
    if (compat === "zmk,keymap" && !keymap) keymap = n;
    if (compat === "zmk,combos") hasCombos = true;
    if (compat.startsWith("zmk,behavior-")) {
      const cellsRaw = parseIntLiteral(propCells(n.props.get("#binding-cells")));
      const refs = propCells(n.props.get("bindings"))
        .split(/\s+/)
        .filter((w) => w.charCodeAt(0) === 38)
        .map((w) => w.slice(1));
      const info: BehaviourInfo = { compat, cells: cellsRaw, refs };
      if (n.label) behaviours.set(n.label, info);
      if (n.name) behaviours.set(n.name, info);
    }
  });
  if (!keymap)
    throw new KeymapImportError("Could not find the keymap section in this file (a block with compatible = \"zmk,keymap\").");

  const layerNodes = (keymap as DtNode).children.filter((c) => c.props.has("bindings"));
  if (!layerNodes.length) throw new KeymapImportError("No layers were found in this file.");
  if (layerNodes.length > LIMITS.maxLayers)
    throw new KeymapImportError(`This file has ${layerNodes.length} layers; the most we can read is ${LIMITS.maxLayers}.`);

  const layerIdx = new Map<string, number>();
  for (const [k, v] of defines) {
    const n = parseIntLiteral(v);
    if (n !== null) layerIdx.set(k, n);
  }
  const names = layerNodes.map((n, i) => {
    const nm = propString(n.props.get("display-name")) ?? propString(n.props.get("label")) ?? n.name;
    return nm && nm.trim() ? (nm === nm.toUpperCase() || nm.includes("_") ? prettifyName(nm.trim().replace(/-/g, "_")) : nm.trim()) : `Layer ${i}`;
  });
  const ctx: ZmkCtx = { defines, layerIdx, labels: names, behaviours, agg: newAgg() };

  const grouped = layerNodes.map((n) => {
    const words = splitWords(propCells(n.props.get("bindings")));
    if (words.length > LIMITS.maxKeysPerLayer * 12)
      throw new KeymapImportError("A layer in this file has far more keys than any keyboard we can read.");
    return groupBindings(words);
  });
  checkShape(grouped.map((g) => g.length));

  const layers: ImportedLayer[] = grouped.map((g, i) => ({
    name: names[i],
    keys: g.map((b) => behaviourKey(b.ref, b.params, ctx)),
  }));
  const extra: string[] = [];
  if (hasCombos) extra.push("This file defines combos, which are not supported yet; they were ignored.");
  if (conditionals)
    extra.push("This file has #if sections; every branch was read as if it were enabled, so the result may not match your build.");
  const warnings = finish(layers, ctx.agg, extra);
  return { format: "zmk", keyboard: "", layoutName: "", layers, warnings };
}
