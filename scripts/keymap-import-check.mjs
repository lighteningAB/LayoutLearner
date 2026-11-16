// Checks the keymap importers in lib/layout/keymap against hand-written fixtures.
// Run: node scripts/keymap-import-check.mjs   (needs node >= 22.18 for TS type stripping)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { detectFormat, parseKeymap, flatten, KeymapImportError } from "../lib/layout/keymap/index.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "keymaps");
const read = (f) => readFileSync(join(dir, f), "utf8");

let failed = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error("returned false");
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + " -> " + (e && e.message ? e.message : e));
  }
}
function eq(a, b, what = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${what} expected ${y} but got ${x}`);
}
function rejects(name, text, fmt, maxMs = 1000) {
  check(name, () => {
    const t0 = Date.now();
    let err = null;
    try { parseKeymap(text, fmt); } catch (e) { err = e; }
    const ms = Date.now() - t0;
    if (!(err instanceof KeymapImportError)) throw new Error("expected KeymapImportError, got " + (err ? err.constructor.name + ": " + err.message : "success"));
    if (ms > maxMs) throw new Error(`took ${ms} ms`);
    if (!err.message || err.message.length < 10) throw new Error("message too short");
  });
}
const sig = (k) => [k.kind, k.base, k.shifted, k.holdLayer ?? null];

// ---------- Corne in four formats ----------
const corne = {
  "qmk-json": parseKeymap(read("corne.json")),
  "qmk-c": parseKeymap(read("corne.keymap.c")),
  zmk: parseKeymap(read("corne.keymap")),
  vial: parseKeymap(read("corne.vil")),
};
check("detectFormat on all four corne files", () => {
  eq(detectFormat(read("corne.json")), "qmk-json");
  eq(detectFormat(read("corne.keymap.c")), "qmk-c");
  eq(detectFormat(read("corne.keymap")), "zmk");
  eq(detectFormat(read("corne.vil")), "vial");
  eq(detectFormat("hello"), null);
});
for (const [fmt, km] of Object.entries(corne)) {
  check(`corne ${fmt}: 3 layers x 42 keys`, () => {
    eq(km.format, fmt);
    eq(km.layers.length, 3);
    for (const l of km.layers) eq(l.keys.length, 42);
  });
}
check("corne qmk-json metadata", () => {
  eq(corne["qmk-json"].keyboard, "crkbd/rev1");
  eq(corne["qmk-json"].layoutName, "LAYOUT_split_3x6_3");
});
check("corne qmk-c layer names and layout", () => {
  eq(corne["qmk-c"].layers.map((l) => l.name), ["Qwerty", "Lower", "Raise"]);
  eq(corne["qmk-c"].layoutName, "LAYOUT_split_3x6_3");
});
check("corne zmk layer names", () => eq(corne.zmk.layers.map((l) => l.name), ["Qwerty", "Lower", "Raise"]));
check("corne spot values", () => {
  const km = corne["qmk-c"];
  const k = (l, i) => sig(km.layers[l].keys[i]);
  eq(k(0, 1), ["char", "q", "Q", null], "Q");
  eq(k(0, 37), ["layer", "", "", 1], "MO(1)");
  eq(k(0, 40), ["char", " ", " ", 2], "LT(2,SPC)");
  eq(k(1, 1), ["char", "1", "!", null], "1");
  eq(k(1, 12), ["transparent", "", "", null], "trans");
  eq(k(1, 17), ["none", "", "", null], "none");
  eq(k(2, 1), ["char", "!", "", null], "KC_EXLM");
  eq(k(2, 19), ["char", ":", "", null], "S(KC_SCLN)");
  eq(k(0, 0), ["other", "", "", null], "Tab is non-printing");
  eq(k(0, 12), ["modifier", "", "", null], "Ctrl");
  eq(km.warnings, [], "no warnings");
});
for (const fmt of ["qmk-c", "zmk", "vial"]) {
  check(`corne ${fmt} equals qmk-json per position`, () => {
    const a = corne["qmk-json"], b = corne[fmt];
    for (let l = 0; l < 3; l++)
      for (let i = 0; i < 42; i++)
        eq(sig(b.layers[l].keys[i]), sig(a.layers[l].keys[i]), `layer ${l} key ${i} (${b.layers[l].keys[i].raw})`);
  });
}
check("vial carries the split-board order warning", () => corne.vial.warnings.some((w) => /split/i.test(w)));

// ---------- flatten ----------
check("flatten resolves transparent keys from layer 0", () => {
  const f = flatten(corne["qmk-c"]);
  eq(sig(f.layers[1].keys[12]), sig(corne["qmk-c"].layers[0].keys[12]), "ctrl shows through on lower");
  eq(sig(f.layers[2].keys[24]), sig(corne["qmk-c"].layers[0].keys[24]), "shift shows through on raise");
  eq(sig(f.layers[1].keys[1]), ["char", "1", "!", null], "non-transparent kept");
  if (f.layers.some((l) => l.keys.some((k) => k.kind === "transparent"))) throw new Error("transparent left");
  if (corne["qmk-c"].layers[1].keys[12].kind !== "transparent") throw new Error("input was mutated");
});
check("flatten chains through a parent layer and falls back to none", () => {
  const mk = (kind, base, holdLayer) => ({ base, shifted: "", kind, label: base, raw: base, ...(holdLayer !== undefined ? { holdLayer } : {}) });
  const km = {
    format: "qmk-json", keyboard: "", layoutName: "", warnings: [],
    layers: [
      { name: "0", keys: [mk("char", "a"), mk("layer", "", 1), mk("transparent", "")] },
      { name: "1", keys: [mk("transparent", ""), mk("transparent", ""), mk("layer", "", 2)] },
      { name: "2", keys: [mk("transparent", ""), mk("transparent", ""), mk("transparent", "")] },
    ],
  };
  const f = flatten(km);
  eq(f.layers[2].keys[0].base, "a", "layer 2 -> layer 1 -> layer 0");
  eq(f.layers[0].keys[2].kind, "none", "transparent on layer 0");
  eq(f.layers[2].keys[1].holdLayer, 1, "activator copied through");
});

// ---------- Ferris Sweep ZMK ----------
const sweep = parseKeymap(read("ferris-sweep.keymap"));
check("ferris sweep: 3 layers x 34 keys, names from label", () => {
  eq(sweep.layers.length, 3);
  eq(sweep.layers.map((l) => l.keys.length), [34, 34, 34]);
  eq(sweep.layers.map((l) => l.name), ["Base", "Nav", "Sym"]);
});
check("ferris sweep: home-row mod taps count as characters", () => {
  eq(sig(sweep.layers[0].keys[10]), ["char", "a", "A", null], "&hm LGUI A");
  eq(sig(sweep.layers[0].keys[19]), ["char", ";", ":", null], "&hm RGUI SEMI");
});
check("ferris sweep: &lt gives tap char and hold layer (defines resolved)", () => {
  eq(sig(sweep.layers[0].keys[31]), ["char", " ", " ", null], "&kp SPACE");
  eq(sig(sweep.layers[0].keys[30]), ["layer", "", "", 1], "&lt NAV TAB: tap Tab is not printable");
  eq(sig(sweep.layers[0].keys[33]), ["layer", "", "", 2], "&lt SYM BSPC");
});
check("ferris sweep: layer index defines and &mo", () => eq(sig(sweep.layers[1].keys[33]), ["layer", "", "", 2]));
check("ferris sweep: custom hold-tap with &mo as hold gives a layer (none used here), sk is modifier", () => {
  eq(sweep.layers[1].keys[23].kind, "modifier");
  eq(sweep.layers[1].keys[23].label, "OS Shift");
});
check("ferris sweep: unsupported kinds aggregated, one warning per type", () => {
  const w = sweep.warnings;
  const want = [/1 key uses toggle or one-shot layers/, /1 key uses tap dance/, /2 keys use Bluetooth/, /1 key uses media/, /2 keys use shortcuts/];
  for (const re of want) if (!w.some((x) => re.test(x))) throw new Error("missing warning " + re + " in " + JSON.stringify(w));
  if (!w.some((x) => /combos/.test(x))) throw new Error("no combos warning");
});
check("ferris sweep: shifted symbols and wrappers", () => {
  eq(sig(sweep.layers[2].keys[16]), ["char", ":", "", null], "LS(SEMI)");
  eq(sweep.layers[2].keys[25].kind, "other", "LC(C) is a shortcut");
});

// ---------- keymap.c with enums/defines/comments ----------
const sc = parseKeymap(read("sweep-style.keymap.c"));
check("sweep-style keymap.c: 4 layers x 36 keys, names from enum", () => {
  eq(sc.layers.map((l) => l.keys.length), [36, 36, 36, 36]);
  eq(sc.layers.map((l) => l.name), ["Qwerty", "Lower", "Raise", "Adjust"]);
  eq(sc.layoutName, "LAYOUT_split_3x5_3");
});
check("sweep-style: #define aliases resolve", () => {
  const k = sc.layers[0].keys;
  eq(sig(k[10]), ["char", "a", "A", null], "HM_A");
  eq(sig(k[19]), ["char", ";", ":", null], "HM_SC via MT()");
  eq(sig(k[31]), ["char", " ", " ", 1], "SPC_LO = LT(_LOWER, KC_SPC)");
  eq(sig(k[34]), ["layer", "", "", 2], "RAISE = MO(_RAISE)");
  eq(sig(k[32]), ["modifier", "", "", null], "OSM");
  eq(sig(k[30]), ["other", "", "", null], "CTL_ESC taps Esc (non-printing)");
});
check("sweep-style: transparent and none", () => {
  eq(sc.layers[1].keys[10].kind, "transparent");
  eq(sc.layers[1].keys[11].base, "");
  eq(sc.layers[3].keys[10].kind, "none");
});
check("sweep-style: aggregated warnings", () => {
  const w = sc.warnings;
  const has = (re) => { if (!w.some((x) => re.test(x))) throw new Error("missing " + re + " in " + JSON.stringify(w)); };
  has(/^2 keys use toggle or one-shot layers, which are not supported yet; they were skipped\.$/);
  has(/^1 key uses mouse keys/);
  has(/^1 key uses media or system keys/);
  has(/^4 keys use lighting keys/);
  has(/^1 key uses reset or bootloader keys/);
  eq(w.length, 5, "exactly one warning per type");
});

// ---------- more QMK / ZMK edge cases ----------
check("qmk-json basics: shifted aliases, S(), mod-tap, unknown", () => {
  const row = ["KC_A", "S(KC_1)", "LSFT(KC_LBRC)", "LCTL_T(KC_B)", "MT(MOD_LSFT, KC_C)", "KC_LCBR", "FOO_BAR", "LCTL(KC_C)", "TG(1)", "LT(1, KC_SPC)"];
  const km = parseKeymap(JSON.stringify({ layers: [row, row.map(() => "KC_TRNS")] }));
  const k = km.layers[0].keys;
  eq(sig(k[1]), ["char", "!", "", null]);
  eq(sig(k[2]), ["char", "{", "", null]);
  eq(sig(k[3]), ["char", "b", "B", null]);
  eq(sig(k[4]), ["char", "c", "C", null]);
  eq(sig(k[5]), ["char", "{", "", null]);
  eq(k[6].kind, "other");
  eq(k[7].kind, "other");
  eq(sig(k[9]), ["char", " ", " ", 1]);
  if (km.warnings.length !== 3) throw new Error("expected 3 warnings: " + JSON.stringify(km.warnings));
});
check("activator pointing at a missing layer is skipped with a warning", () => {
  const km = parseKeymap('{"layers": [["MO(3)","KC_A"]]}');
  eq(km.layers[0].keys[0].kind, "other");
  if (!km.warnings.some((w) => /not in this file/.test(w))) throw new Error(JSON.stringify(km.warnings));
});
check("qmk-json trailing comma tolerated (JSON5)", () => parseKeymap('{"layers": [["KC_A","KC_B",],]}').layers[0].keys.length === 2);
check("zmk: unknown behaviour consumes params up to the next &", () => {
  const z = `/ { keymap { compatible = "zmk,keymap"; a { bindings = <&weird 1 2 3 &kp A &kp B>; }; b { bindings = <&kp C &kp D &kp E>; }; }; };`;
  const km = parseKeymap(z);
  eq(km.layers.map((l) => l.keys.length), [3, 3]);
  eq(km.layers[0].keys[0].kind, "other");
  eq(km.layers[0].keys[1].base, "a");
});
check("zmk: layer name falls back to node name, // comments stripped", () => {
  const z = `/ { keymap { compatible = "zmk,keymap"; // c
  default_layer { bindings = <&kp A /* x */ &mo 1>; };
  other { display-name = "Fn"; bindings = <&trans &none>; }; }; };`;
  const km = parseKeymap(z);
  eq(km.layers.map((l) => l.name), ["Default Layer", "Fn"]);
  eq(km.layers[0].keys[1].label, "Fn");
});
check("size limits: >300 keys and >16 layers rejected", () => {
  let err = 0;
  try { parseKeymap(JSON.stringify({ layers: [new Array(301).fill("KC_A")] })); } catch (e) { if (e instanceof KeymapImportError && /301 keys per layer/.test(e.message)) err++; }
  try { parseKeymap(JSON.stringify({ layers: new Array(17).fill(["KC_A"]) })); } catch (e) { if (e instanceof KeymapImportError && /17 layers/.test(e.message)) err++; }
  eq(err, 2);
});

// ---------- malformed / hostile input ----------
rejects("truncated JSON", read("corne.json").slice(0, 400));
rejects("truncated JSON (explicit format)", '{"layers": [["KC_A", "KC_B"', "qmk-json");
rejects("not JSON object", "[1,2,3]", "qmk-json");
rejects("empty file", "   ");
rejects("unknown text", "just some words, nothing to see", undefined);
rejects("C: unbalanced parens", "const uint16_t PROGMEM keymaps[][1][1] = { [0] = LAYOUT(KC_A, LT(1, KC_B), KC_C };", "qmk-c");
rejects("C: unbalanced inner parens", "keymaps[] = { [0] = LAYOUT(KC_A, LT(1, KC_B), KC_C) , [1] = LAYOUT(KC_A, MO(1, KC_C) };", "qmk-c");
rejects("C: no keymaps list", "int main() { return 0; }", "qmk-c");
rejects("C: mismatched layer sizes", "const uint16_t PROGMEM keymaps[][1][1] = { [0] = LAYOUT(KC_A, KC_B), [1] = LAYOUT(KC_A) };", "qmk-c");
rejects("JSON: mismatched layer sizes", '{"layers": [["KC_A","KC_B"],["KC_A"]]}', "qmk-json");
rejects("vial: mismatched layer sizes", '{"layout": [[["KC_A","KC_B"]],[["KC_A",-1]]]}', "vial");
rejects("ZMK: unclosed section", `/ { keymap { compatible = "zmk,keymap"; a { bindings = <&kp A>;`, "zmk");
rejects("ZMK: no keymap section", "/ { foo { bar = <1>; }; };", "zmk");
rejects("ZMK: mismatched layer sizes", `/ { keymap { compatible = "zmk,keymap"; a { bindings = <&kp A &kp B>; }; b { bindings = <&kp A>; }; }; };`, "zmk");
rejects("1 MB of garbage", "x(;{[<\"".repeat(150000), undefined);
rejects("1 MB of garbage (explicit zmk)", "{".repeat(1024 * 1024), "zmk");
rejects("deeply nested parens in a C key", "keymaps[] = { [0] = LAYOUT(" + "(".repeat(150000) + ") };", "qmk-c");
rejects("deeply nested parens in a closed C key", "keymaps[] = { [0] = LAYOUT(" + "(".repeat(100000) + ")".repeat(100000) + ") };", "qmk-c");
rejects("deeply nested braces in ZMK", "/ {".repeat(60000), "zmk");
rejects("deeply nested ZMK words", `/ { keymap { compatible = "zmk,keymap"; a { bindings = <&kp ${"(".repeat(150000)}>; }; }; };`, "zmk");
rejects("deeply nested JSON arrays", "[".repeat(190000), "qmk-json");
rejects("deeply nested JSON arrays (vial)", '{"layout": ' + "[".repeat(190000), "vial");
rejects("many 'enum' words", "enum ".repeat(40000), "qmk-c");
rejects("long run of underscores/commas in C", "keymaps[] = { [0] = LAYOUT(" + ",".repeat(150000) + ") };", "qmk-c");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
