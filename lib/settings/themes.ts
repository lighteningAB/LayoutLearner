// Theme metadata. The actual colour tokens live in app/globals.css under
// `[data-theme="<id>"]`; any element can carry data-theme to scope a preview.

export type ThemeScheme = "dark" | "light";

export interface ThemeMeta {
  id: string;
  name: string;
  scheme: ThemeScheme;
  description: string;
}

export const THEMES = [
  { id: "blueprint", name: "Blueprint", scheme: "dark", description: "Cyanotype sheet, chalk linework, safety-yellow action" },
  { id: "whiteprint", name: "Whiteprint", scheme: "light", description: "Drafting paper, blue ink, red-pencil action" },
] as const satisfies readonly ThemeMeta[];

export type ThemeId = (typeof THEMES)[number]["id"];

/** The dark sheet: the default, and the theme when the OS prefers dark. */
export const DEFAULT_THEME: ThemeId = "blueprint";
/** The light sheet: the theme when the OS prefers light. */
export const LIGHT_DEFAULT_THEME: ThemeId = "whiteprint";

export const THEME_IDS: readonly ThemeId[] = THEMES.map((t) => t.id);

/**
 * Ids of themes that no longer exist, and the theme each one becomes. A browser (or a synced
 * account) that still holds one of these is moved over silently, keeping its light / dark choice.
 */
export const LEGACY_THEME_IDS: Readonly<Record<string, ThemeId>> = {
  tide: "blueprint",
  dusk: "blueprint",
  moss: "blueprint",
  ember: "blueprint",
  paper: "whiteprint",
  glacier: "whiteprint",
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/** A current theme id for `value`: itself, the successor of a retired id, or null when it is neither. */
export function normalizeThemeId(value: unknown): ThemeId | null {
  if (isThemeId(value)) return value;
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_THEME_IDS, value)) {
    return LEGACY_THEME_IDS[value];
  }
  return null;
}

export function getTheme(id: string): (typeof THEMES)[number] {
  const current = normalizeThemeId(id);
  return THEMES.find((t) => t.id === current) ?? THEMES[0];
}

export const SETTINGS_KEY = "ll:v1:settings";
export const STORAGE_PREFIX = "ll:v1:";

/**
 * Theme for a visitor who has not picked one: follows the OS light/dark
 * setting (Whiteprint or Blueprint). On the server, and where matchMedia is
 * missing, it is DEFAULT_THEME.
 */
export function systemDefaultTheme(): ThemeId {
  try {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
      return LIGHT_DEFAULT_THEME;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_THEME;
}

/**
 * Inline <head> script: applies the persisted theme to <html data-theme> before
 * first paint, so there is no flash of the default theme on reload. Retired ids
 * are mapped to their successor; anything else falls back to the OS default.
 */
export const themeInitScript = `(function(){var d=document.documentElement,t=${JSON.stringify(
  DEFAULT_THEME,
)};try{if(window.matchMedia("(prefers-color-scheme: light)").matches)t=${JSON.stringify(
  LIGHT_DEFAULT_THEME,
)}}catch(e){}try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  SETTINGS_KEY,
)})||"{}"),v=s&&s.theme,m=${JSON.stringify(LEGACY_THEME_IDS)};if(typeof v==="string"){if(${JSON.stringify(
  THEME_IDS,
)}.indexOf(v)>-1)t=v;else if(Object.prototype.hasOwnProperty.call(m,v))t=m[v]}}catch(e){}d.setAttribute("data-theme",t)})();`;
