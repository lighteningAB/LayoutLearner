// Built-in layouts, stored as keyboard-layout-editor.com raw data (the same format
// users paste for custom layouts). Parse with parseLayout() from ./parse.

export type LayoutFamily = "ansi-60" | "ansi-100" | "ortho" | "split";

export interface LayoutPreset {
  id: string;
  name: string;
  description: string;
  family: LayoutFamily;
  /** KLE raw data. */
  source: string;
}

type Item = string | Record<string, number>;

/** Serialises rows to KLE raw data (unquoted property names, one row per line). */
function kle(rows: Item[][]): string {
  return rows
    .map((row) => "[" + row.map((i) => (typeof i === "string" ? JSON.stringify(i) : JSON.stringify(i).replace(/"(\w+)":/g, "$1:"))).join(",") + "]")
    .join(",\n");
}

/** Space-separated legends; "!1" style pairs are written shifted-then-base, e.g. `{[`. */
function legends(spec: string): string[] {
  return spec.split(" ").map((t) => (t.length === 2 ? `${t[0]}\n${t[1]}` : t));
}

const NUMBERS = "~` !1 @2 #3 $4 %5 ^6 &7 *8 (9 )0";
const BOTTOM_60: Item[] = [{ w: 1.25 }, "Ctrl", { w: 1.25 }, "Win", { w: 1.25 }, "Alt", { w: 6.25 }, "", { w: 1.25 }, "Alt", { w: 1.25 }, "Win", { w: 1.25 }, "Menu", { w: 1.25 }, "Ctrl"];

/**
 * ANSI 60% board. `numberTail` = the 2 keys right of 0; `top` = 13 keys after Tab
 * (the last one is the 1.5u key); `home` = 11 keys after Caps Lock; `bottom` = 10 keys after Shift.
 */
function ansi60(numberTail: string, top: string, home: string, bottom: string): string {
  const t = legends(top);
  return kle([
    [...legends(NUMBERS + " " + numberTail), { w: 2 }, "Backspace"],
    [{ w: 1.5 }, "Tab", ...t.slice(0, 12), { w: 1.5 }, t[12]],
    [{ w: 1.75 }, "Caps Lock", ...legends(home), { w: 2.25 }, "Enter"],
    [{ w: 2.25 }, "Shift", ...legends(bottom), { w: 2.75 }, "Shift"],
    BOTTOM_60,
  ]);
}

const QWERTY_60 = ansi60("_- +=", "Q W E R T Y U I O P {[ }] |\\", "A S D F G H J K L :; \"'", "Z X C V B N M <, >. ?/");
const DVORAK_60 = ansi60("{[ }]", "\"' <, >. P Y F G C R L ?/ += |\\", "A O E U I D H T N S _-", ":; Q J K X B M W V Z");
const COLEMAK_60 = ansi60("_- +=", "Q W F P G J L U Y :; {[ }] |\\", "A R S T D H N E I O \"'", "Z X C V B K M <, >. ?/");
const COLEMAK_DH_60 = ansi60("_- +=", "Q W F P B J L U Y :; {[ }] |\\", "A R S T G M N E I O \"'", "X C D V Z K H <, >. ?/");
const WORKMAN_60 = ansi60("_- +=", "Q D R W B J F U P :; {[ }] |\\", "A S H T G Y N E O I \"'", "Z X M C V K L <, >. ?/");

