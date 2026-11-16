/**
 * Keycode tables for QMK and ZMK, mapped to what a US-layout host receives.
 * Shifted aliases (KC_EXLM, &kp EXCL) have base = the symbol and shifted = "".
 */

export interface KeyDef {
  kind: "char" | "modifier" | "other";
  base: string;
  shifted: string;
  label: string;
}

export type SpecialCategory =
  | "mouse" | "media" | "rgb" | "bluetooth" | "macro" | "tapdance" | "boot";

function labelFor(base: string): string {
  if (base === " ") return "Spc";
  return base.length === 1 ? base.toUpperCase() : base;
}

// [qmk names (without KC_), zmk names, base, shifted]
const CHAR_ROWS: [string[], string[], string, string][] = [
  [["SPC", "SPACE"], ["SPACE"], " ", " "],
  [["MINS", "MINUS"], ["MINUS"], "-", "_"],
  [["EQL", "EQUAL"], ["EQUAL"], "=", "+"],
  [["LBRC", "LBRACKET"], ["LBKT", "LEFT_BRACKET"], "[", "{"],
  [["RBRC", "RBRACKET"], ["RBKT", "RIGHT_BRACKET"], "]", "}"],
  [["BSLS", "BSLASH", "BACKSLASH"], ["BSLH", "BACKSLASH"], "\\", "|"],
  [["NUHS", "NONUS_HASH"], ["NUHS", "NON_US_HASH"], "#", "~"],
  [["NUBS", "NONUS_BSLASH"], ["NUBS", "NON_US_BACKSLASH"], "\\", "|"],
  [["SCLN", "SCOLON", "SEMICOLON"], ["SEMI", "SEMICOLON"], ";", ":"],
  [["QUOT", "QUOTE"], ["SQT", "APOS", "APOSTROPHE", "SINGLE_QUOTE"], "'", '"'],
  [["GRV", "GRAVE"], ["GRAVE"], "`", "~"],
  [["COMM", "COMMA"], ["COMMA"], ",", "<"],
  [["DOT"], ["DOT", "PERIOD"], ".", ">"],
  [["SLSH", "SLASH"], ["FSLH", "SLASH"], "/", "?"],
  // Shifted symbols as their own keys
  [["EXLM", "EXCLAIM"], ["EXCL", "EXCLAMATION"], "!", ""],
  [["AT"], ["AT", "AT_SIGN"], "@", ""],
  [["HASH"], ["HASH", "POUND"], "#", ""],
  [["DLR", "DOLLAR"], ["DLLR", "DOLLAR"], "$", ""],
  [["PERC", "PERCENT"], ["PRCNT", "PERCENT"], "%", ""],
  [["CIRC", "CIRCUMFLEX"], ["CARET"], "^", ""],
  [["AMPR", "AMPERSAND"], ["AMPS", "AMPERSAND"], "&", ""],
  [["ASTR", "ASTERISK"], ["STAR", "ASTRK", "ASTERISK"], "*", ""],
  [["LPRN", "LEFT_PAREN"], ["LPAR", "LEFT_PARENTHESIS"], "(", ""],
  [["RPRN", "RIGHT_PAREN"], ["RPAR", "RIGHT_PARENTHESIS"], ")", ""],
  [["UNDS", "UNDERSCORE"], ["UNDER", "UNDERSCORE"], "_", ""],
  [["PLUS"], ["PLUS"], "+", ""],
  [["LCBR", "LEFT_CURLY_BRACE"], ["LBRC", "LEFT_BRACE"], "{", ""],
  [["RCBR", "RIGHT_CURLY_BRACE"], ["RBRC", "RIGHT_BRACE"], "}", ""],
  [["PIPE"], ["PIPE"], "|", ""],
  [["COLN", "COLON"], ["COLON"], ":", ""],
  [["DQUO", "DOUBLE_QUOTE", "DQT"], ["DQT", "DOUBLE_QUOTES"], '"', ""],
  [["TILD", "TILDE"], ["TILDE"], "~", ""],
  [["LABK", "LEFT_ANGLE_BRACKET", "LT"], ["LT", "LESS_THAN"], "<", ""],
  [["RABK", "RIGHT_ANGLE_BRACKET", "GT"], ["GT", "GREATER_THAN"], ">", ""],
  [["QUES", "QUESTION"], ["QMARK", "QUESTION"], "?", ""],
  // Keypad
  [["PPLS", "KP_PLUS"], ["KP_PLUS"], "+", ""],
  [["PMNS", "KP_MINUS"], ["KP_MINUS"], "-", ""],
  [["PAST", "KP_ASTERISK"], ["KP_MULTIPLY", "KP_ASTERISK"], "*", ""],
  [["PSLS", "KP_SLASH"], ["KP_DIVIDE", "KP_SLASH"], "/", ""],
  [["PDOT", "KP_DOT"], ["KP_DOT"], ".", ""],
  [["PEQL", "KP_EQUAL"], ["KP_EQUAL"], "=", ""],
];

