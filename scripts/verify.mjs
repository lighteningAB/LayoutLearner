#!/usr/bin/env node
// Browser verification CLI. Drives the running dev server with headless Chrome.
//
//   node scripts/verify.mjs [--base http://localhost:3000] [--size 1440x900] [--dark|--light] <step>...
//
// Steps run in order:
//   goto:/path            navigate (waits for network idle)
//   wait:500              sleep ms
//   waitfor:<selector>    wait until selector is visible
//   click:<selector>      click (CSS or text=Foo)
//   type:<text>           type text with real key events (30ms/key)
//   press:<Key>           press one key or chord (Enter, Shift+A, KeyQ, Tab)
//   text:<selector>       print innerText of selector (default body if empty)
//   eval:<js>             evaluate JS expression in page, print JSON result
//   store:<key>           print localStorage[key]
//   shot:<name>           screenshot to .verify/<name>.png (view it with the Read tool)
//
// Console errors, page errors and failed requests are always printed at the end.
// Exit code 1 if any page error / console error occurred or a step failed.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
let base = "http://localhost:3000";
let size = [1440, 900];
let scheme = "dark";
const steps = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--size") size = args[++i].split("x").map(Number);
  else if (a === "--dark") scheme = "dark";
  else if (a === "--light") scheme = "light";
  else steps.push(a);
}
if (!steps.length) {
  console.error("no steps given; see header of scripts/verify.mjs");
  process.exit(2);
}

const outDir = resolve(".verify");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=metal"],
});
const page = await browser.newPage({
  viewport: { width: size[0], height: size[1] },
  colorScheme: scheme,
});
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console.error: ${m.text().slice(0, 500)}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 500)}`));
page.on("requestfailed", (r) => {
  const f = r.failure()?.errorText ?? "";
  if (!f.includes("ERR_ABORTED")) problems.push(`requestfailed: ${r.url()} ${f}`);
});
page.on("response", (r) => {
  if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`);
});

let failed = false;
for (const step of steps) {
  const idx = step.indexOf(":");
  const cmd = idx === -1 ? step : step.slice(0, idx);
  const arg = idx === -1 ? "" : step.slice(idx + 1);
  try {
    switch (cmd) {
      case "goto":
        await page.goto(new URL(arg, base).href, { waitUntil: "networkidle", timeout: 60000 });
        console.log(`[goto] ${page.url()} — "${await page.title()}"`);
        break;
      case "wait":
        await page.waitForTimeout(Number(arg));
        break;
      case "waitfor":
        await page.waitForSelector(arg, { state: "visible", timeout: 15000 });
        console.log(`[waitfor] ${arg} visible`);
        break;
      case "click":
        await page.click(arg, { timeout: 10000 });
        console.log(`[click] ${arg}`);
        break;
      case "type":
        await page.keyboard.type(arg, { delay: 30 });
        console.log(`[type] ${JSON.stringify(arg)}`);
        break;
      case "press":
        await page.keyboard.press(arg);
        console.log(`[press] ${arg}`);
        break;
      case "text": {
        const t = await page.innerText(arg || "body", { timeout: 10000 });
        console.log(`[text ${arg || "body"}]\n${t.slice(0, 4000)}`);
        break;
      }
      case "eval": {
        const r = await page.evaluate(arg);
        console.log(`[eval] ${JSON.stringify(r, null, 1)?.slice(0, 4000)}`);
        break;
      }
      case "store": {
        const r = await page.evaluate((k) => localStorage.getItem(k), arg);
        console.log(`[store ${arg}] ${String(r).slice(0, 4000)}`);
        break;
      }
      case "shot": {
        const p = resolve(outDir, `${arg || "shot"}.png`);
        await page.screenshot({ path: p });
        console.log(`[shot] ${p}`);
        break;
      }
      default:
        throw new Error(`unknown step "${cmd}"`);
    }
  } catch (e) {
    failed = true;
    console.log(`[FAIL ${step}] ${String(e).split("\n")[0]}`);
    break;
  }
}
await browser.close();
if (problems.length) {
  console.log(`\n--- ${problems.length} problem(s) ---\n${[...new Set(problems)].join("\n")}`);
} else {
  console.log("\n--- no console/page/network errors ---");
}
process.exit(failed || problems.some((p) => !p.startsWith("http 4") && !p.startsWith("requestfailed")) ? 1 : 0);