const QWERTY_100 = `["Esc",{x:1},"F1","F2","F3","F4",{x:0.5},"F5","F6","F7","F8",{x:0.5},"F9","F10","F11","F12",{x:0.25},"PrtSc","Scroll Lock","Pause\\nBreak"],
[{y:0.5},"~\\n\`","!\\n1","@\\n2","#\\n3","$\\n4","%\\n5","^\\n6","&\\n7","*\\n8","(\\n9",")\\n0","_\\n-","+\\n=",{w:2},"Backspace",{x:0.25},"Insert","Home","PgUp",{x:0.25},"Num Lock","/","*","-"],
[{w:1.5},"Tab","Q","W","E","R","T","Y","U","I","O","P","{\\n[","}\\n]",{w:1.5},"|\\n\\\\",{x:0.25},"Delete","End","PgDn",{x:0.25},"7\\nHome","8\\n↑","9\\nPgUp",{h:2},"+"],
[{w:1.75},"Caps Lock","A","S","D","F","G","H","J","K","L",":\\n;","\\"\\n'",{w:2.25},"Enter",{x:3.5},"4\\n←","5","6\\n→"],
[{w:2.25},"Shift","Z","X","C","V","B","N","M","<\\n,",">\\n.","?\\n/",{w:2.75},"Shift",{x:1.25},"↑",{x:1.25},"1\\nEnd","2\\n↓","3\\nPgDn",{h:2},"Enter"],
[{w:1.25},"Ctrl",{w:1.25},"Win",{w:1.25},"Alt",{w:6.25},"",{w:1.25},"Alt",{w:1.25},"Win",{w:1.25},"Menu",{w:1.25},"Ctrl",{x:0.25},"←","↓","→",{x:0.25,w:2},"0\\nIns",".\\nDel"]`;

const QWERTY_ORTHO = kle([
  ["Tab", ...legends("Q W E R T Y U I O P"), "Bksp"],
  ["Esc", ...legends("A S D F G H J K L :; \"'")],
  ["Shift", ...legends("Z X C V B N M <, >. ?/"), "Enter"],
  ["Fn", "Ctrl", "Alt", "Win", "Lower", { w: 2 }, "", "Raise", "←", "↓", "↑", "→"],
]);

// ---------------------------------------------------------------------------
// Split / ergonomic boards
// ---------------------------------------------------------------------------

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** How far each column of a 3x6 half sits below the middle-finger column, outer column first. */
const SPLIT_3X6_STAGGER = [0.375, 0.375, 0.125, 0, 0.125, 0.25];

/**
 * 3x6 + 3 thumb keys per half, columnar stagger, halves 3u apart (Corne-style geometry).
 * `rows` = three rows of 12 legends, left to right. `thumbs` = six legends, left to right:
 * left outer, left middle, left inner (1.5u tall), right inner (1.5u tall), right middle, right outer.
 * Columns are staggered with KLE y offsets; the two inner thumb keys of each half are rotated
 * 15 and 30 degrees about their own corners with r / rx / ry so the cluster fans inwards.
 */
function split3x6(rows: [string, string, string], thumbs: string): string {
  const t = thumbs.split(" ");
  const out: Item[][] = [];
  let y = 0; // KLE's running y: offsets accumulate along a row, then each row adds 1
  rows.forEach((spec, r) => {
    const row: Item[] = [];
    legends(spec).forEach((legend, c) => {
      const stagger = c < 6 ? SPLIT_3X6_STAGGER[c] : SPLIT_3X6_STAGGER[11 - c];
      const props: Record<string, number> = {};
      const dy = r3(r + stagger - y);
      if (dy !== 0) props.y = dy;
      if (c === 6) props.x = 3;
      if (Object.keys(props).length > 0) row.push(props);
      row.push(legend);
      y = r + stagger;
    });
    out.push(row);
    y += 1;
  });
  // Outer thumb keys are not rotated; they sit half a key in from the middle-finger column.
  out.push([{ y: r3(3.4 - y), x: 3.5 }, t[0], { x: 6 }, t[5]]);
  out.push([{ r: 15, rx: 4.5, ry: 3.4 }, t[1]]);
  out.push([{ r: 30, rx: 5.98, ry: 3.33, h: 1.5 }, t[2]]);
  out.push([{ r: -15, rx: 10.5, ry: 3.4, x: -1 }, t[4]]);
  out.push([{ r: -30, rx: 9.02, ry: 3.33, x: -1, h: 1.5 }, t[3]]);
  return kle(out);
}

