// Linear-time string helpers and size limits for the layout parsers.
// Alias-free on purpose so scripts/parse-bench.mjs can import it directly.

/** Largest layout source accepted anywhere (parse, paste, sync). */
export const MAX_SOURCE_BYTES = 50_000;
/** Most keys a custom (user-supplied) layout may have. */
export const MAX_CUSTOM_KEYS = 300;
/** Key labels are cut to this many characters before legend processing. */
export const MAX_LABEL_CHARS = 64;

/**
 * Same result as `s.replace(/<[^>]*>/g, "").trim()` but linear: the regex
 * retries from every `<` when there is no closing `>` and goes quadratic.
 */
export function stripTagsLinear(s: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      out += s.slice(i);
      break;
    }
    const gt = s.indexOf(">", lt + 1);
    if (gt < 0) {
      // No `>` anywhere after this point, so no later `<` can match either.
      out += s.slice(i);
      break;
    }
    out += s.slice(i, lt);
    i = gt + 1;
  }
  return out.trim();
}

const SEP = /[,;\s]/;

/** Same result as `s.replace(/[,;\s]+$/, "")` but linear. */
export function trimTrailingSeparators(s: string): string {
  let end = s.length;
  while (end > 0 && SEP.test(s[end - 1])) end--;
  return end === s.length ? s : s.slice(0, end);
}
