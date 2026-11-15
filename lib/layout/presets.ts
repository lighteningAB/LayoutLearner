// Built-in layouts, stored as keyboard-layout-editor.com raw data (the same format
// users paste for custom layouts). Parse with parseLayout() from ./parse.

export type LayoutFamily = "ansi-60" | "ansi-100" | "ortho";

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
];

export const DEFAULT_PRESET_ID = "qwerty";

export function getPreset(id: string): LayoutPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}