const SPLIT_THUMBS = "Ctrl Space Lower Raise Enter Alt";
const QWERTY_SPLIT = split3x6(
  ["Tab Q W E R T Y U I O P Bksp", "Esc A S D F G H J K L :; \"'", "Shift Z X C V B N M <, >. ?/ Shift"],
  SPLIT_THUMBS,
);
const COLEMAK_DH_SPLIT = split3x6(
  ["Tab Q W F P B J L U Y :; Bksp", "Esc A R S T G M N E I O \"'", "Shift Z X C D V K H <, >. ?/ Shift"],
  SPLIT_THUMBS,
);

// ---------------------------------------------------------------------------
// More split boards. These are generated from key positions in key units (centre of each
// key, rotation about that centre) and serialised to the same KLE raw data a hand-written
// layout would have: one `{r,rx,ry}` origin per rotated key or rotated half, `x`/`y` offsets
// for stagger. Only the left half is described; the right half is its mirror image.
// ---------------------------------------------------------------------------

/** A key as KLE sees it: top-left corner (x, y) in the frame of its rotation origin (rx, ry). */
interface PKey {
  l: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  rx?: number;
  ry?: number;
  /** Keys sharing a row id (and origin) are written on one KLE row. */
  row?: number;
}

/** Legend tokens: "!1" style two-character tokens are shifted+base pairs, longer names stay whole. */
function lg(tok: string): string {
  return tok.length === 2 && !/^[A-Za-z]{2}$/.test(tok) ? `${tok[0]}\n${tok[1]}` : tok;
}
const toks = (spec: string) => spec.split(" ").map(lg);

function kleKeys(keys: PKey[]): string {
  const groups: PKey[][] = [];
  const byId = new Map<string, PKey[]>();
  keys.forEach((k, i) => {
    const id = `${k.r ?? 0}|${k.rx ?? 0}|${k.ry ?? 0}|${k.row === undefined ? "k" + i : k.row}`;
    let g = byId.get(id);
    if (!g) groups.push((g = []));
    byId.set(id, g);
    g.push(k);
  });
  // Unrotated rows first, top to bottom, then rotated keys / halves in the order given.
  const flat = groups.filter((g) => !g[0].r);
  const rotated = groups.filter((g) => !!g[0].r);
  flat.sort((a, b) => (a[0].row ?? 99) - (b[0].row ?? 99) || a[0].y - b[0].y);
  const out: Item[][] = [];
  let cr = 0;
  let crx = 0;
  let cry = 0;
  let cx = 0;
  let cy = 0;
  for (const g of [...flat, ...rotated]) {
    const o = { r: g[0].r ?? 0, rx: g[0].rx ?? 0, ry: g[0].ry ?? 0 };
    const row: Item[] = [];
    let first: Record<string, number> = {};
    if (o.r !== cr || o.rx !== crx || o.ry !== cry) {
      first = { r: o.r, rx: r3(o.rx), ry: r3(o.ry) };
      [cr, crx, cry] = [o.r, o.rx, o.ry];
      cx = o.rx;
      cy = o.ry;
    } else cx = o.rx;
    for (const k of g.slice().sort((a, b) => a.x - b.x)) {
      const props: Record<string, number> = { ...first };
      first = {};
      const dy = r3(k.y - cy);
      const dx = r3(k.x - cx);
      if (dy) props.y = dy;
      if (dx) props.x = dx;
      if (k.w && k.w !== 1) props.w = k.w;
      if (k.h && k.h !== 1) props.h = k.h;
      if (Object.keys(props).length) row.push(props);
      row.push(k.l);
      cx += dx + (k.w ?? 1);
      cy += dy;
    }
    out.push(row);
    cy += 1;
    cx = crx;
  }
  return kle(out);
}

