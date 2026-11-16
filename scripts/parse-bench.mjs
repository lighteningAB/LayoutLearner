// Times the old quadratic regexes against the linear scans in lib/layout/scan.ts
// and checks both give identical output on normal labels.
//   node scripts/parse-bench.mjs        (node >= 22.18, native type stripping)
import { stripTagsLinear, trimTrailingSeparators } from "../lib/layout/scan.ts";

const oldStrip = (s) => s.replace(/<[^>]*>/g, "").trim();
const oldTrim = (s) => s.replace(/[,;\s]+$/, "");

const time = (fn) => {
  const t = performance.now();
  const out = fn();
  return [performance.now() - t, out];
};
let fail = 0;
const check = (ok, msg) => {
  if (!ok) fail++;
  console.log((ok ? "ok   " : "FAIL ") + msg);
};

const lt = "<".repeat(60_000);
const sep = ",".repeat(60_000) + "x";
const cases = [
  ["stripTags, 60k '<'", () => oldStrip(lt), () => stripTagsLinear(lt)],
  ["trimTrailing, 60k ',' + 'x'", () => oldTrim(sep), () => trimTrailingSeparators(sep)],
];
for (const [name, o, n] of cases) {
  const [to, ro] = time(o);
  const [tn, rn] = time(n);
  console.log(`${name}: old ${to.toFixed(1)} ms, new ${tn.toFixed(2)} ms`);
  check(tn < 20, `${name}: new < 20 ms`);
  check(ro === rn, `${name}: same output`);
}

// Deterministic PRNG so runs are reproducible.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const alphabet = ["a", "Q", "1", " ", ",", ";", "\n", "\t", "<", ">", "<b>", "</b>", "<br>", "&", "é", "→"];
let same = 0;
for (let i = 0; i < 200; i++) {
  let s = "";
  const len = Math.floor(rnd() * 20);
  for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
  if (oldStrip(s) === stripTagsLinear(s) && oldTrim(s) === trimTrailingSeparators(s)) same++;
  else console.log("mismatch:", JSON.stringify(s));
}
check(same === 200, `200 random labels identical (${same}/200)`);
process.exit(fail ? 1 : 0);