// [qmk names, zmk names, label]
const NONPRINT_ROWS: [string[], string[], string][] = [
  [["ENT", "ENTER", "PENT", "KP_ENTER"], ["RET", "RETURN", "ENTER", "KP_ENTER"], "Enter"],
  [["ESC", "ESCAPE"], ["ESC", "ESCAPE"], "Esc"],
  [["BSPC", "BSPACE"], ["BSPC", "BACKSPACE"], "Bksp"],
  [["TAB"], ["TAB"], "Tab"],
  [["DEL", "DELETE"], ["DEL", "DELETE"], "Del"],
  [["INS", "INSERT"], ["INS", "INSERT"], "Ins"],
  [["HOME"], ["HOME"], "Home"],
  [["END"], ["END"], "End"],
  [["PGUP"], ["PG_UP", "PAGE_UP"], "PgUp"],
  [["PGDN"], ["PG_DN", "PAGE_DOWN"], "PgDn"],
  [["UP"], ["UP", "UP_ARROW"], "Up"],
  [["DOWN", "DOWN"], ["DOWN", "DOWN_ARROW"], "Down"],
  [["LEFT"], ["LEFT", "LEFT_ARROW"], "Left"],
  [["RGHT", "RIGHT"], ["RIGHT", "RIGHT_ARROW"], "Right"],
  [["PSCR", "PRINT_SCREEN"], ["PSCRN", "PRINTSCREEN"], "PrtSc"],
  [["SLCK", "SCRL", "SCROLL_LOCK"], ["SLCK", "SCROLLLOCK"], "ScrLk"],
  [["PAUS", "PAUSE", "BRK"], ["PAUSE_BREAK"], "Pause"],
  [["APP", "APPLICATION"], ["K_APP", "K_APPLICATION", "K_CMENU"], "Menu"],
  [["NLCK", "NUM_LOCK", "NUM"], ["KP_NUMLOCK", "KP_NLCK"], "NumLk"],
];

// [qmk names, zmk names, label]
const MOD_ROWS: [string[], string[], string][] = [
  [["LCTL", "LCTRL"], ["LCTRL", "LCTL", "LEFT_CONTROL"], "Ctrl"],
  [["RCTL", "RCTRL"], ["RCTRL", "RCTL", "RIGHT_CONTROL"], "Ctrl"],
  [["LSFT", "LSHIFT"], ["LSHIFT", "LSHFT", "LEFT_SHIFT"], "Shift"],
  [["RSFT", "RSHIFT"], ["RSHIFT", "RSHFT", "RIGHT_SHIFT"], "Shift"],
  [["LALT", "LOPT"], ["LALT", "LEFT_ALT"], "Alt"],
  [["RALT", "ROPT", "ALGR"], ["RALT", "RIGHT_ALT"], "AltGr"],
  [["LGUI", "LCMD", "LWIN"], ["LGUI", "LWIN", "LCMD", "LEFT_GUI", "LEFT_WIN", "LEFT_COMMAND"], "Gui"],
  [["RGUI", "RCMD", "RWIN"], ["RGUI", "RWIN", "RCMD", "RIGHT_GUI", "RIGHT_WIN", "RIGHT_COMMAND"], "Gui"],
  [["CAPS", "CAPS_LOCK", "CLCK"], ["CAPS", "CLCK", "CAPSLOCK"], "Caps"],
];