/** A key of the left half (centre cx, cy) with the legend its mirror image on the right half carries. */
interface HalfKey {
  l: string;
  rl: string;
  cx: number;
  cy: number;
  w?: number;
  h?: number;
  /** Degrees clockwise on the left half; the right half gets the opposite angle. */
  r?: number;
  row?: number;
}

/**
 * Two mirrored halves `width` units wide in total. Keys with a row id are written together on
 * a KLE row; rotated keys turn about their own centre.
 */
function mirrored(width: number, items: HalfKey[]): string {
  const make = (it: HalfKey, right: boolean): PKey => {
    const w = it.w ?? 1;
    const h = it.h ?? 1;
    const cx = right ? width - it.cx : it.cx;
    const r = it.r ? (right ? -it.r : it.r) : 0;
    const k: PKey = { l: right ? it.rl : it.l, x: r3(cx - w / 2), y: r3(it.cy - h / 2), w, h };
    if (r) {
      k.r = r;
      k.rx = r3(cx);
      k.ry = r3(it.cy);
    } else if (it.row !== undefined) k.row = it.row;
    return k;
  };
  return kleKeys([...items.map((i) => make(i, false)), ...items.map((i) => make(i, true))]);
}

/**
 * The finger block of a half: rows of `n` legends per half, column `i` (counted from the
 * outside) sitting `stagger[i]` below the top of the row. `left` / `right` hold one
 * space-separated string per row, each listing the half's legends left to right.
 */
function fingerBlock(stagger: number[], left: string[], right: string[], firstRow = 0): HalfKey[] {
  const n = stagger.length;
  const out: HalfKey[] = [];
  left.forEach((spec, r) => {
    const l = toks(spec);
    const rr = toks(right[r]);
    l.forEach((legend, c) => {
      out.push({ l: legend, rl: rr[n - 1 - c], cx: c + 0.5, cy: r + 0.5 + stagger[c], row: firstRow + r });
    });
  });
  return out;
}

const THUMB = (l: string, rl: string, cx: number, cy: number, r = 0, h = 1, w = 1): HalfKey => ({ l, rl, cx, cy, r, h, w });

/**
 * A fan of thumb keys on the left half: key i is turned `angles[i]` degrees clockwise and the
 * keys are spaced `pitch` apart along the path they trace, starting at (x, y). `left` / `right`
 * list legends outer to inner; the last `tall` keys are 1.5u tall.
 */
function thumbFan(x: number, y: number, angles: number[], pitch: number, left: string, right: string, tall = 0): HalfKey[] {
  const l = left.split(" ");
  const rl = right.split(" ");
  const out: HalfKey[] = [];
  let px = x;
  let py = y;
  angles.forEach((a, i) => {
    if (i > 0) {
      const dir = (((angles[i - 1] + a) / 2) * Math.PI) / 180;
      px += pitch * Math.cos(dir);
      py += pitch * Math.sin(dir);
    }
    out.push(THUMB(l[i], rl[i], r3(px), r3(py), a, i >= angles.length - tall ? 1.5 : 1));
  });
  return out;
}

/** Both halves rotated as a whole (Atreus-style): `angle` degrees on the left, mirrored on the right. */
function tiltedHalves(mid: number, pivot: { x: number; y: number }, angle: number, items: HalfKey[]): string {
  const keys: PKey[] = [];
  for (const right of [false, true]) {
    for (const it of items) {
      const w = it.w ?? 1;
      const h = it.h ?? 1;
      const cx = right ? 2 * mid - it.cx : it.cx;
      keys.push({
        l: right ? it.rl : it.l,
        x: r3(cx - w / 2),
        y: r3(it.cy - h / 2),
        w,
        h,
        r: right ? -angle : angle,
        rx: r3(right ? 2 * mid - pivot.x : pivot.x),
        ry: pivot.y,
        row: it.row,
      });
    }
  }
  return kleKeys(keys);
}

