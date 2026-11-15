// Reads the design tokens (CSS custom properties on <html>) into three.js
// colours, and notifies when the theme changes.

import * as THREE from "three";

export interface HandsTheme {
  bg: THREE.Color;
  bgAlt: THREE.Color;
  border: THREE.Color;
  text: THREE.Color;
  sub: THREE.Color;
  main: THREE.Color;
  mainFg: THREE.Color;
  error: THREE.Color;
  success: THREE.Color;
  keyBg: THREE.Color;
  keyBorder: THREE.Color;
  keyText: THREE.Color;
  /** --finger-0 … --finger-9, left pinky → right pinky. */
  fingers: THREE.Color[];
  /** Resolved font-family for legends. */
  font: string;
  /** Relative luminance of the page background, 0..1. */
  bgLuma: number;
  /** Changes whenever any token value changes. */
  signature: string;
}

const FALLBACK: Record<string, string> = {
  "--bg": "#1f2124",
  "--bg-alt": "#2a2d31",
  "--border": "#3a3d42",
  "--text": "#d6d3cb",
  "--sub": "#74777d",
  "--main": "#e0b040",
  "--main-fg": "#1f2124",
  "--error": "#d9534f",
  "--success": "#6fbf73",
  "--key-bg": "",
  "--key-border": "",
  "--key-text": "",
  "--finger-0": "#e06c75",
  "--finger-1": "#e5a05a",
  "--finger-2": "#d8c95a",
  "--finger-3": "#7fc97f",
  "--finger-4": "#9aa5b1",
  "--finger-5": "#9aa5b1",
  "--finger-6": "#5cc0c0",
  "--finger-7": "#5a9be0",
  "--finger-8": "#9a7fe0",
  "--finger-9": "#d87fc0",
};

let probe: CanvasRenderingContext2D | null = null;

/** Parses any CSS colour the browser understands (hex, rgb(), oklch(), …). */
function parseCss(value: string, out: THREE.Color): boolean {
  if (!value) return false;
  if (typeof CSS !== "undefined" && CSS.supports && !CSS.supports("color", value)) return false;
  if (!probe) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probe = c.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return false;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  out.setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
  return true;
}

export function readTheme(): HandsTheme {
  const cs = getComputedStyle(document.documentElement);
  const sig: string[] = [];
  const get = (name: string, fallbackName?: string): THREE.Color => {
    const c = new THREE.Color();
    const raw = cs.getPropertyValue(name).trim();
    sig.push(raw);
    if (parseCss(raw, c)) return c;
    if (fallbackName) {
      const alt = cs.getPropertyValue(fallbackName).trim();
      if (parseCss(alt, c)) return c;
      if (parseCss(FALLBACK[fallbackName], c)) return c;
    }
    parseCss(FALLBACK[name], c);
    return c;
  };
  const bg = get("--bg");
  const fontRaw = cs.getPropertyValue("--font-sans").trim();
  sig.push(fontRaw);
  const hsl = { h: 0, s: 0, l: 0 };
  bg.getHSL(hsl, THREE.SRGBColorSpace);
  const theme: HandsTheme = {
    bg,
    bgAlt: get("--bg-alt"),
    border: get("--border"),
    text: get("--text"),
    sub: get("--sub"),
    main: get("--main"),
    mainFg: get("--main-fg"),
    error: get("--error"),
    success: get("--success"),
    keyBg: get("--key-bg", "--bg-alt"),
    keyBorder: get("--key-border", "--border"),
    keyText: get("--key-text", "--text"),
    fingers: Array.from({ length: 10 }, (_, i) => get(`--finger-${i}`)),
    font: fontRaw || 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    bgLuma: hsl.l,
    signature: "",
  };
  theme.signature = sig.join("|");
  return theme;
}

/** Calls `cb` whenever the theme (data-theme / class / inline style on <html>, or the OS scheme) changes. */
export function watchTheme(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class", "style"],
  });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}

const ca = { r: 0, g: 0, b: 0 };
const cb = { r: 0, g: 0, b: 0 };

/** out = mix(a, b, t) computed in sRGB (perceptual, like CSS color-mix in srgb) instead of linear light. */
export function mixSRGB(out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  a.getRGB(ca, THREE.SRGBColorSpace);
  b.getRGB(cb, THREE.SRGBColorSpace);
  return out.setRGB(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t, THREE.SRGBColorSpace);
}
