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
  { id: "tide", name: "Tide", scheme: "dark", description: "Deep slate with a sea-glass accent" },
  { id: "paper", name: "Paper", scheme: "light", description: "Warm paper and fountain-pen blue" },
  { id: "dusk", name: "Dusk", scheme: "dark", description: "Violet night with a pink caret" },
  { id: "moss", name: "Moss", scheme: "dark", description: "Forest floor and lichen green" },
  { id: "ember", name: "Ember", scheme: "dark", description: "Charcoal warmed by orange coals" },
  { id: "glacier", name: "Glacier", scheme: "light", description: "Cool daylight and deep teal" },
] as const satisfies readonly ThemeMeta[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "tide";

export const THEME_IDS: readonly ThemeId[] = THEMES.map((t) => t.id);

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function getTheme(id: string): (typeof THEMES)[number] {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export const SETTINGS_KEY = "ll:v1:settings";
export const STORAGE_PREFIX = "ll:v1:";

/**
 * Inline <head> script: applies the persisted theme to <html data-theme> before
 * first paint, so there is no flash of the default theme on reload.
 */
export const themeInitScript = `(function(){var d=document.documentElement,t=${JSON.stringify(
  DEFAULT_THEME,
)};try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  SETTINGS_KEY,
)})||"{}");if(s&&${JSON.stringify(THEME_IDS)}.indexOf(s.theme)>-1)t=s.theme}catch(e){}d.setAttribute("data-theme",t)})();`;