const S6 = SPLIT_3X6_STAGGER;

// Corne 3x5+3: the 42-key Corne without its outer columns (36 keys), same thumb fan.
function corne36(left: string[], right: string[]): string {
  return mirrored(13, [
    ...fingerBlock(S6.slice(1), left, right),
    THUMB("Ctrl", "Alt", 3.0, 3.9),
    THUMB("Space", "Enter", 4.15, 4.1, 15),
    THUMB("Lower", "Raise", 5.35, 4.4, 30, 1.5),
  ]);
}
const CORNE_35_QWERTY = corne36(["Q W E R T", "A S D F G", "Z X C V B"], ["Y U I O P", "H J K L :;", "N M <, >. ?/"]);
const CORNE_35_COLEMAK_DH = corne36(["Q W F P B", "A R S T G", "Z X C D V"], ["J L U Y :;", "M N E I O", "K H <, >. ?/"]);
const BSP = "Bksp";

// Ferris Sweep: 3x5 + two thumbs, flat unrotated thumbs hanging a little below the index columns.
function ferris(left: string[], right: string[]): string {
  const stagger = [0.25, 0.125, 0, 0.125, 0.25];
  return mirrored(13, [
    ...fingerBlock(stagger, left, right),
    THUMB("Lower", "Raise", 3.55, 3.95),
    THUMB("Space", "Enter", 4.65, 4.05),
  ]);
}
const FERRIS_QWERTY = ferris(["Q W E R T", "A S D F G", "Z X C V B"], ["Y U I O P", "H J K L :;", "N M <, >. ?/"]);
const FERRIS_COLEMAK_DH = ferris(["Q W F P B", "A R S T G", "Z X C D V"], ["J L U Y :;", "M N E I O", "K H <, >. ?/"]);

// Atreus: 3x5 + a six-key bottom row per half (inner three are the thumbs) + one outer home-row key,
// each half tilted 10 degrees about its middle so the two meet at the top and open towards the bottom.
const ATREUS = (() => {
  const stagger = [0.25, 0.125, 0, 0.125, 0.25];
  const items = fingerBlock(
    stagger,
    ["Q W E R T", "A S D F G", "Z X C V B"],
    ["Y U I O P", "H J K L :;", "N M <, >. ?/"],
  );
  const bottomL = ["Esc", "Tab", "Super", "Shift", BSP, "Ctrl"];
  const bottomR = ["Enter", "\"'", "_-", "Fn", "Space", "Alt"]; // outer → inner
  bottomL.forEach((l, c) => {
    const rl = bottomR[c];
    items.push({ l, rl: lg(rl), cx: c + 0.5, cy: 3.5 + (c < 5 ? stagger[c] : 0.375), row: 3 });
  });
  items.push({ l: "Caps Lock", rl: "Menu", cx: -0.5, cy: 1.5 + 0.375, row: 1 });
  return tiltedHalves(5.95, { x: 2.5, y: 2.2 }, 10, items);
})();

const NUM_L = "Esc !1 @2 #3 $4 %5";
const ROWS_L = ["Tab Q W E R T", "Ctrl A S D F G", "Shift Z X C V B"];
const ROWS_R = ["Y U I O P Bksp", "H J K L :; \"'", "N M <, >. ?/ Shift"];

// Lily58: number row + 3x6 per half (an extra inner key on the bottom row) and a four-key thumb arc.
const LILY58 = mirrored(15, [
  ...fingerBlock(S6, [NUM_L, ...ROWS_L], ["^6 &7 *8 (9 )0 ~`", ...ROWS_R]),
  { l: lg("{["), rl: lg("}]"), cx: 6.5, cy: 3.75, row: 3 },
  ...thumbFan(3.1, 4.8, [0, 8, 16, 24], 1.12, "Alt Win Lower Space", "Alt Win Raise Enter"),
]);

