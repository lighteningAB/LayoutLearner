import JSON5 from "json5";

/** Strict JSON first, then lenient JSON5 (trailing commas etc). undefined on failure. */
export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON5.parse(text);
    } catch {
      return undefined;
    }
  }
}
