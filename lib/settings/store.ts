import { useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  SETTINGS_KEY,
  STORAGE_PREFIX,
  isThemeId,
  systemDefaultTheme,
  type ThemeId,
} from "./themes";
import { sanitizeLayers } from "../layout/layers";
import { sanitizeFingerOverrides, type FingerOverrides } from "../layout/overrides";
import type { LayoutLayer } from "../types";

export interface CustomLayout {
  id: string;
  name: string;
  /** Raw KLE JSON source as entered by the user. */
  source: string;
  /** Per-key finger corrections; kept out of the KLE source. */
  fingers?: FingerOverrides;
  /** Extra firmware layers (Lower / Raise …); kept out of the KLE source. */
  layers?: LayoutLayer[];
}

export type TestMode = "time" | "words";

export interface Settings {
  theme: ThemeId;
  /** Preset id or custom layout id. The layout module owns the id space. */
  layoutId: string;
  customLayouts: CustomLayout[];
  /** Remap physical keys so the chosen layout can be practised without changing the OS layout. Off by default: the app trusts the characters the OS produces. */
  emulateLayout: boolean;
  showKeyboard: boolean;
  showHands: boolean;
  fingerColors: boolean;
  testMode: TestMode;
  /** Seconds when testMode is "time", word count when "words". */
  testAmount: number;
  wordList: string;
  punctuation: boolean;
  numbers: boolean;
  soundOnError: boolean;
  smoothCaret: boolean;
  /** Typing text size in px. */
  fontSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: DEFAULT_THEME,
  layoutId: "qwerty",
  customLayouts: [],
  emulateLayout: false,
  showKeyboard: true,
  showHands: true,
  fingerColors: true,
  testMode: "time",
  testAmount: 30,
  wordList: "english200",
  punctuation: false,
  numbers: false,
  soundOnError: false,
  smoothCaret: true,
  fontSize: 24,
};

export const FONT_SIZE_MIN = 16;
export const FONT_SIZE_MAX = 40;
export const TIME_AMOUNTS = [15, 30, 60, 120] as const;
export const WORD_AMOUNTS = [10, 25, 50, 100] as const;

export type SettingsPatch = Partial<Settings> | ((prev: Settings) => Partial<Settings>);

/** Fired on window after clearAllData(), so other ll:v1:* stores can reset their in-memory state. */
export const DATA_CLEARED_EVENT = "ll:data-cleared";

const isBrowser = typeof window !== "undefined";
const listeners = new Set<() => void>();
let state: Settings | null = null;

/** Defaults for this browser: DEFAULT_SETTINGS, with the theme following the OS light/dark setting. */
function initialSettings(): Settings {
  return { ...DEFAULT_SETTINGS, theme: systemDefaultTheme() };
}

function sanitize(raw: unknown): Settings {
  const out: Settings = initialSettings();
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = src[key];
    if (v === undefined || v === null) continue;
    if (key === "customLayouts") {
      if (Array.isArray(v)) {
        out.customLayouts = v
          .filter(
            (l): l is CustomLayout =>
              !!l &&
              typeof l.id === "string" &&
              typeof l.name === "string" &&
              typeof l.source === "string",
          )
          .map((l) => {
            const { fingers: rawFingers, layers: rawLayers, ...rest } = l;
            const fingers = sanitizeFingerOverrides(rawFingers);
            const layers = sanitizeLayers(rawLayers);
            return { ...rest, ...(fingers ? { fingers } : {}), ...(layers ? { layers } : {}) };
          });
      }
    } else if (key === "theme") {
      if (isThemeId(v)) out.theme = v;
    } else if (key === "testMode") {
      if (v === "time" || v === "words") out.testMode = v;
    } else if (typeof v === typeof DEFAULT_SETTINGS[key]) {
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  out.fontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(out.fontSize)));
  if (out.testAmount <= 0) out.testAmount = DEFAULT_SETTINGS.testAmount;
  return out;
}

/** Statistics used to be stored here; the feature is gone, so drop what it left behind. */
const OBSOLETE_KEYS = ["results", "keystats", "bests", "activity", "demo"].map((k) => `${STORAGE_PREFIX}${k}`);

function removeObsoleteData() {
  try {
    for (const key of OBSOLETE_KEYS) window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable: nothing to clean */
  }
}

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch {
    return initialSettings();
  }
}

function persist(next: Settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota: settings stay in memory for this tab */
  }
}

function emit() {
  for (const l of listeners) l();
}

function applyTheme(theme: ThemeId, animate = false) {
  if (!isBrowser) return;
  const el = document.documentElement;
  if (el.getAttribute("data-theme") === theme) return;
  if (animate) {
    el.classList.add("ll-theme-transition");
    window.setTimeout(() => el.classList.remove("ll-theme-transition"), 220);
  }
  el.setAttribute("data-theme", theme);
}

/** Current settings (defaults on the server). */
export function getSettings(): Settings {
  if (!isBrowser) return DEFAULT_SETTINGS;
  if (!state) {
    removeObsoleteData();
    state = load();
  }
  return state;
}

/** Merge a patch into settings, persist to localStorage and notify subscribers. */
export function updateSettings(patch: SettingsPatch): Settings {
  if (!isBrowser) return DEFAULT_SETTINGS;
  const prev = getSettings();
  const delta = typeof patch === "function" ? patch(prev) : patch;
  const next = sanitize({ ...prev, ...delta });
  state = next;
  persist(next);
  applyTheme(next.theme, true);
  emit();
  return next;
}

/** Restore default settings (keeps other ll:v1:* data such as lesson progress). */
export function resetSettings(): Settings {
  return updateSettings(initialSettings());
}

/** Remove every localStorage key under the ll:v1: prefix and reset settings in memory. */
export function clearAllData(): void {
  if (!isBrowser) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  state = initialSettings();
  applyTheme(state.theme, true);
  emit();
  window.dispatchEvent(new CustomEvent(DATA_CLEARED_EVENT));
}

/**
 * Temporarily show a theme without persisting it (command palette live preview).
 * Pass null to go back to the saved theme.
 */
export function previewTheme(theme: ThemeId | null): void {
  applyTheme(theme ?? getSettings().theme);
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && isBrowser) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && isBrowser) window.removeEventListener("storage", onStorage);
  };
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== SETTINGS_KEY) return;
  state = load();
  applyTheme(state.theme);
  emit();
}

const getServerSnapshot = () => DEFAULT_SETTINGS;

/**
 * React binding. Returns defaults during SSR/hydration, then the persisted values.
 *
 *   const [settings, update] = useSettings();
 *   update({ showHands: false });
 */
export function useSettings(): [Settings, (patch: SettingsPatch) => void] {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getServerSnapshot);
  return [settings, updateSettings];
}

/** Word list ids offered in settings. The typing module owns the actual lists. */
export const WORD_LISTS = [
  { id: "english200", name: "English 200" },
  { id: "english1k", name: "English 1k" },
  { id: "code", name: "Code" },
] as const;