// Sofle: the same 4x6 block, five thumb keys per half fanning inwards (inner one 1.5u tall).
const SOFLE = mirrored(15, [
  ...fingerBlock(S6, [NUM_L, ...ROWS_L], ["^6 &7 *8 (9 )0 ~`", ...ROWS_R]),
  ...thumbFan(2.2, 4.95, [0, 0, 8, 18, 30], 1.1, "Win Alt Ctrl Lower Space", "Win Alt Del Raise Enter", 1),
]);

// Kyria: 3x6 + two extra inner keys per half and a five-key thumb arc.
const KYRIA = mirrored(16, [
  ...fingerBlock(
    S6,
    ["Tab Q W E R T", "Esc A S D F G", "Shift Z X C V B"],
    ["Y U I O P Bksp", "H J K L :; \"'", "N M <, >. ?/ Shift"],
  ),
  { l: lg("{["), rl: lg("}]"), cx: 6.5, cy: 1.75, row: 1 },
  { l: "Ctrl", rl: "Ctrl", cx: 6.5, cy: 2.75, row: 2 },
  ...thumbFan(2.8, 4.0, [0, 7, 14, 22, 30], 1.1, "Win Alt Space Lower Del", "Win Alt Enter Raise Menu"),
]);

// Iris: 4x6 per half and a four-key thumb cluster, the two inner keys 1.5u tall.
const IRIS = mirrored(15, [
  ...fingerBlock(S6, [NUM_L, ...ROWS_L], ["^6 &7 *8 (9 )0 _-", ...ROWS_R]),
  ...thumbFan(3.2, 4.8, [4, 12, 22, 32], 1.12, "Win Alt Lower Space", "Win Alt Raise Enter", 2),
]);

// Moonlander: 5 rows per half (number row, three letter rows, a short bottom row), a 7th inner
// column on the top three rows, and a thumb cluster of four keys (Space, Lower, Alt and the red
// one) turned 20 degrees as a block.
const MOONLANDER = (() => {
  const items: HalfKey[] = [
    ...fingerBlock(
      S6,
      ["+= !1 @2 #3 $4 %5", "Tab Q W E R T", "Bksp A S D F G", "Shift Z X C V B"],
      ["^6 &7 *8 (9 )0 _-", "Y U I O P Del", "H J K L :; \"'", "N M <, >. ?/ Shift"],
    ),
    { l: "Esc", rl: "Menu", cx: 6.5, cy: 0.75, row: 0 },
    { l: lg("{["), rl: lg("}]"), cx: 6.5, cy: 1.75, row: 1 },
    { l: "Hyper", rl: "Meh", cx: 6.5, cy: 2.75, row: 2 },
  ];
  const bottomL = ["Ctrl", lg("~`"), "Win", "←", "→"];
  const bottomR = ["Ctrl", "Fn", "Win", "↓", "↑"]; // outer → inner
  bottomL.forEach((l, c) => items.push({ l, rl: bottomR[c], cx: c + 0.5, cy: 4.5 + S6[c], row: 4 }));
  const angle = 20;
  const [sin, cos] = [Math.sin((angle * Math.PI) / 180), Math.cos((angle * Math.PI) / 180)];
  const place = (l: string, rl: string, dx: number, dy: number) =>
    THUMB(l, rl, r3(6 + dx * cos - dy * sin), r3(5.75 + dx * sin + dy * cos), angle);
  items.push(place("Space", "Enter", -0.55, -0.5), place("Lower", "Raise", 0.55, -0.5), place("Alt", "Alt", -0.55, 0.55), place("Red", "Red", 0.55, 0.55));
  return mirrored(17.5, items);
})();