const DIGIT_SHIFTED = ")!@#$%^&*(";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function build(which: 0 | 1): Map<string, KeyDef> {
  const m = new Map<string, KeyDef>();
  const addChar = (names: string[], base: string, shifted: string) => {
    const def: KeyDef = { kind: "char", base, shifted, label: labelFor(base) };
    for (const n of names) m.set(n, def);
  };
  for (const L of LETTERS) addChar([L], L.toLowerCase(), L);
  for (let d = 0; d <= 9; d++) {
    const s = String(d);
    addChar(which === 0 ? [s] : ["N" + s, "NUMBER_" + s], s, DIGIT_SHIFTED[d]);
  }
  // keypad digits do not shift to symbols
  for (let d = 0; d <= 9; d++) {
    const s = String(d);
    const names = which === 0 ? ["P" + s, "KP_" + s] : ["KP_N" + s, "KEYPAD_" + s];
    addChar(names, s, "");
  }
  for (const row of CHAR_ROWS) addChar(row[which], row[2], row[3]);
  for (const row of NONPRINT_ROWS)
    for (const n of row[which]) m.set(n, { kind: "other", base: "", shifted: "", label: row[2] });
  for (const row of MOD_ROWS)
    for (const n of row[which]) m.set(n, { kind: "modifier", base: "", shifted: "", label: row[2] });
  for (let f = 1; f <= 24; f++) m.set("F" + f, { kind: "other", base: "", shifted: "", label: "F" + f });
  return m;
}

const QMK = build(0);
const ZMK = build(1);

/** Name with or without the KC_ prefix. */
export function lookupQmkKey(name: string): KeyDef | null {
  const n = name.startsWith("KC_") ? name.slice(3) : name;
  return QMK.get(n) ?? null;
}

export function lookupZmkKey(name: string): KeyDef | null {
  return ZMK.get(name) ?? null;
}

const QMK_SPECIAL: [SpecialCategory, RegExp][] = [
  ["mouse", /^(KC_)?(MS_|BTN[0-9]|WH_|ACL[0-9]|MOUSE_|MS_BTN|QK_MOUSE)/],
  ["media", /^(KC_)?(MPLY|MNXT|MPRV|MSTP|MUTE|VOLU|VOLD|BRIU|BRID|MFFD|MRWD|MSEL|MYCM|CALC|PWR|SLEP|WAKE|EJCT|MAIL|WWW_|AUDIO_|MEDIA_|SYSTEM_|BRIGHTNESS_|QK_AUDIO|AU_|MU_|CK_|AC_)/],
  ["rgb", /^(RGB_|RM_|RGBM|UG_|BL_|QK_UNDERGLOW|QK_BACKLIGHT|QK_RGB|RGB)/],
  ["bluetooth", /^(BT_|OUT_|BLE_|QK_OUTPUT|QK_BLUETOOTH)/],
  ["macro", /^(M[0-9]+|MACRO[0-9]*|DM_|QK_MACRO|DYN_|QK_DYNAMIC_MACRO)/],
  ["tapdance", /^(TD|QK_TAP_DANCE)/],
  ["boot", /^(RESET|QK_BOOT|QK_RBT|QK_REBOOT|EE_CLR|QK_CLEAR_EEPROM|DB_|QK_DEBUG|DEBUG|BOOT|QK_MAGIC|MAGIC_|QK_LEAD|QK_KEY_OVERRIDE|KO_|QK_REPEAT_KEY|QK_ALT_REPEAT_KEY|QK_COMBO|CM_)/],
];

export function classifyQmkSpecial(name: string): SpecialCategory | null {
  for (const [cat, re] of QMK_SPECIAL) if (re.test(name)) return cat;
  return null;
}

export function classifyZmkSpecial(name: string): SpecialCategory | null {
  if (name.startsWith("C_") || name.startsWith("K_") || name.startsWith("G_")) return "media";
  return null;
}