// 76-key split with a number row, an extra inner column and six-key thumb clusters rotated
// 30 degrees (ErgoDox-style geometry). Written the way keyboard-layout-editor.com exports
// columnar boards: one KLE row per pair of columns, stepping back up with negative y.
const QWERTY_SPLIT_76 = `[{x:3.5},"#\\n3",{x:10.5},"*\\n8"],
[{y:-0.875,x:2.5},"@\\n2",{x:1},"$\\n4",{x:8.5},"&\\n7",{x:1},"(\\n9"],
[{y:-0.875,x:5.5},"%\\n5","Lower",{x:4.5},"Raise","^\\n6"],
[{y:-0.875,w:1.5},"+\\n=","!\\n1",{x:14.5},")\\n0",{w:1.5},"_\\n-"],
[{y:-0.375,x:3.5},"E",{x:10.5},"I"],
[{y:-0.875,x:2.5},"W",{x:1},"R",{x:8.5},"U",{x:1},"O"],
[{y:-0.875,x:5.5},"T",{h:1.5},"{\\n[",{x:4.5,h:1.5},"}\\n]","Y"],
[{y:-0.875,w:1.5},"Tab","Q",{x:14.5},"P",{w:1.5},"|\\n\\\\"],
[{y:-0.375,x:3.5},"D",{x:10.5},"K"],
[{y:-0.875,x:2.5},"S",{x:1},"F",{x:8.5},"J",{x:1},"L"],
[{y:-0.875,x:5.5},"G",{x:6.5},"H"],
[{y:-0.875,w:1.5},"Esc","A",{x:14.5},":\\n;",{w:1.5},"\\"\\n'"],
[{y:-0.625,x:6.5,h:1.5},"Hyper",{x:4.5,h:1.5},"Meh"],
[{y:-0.75,x:3.5},"C",{x:10.5},"<\\n,"],
[{y:-0.875,x:2.5},"X",{x:1},"V",{x:8.5},"M",{x:1},">\\n."],
[{y:-0.875,x:5.5},"B",{x:6.5},"N"],
[{y:-0.875,w:1.5},"Shift","Z",{x:14.5},"?\\n/",{w:1.5},"Shift"],
[{y:-0.375,x:3.5},"←",{x:10.5},"↑"],
[{y:-0.875,x:2.5},"Alt",{x:1},"→",{x:8.5},"↓",{x:1},"Alt"],
[{y:-0.75,x:0.5},"Ctrl","~\\n\`",{x:14.5},"Fn","Ctrl"],
[{r:30,rx:6.5,ry:4.25,y:-1,x:1},"Menu","Win"],
[{h:2},"Bksp",{h:2},"Del","Home"],
[{x:2},"End"],
[{r:-30,rx:13,y:-1,x:-3},"Win","Ins"],
[{x:-3},"PgUp",{h:2},"Enter",{h:2},"Space"],
[{x:-3},"PgDn"]`;

export const PRESETS: LayoutPreset[] = [
  {
    id: "qwerty",
    name: "QWERTY",
    description: "The standard layout. Useful as a baseline or to build proper touch-typing habits.",
    family: "ansi-60",
    source: QWERTY_60,
  },
  {
    id: "dvorak",
    name: "Dvorak",
    description: "Vowels on the left home row, common consonants on the right; strong hand alternation.",
    family: "ansi-60",
    source: DVORAK_60,
  },
  {
    id: "colemak",
    name: "Colemak",
    description: "Keeps most QWERTY shortcuts (Z X C V) while moving the commonest letters to the home row.",
    family: "ansi-60",
    source: COLEMAK_60,
  },
  {
    id: "colemak-dh",
    name: "Colemak-DH",
    description: "Colemak with D and H moved off the centre column to reduce lateral index stretches (ANSI variant).",
    family: "ansi-60",
    source: COLEMAK_DH_60,
  },
  {
    id: "workman",
    name: "Workman",
    description: "Optimised for low finger travel, favouring natural up/down reaches over sideways ones.",
    family: "ansi-60",
    source: WORKMAN_60,
  },
  {
    id: "qwerty-100",
    name: "QWERTY (full size)",
    description: "ANSI 104-key board with function row, navigation cluster and numpad.",
    family: "ansi-100",
    source: QWERTY_100,
  },
  {
    id: "qwerty-ortho",
    name: "QWERTY (ortholinear)",
    description: "Planck-style 4×12 grid with a 2u space bar; keys sit in straight columns.",
    family: "ortho",
    source: QWERTY_ORTHO,
  },
  {
    id: "ferris-sweep",
    name: "Ferris Sweep (QWERTY)",
    description: "34-key 3×5 split with two thumb keys per half: only the letters, Space/Enter and two layer keys.",
    family: "split",
    source: FERRIS_QWERTY,
  },
  {
    id: "ferris-sweep-colemak-dh",
    name: "Ferris Sweep (Colemak-DH)",
    description: "The Ferris Sweep with Colemak-DH, the layout it is most often built for: 34 keys, thumbs on Space and Enter.",
    family: "split",
    source: FERRIS_COLEMAK_DH,
  },
  {
    id: "corne-36",
    name: "Corne 3×5 (QWERTY)",
    description: "The 36-key Corne (crkbd): 3×5 columnar halves with three rotated thumb keys each, no outer columns.",
    family: "split",
    source: CORNE_35_QWERTY,
  },
  {
    id: "corne-36-colemak-dh",
    name: "Corne 3×5 (Colemak-DH)",
    description: "36-key Corne with Colemak-DH on the 3×5 letter block.",
    family: "split",
    source: CORNE_35_COLEMAK_DH,
  },
  {
    id: "qwerty-split",
    name: "Corne (QWERTY)",
    description: "Corne (crkbd) 3×6+3, 42 keys: staggered columns, an outer column each side and three thumb keys fanned inwards. Space and Enter live on the thumbs.",
    family: "split",
    source: QWERTY_SPLIT,
  },
  {
    id: "colemak-dh-split",
    name: "Corne (Colemak-DH)",
    description: "Colemak-DH on the 42-key Corne, as it was designed to be used: D and H sit under the index fingers' easy inward curl.",
    family: "split",
    source: COLEMAK_DH_SPLIT,
  },
  {
    id: "atreus",
    name: "Atreus",
    description: "44-key Atreus: two 3×5 halves tilted 10° towards each other with no gap, and the inner three keys of the bottom row on the thumbs.",
    family: "split",
    source: ATREUS,
  },
  {
    id: "kyria",
    name: "Kyria",
    description: "50-key Kyria: 3×6 halves with two extra inner keys and a five-key thumb arc each.",
    family: "split",
    source: KYRIA,
  },
  {
    id: "iris",
    name: "Iris",
    description: "56-key Iris: number row, 3×6 letter block and a four-key thumb cluster per half.",
    family: "split",
    source: IRIS,
  },
  {
    id: "lily58",
    name: "Lily58",
    description: "58-key Lily58: number row, 3×6 letters, an extra inner key on the bottom row and four thumb keys per half.",
    family: "split",
    source: LILY58,
  },
  {
    id: "sofle",
    name: "Sofle",
    description: "58-key Sofle: number row, 3×6 letters and a five-key thumb fan per half (encoders not modelled).",
    family: "split",
    source: SOFLE,
  },
  {
    id: "moonlander",
    name: "Moonlander",
    description: "72-key ZSA Moonlander: five rows, an inner column, and a four-key thumb cluster (Space, Lower, Alt and the red key) per half.",
    family: "split",
    source: MOONLANDER,
  },
  {
    id: "qwerty-split-76",
    name: "ErgoDox (QWERTY)",
    description: "ErgoDox-style 76-key split with a number row, extra inner columns and six-key thumb clusters angled at 30°.",
    family: "split",
    source: QWERTY_SPLIT_76,
  },
];

export const DEFAULT_PRESET_ID = "qwerty";

export function getPreset(id: string): LayoutPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
