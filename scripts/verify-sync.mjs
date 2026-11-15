#!/usr/bin/env node
// Multi-device browser verification CLI (accounts + cross-device sync). Headless Chrome via playwright-core.
// Each named "device" is a persistent browser context stored in .verify/profiles/<name>/ (cookies and
// localStorage survive across invocations). Several devices can be open in one run.
//
//   node scripts/verify-sync.mjs [--base http://localhost:3100] [--size 1440x900] [--dark|--light]
//                                [--allow-errors] <step>...
//
// Steps run in order, `cmd:arg` (split on the FIRST colon only). Acts on the current device
// (default device "default" unless a `dev:` step was given).
//
// Devices
//   dev:<name>            switch current device (launched on first use, with one page)
//   fresh:<name>          close the device if open, delete its profile dir so it starts empty
//   size:<WxH>            set the current page's viewport
//   reload                reload current page (networkidle)
// Navigation / interaction (as scripts/verify.mjs)
//   goto:/path  wait:500  waitfor:<sel>  click:<sel>  type:<text>  press:<Key>
//   text:<sel>  eval:<js>  store:<key>  shot:<name>   (screenshot -> .verify/<name>.png)
//   fill:<sel>=<text>     fill an input (split on first "=")
//   hover:<sel>
//   focuswin              simulate window regaining focus (bringToFront + visibilitychange + focus)
//   waittext:<sel>=<substr>   wait (15s) until element innerText includes substr
//   waitgone:<sel>            wait until selector hidden/detached
//   waitstore:<key>~<substr>  wait until localStorage[key] contains substr
//   assert:<js>           evaluate JS in page; falsy result FAILS the run
//   setstore:<key>=<json-or-string>   set a localStorage item
//   clearstore            clear localStorage of the current origin
// Network control (per device, context.route)
//   block:<url-substr>        abort matching requests (simulate offline)
//   fail:<url-substr>=<status>  fulfil matching requests with that status, body {"error":"injected"}
//   unblock:<url-substr>      remove a rule (unblock:* removes all)
// Network log (per device)
//   net:<substr>              print recorded requests containing substr (since last netclear)
//   netclear                  clear current device's log
//   assertnet:<substr>=N      FAIL unless exactly N recorded requests match
//   assertnet:<substr>>=N     FAIL unless at least N match
// API
//   api:<METHOD> <path> [json-body]   fetch from inside the page (same-origin, device cookies) with
//                                     Content-Type: application/json and X-LL-Sync: 1; print status + body
//   apiraw:<METHOD> <path> [{"headers":{..},"body":..}]   via context.request (shares cookies, arbitrary
//                                     headers such as Origin, or omit X-LL-Sync); print status + body
//   devlogin:<username>       next-auth credentials flow via context.request (csrf -> callback/dev ->
//                             prints /api/auth/session). Reload pages afterwards to see signed-in UI.
// Typing
//   lesson:<n>            n times { read [data-testid=words] innerText, type it with real key events
//                         (12ms/key), Enter, wait 400ms }. If the intro step is showing (no words
//                         visible but a lesson step bar is), Enter skips it first. Stops quietly when
//                         [data-testid=words] is not visible within 5s.
//
// Problems (console errors, page errors, failed requests except ERR_ABORTED / injected ones, HTTP>=400)
// are printed per device at the end. Exit 1 on step/assert failure or any console/page error not caused
// by an injected block/fail rule. --allow-errors downgrades console/page errors to warnings.
//
// Examples
//   # two devices, independent localStorage
//   node scripts/verify-sync.mjs dev:A goto:/ setstore:foo=1 store:foo dev:B goto:/ store:foo
//   # persisted login across runs
//   node scripts/verify-sync.mjs dev:A goto:/ devlogin:alice
//   node scripts/verify-sync.mjs dev:A goto:/settings text:body
import { chromium } from "playwright-core";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
let base = "http://localhost:3100";
let size = [1440, 900];
let scheme = "dark";
let allowErrors = false;
const steps = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--base") base = args[++i];
  else if (a === "--size") size = args[++i].split("x").map(Number);
  else if (a === "--dark") scheme = "dark";
  else if (a === "--light") scheme = "light";
  else if (a === "--allow-errors") allowErrors = true;
  else steps.push(a);
}
if (!steps.length) {
  console.error("no steps given; see header of scripts/verify-sync.mjs");
  process.exit(2);
}

const outDir = resolve(".verify");
const profilesDir = resolve(outDir, "profiles");
mkdirSync(profilesDir, { recursive: true });

/** @type {Map<string, any>} */
const devices = new Map();
let current = "default";
const LAUNCH_ARGS = ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=metal"];

async function openDevice(name) {
  if (devices.has(name)) return devices.get(name);
  const dir = resolve(profilesDir, name);
  const context = await chromium.launchPersistentContext(dir, {
    channel: "chrome",
    headless: true,
    viewport: { width: size[0], height: size[1] },
    colorScheme: scheme,
    args: LAUNCH_ARGS,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const d = { name, context, page, problems: [], warnings: [], log: [], rules: [], everRuled: false, rulesFired: 0 };
  const matchesRule = (url) => d.rules.some((r) => url.includes(r.sub));
  const pathOf = (u) => {
    try {
      const x = new URL(u);
      return x.pathname + x.search;
    } catch {
      return u;
    }
  };
  // Routing: one handler checks the current rule list (so unblock simply edits the list).
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    const rule = d.rules.find((r) => url.includes(r.sub));
    if (!rule) return route.continue();
    d.everRuled = true;
    d.injected.add(route.request());
    if (rule.kind === "block") return route.abort("failed");
    return route.fulfill({ status: rule.status, contentType: "application/json", body: '{"error":"injected"}' });
  });
  d.injected = new WeakSet();
  const wire = (p) => {
    p.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text().slice(0, 500);
      // Browser-generated "Failed to load resource" lines are expected once a rule was active.
      if (d.everRuled && t.startsWith("Failed to load resource")) return;
      (allowErrors ? d.warnings : d.problems).push(`console.error: ${t}`);
    });
    p.on("pageerror", (e) => (allowErrors ? d.warnings : d.problems).push(`pageerror: ${String(e).slice(0, 500)}`));
  };
  wire(page);
  context.on("page", wire);
  context.on("request", (r) => {
    d.log.push({ req: r, method: r.method(), path: pathOf(r.url()), url: r.url(), status: null });
  });
  context.on("response", (r) => {
    const entry = [...d.log].reverse().find((e) => e.req === r.request());
    if (entry) entry.status = r.status();
    if (r.status() >= 400 && !d.injected.has(r.request())) d.warnings.push(`http ${r.status()}: ${r.url()}`);
  });
  context.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    const entry = [...d.log].reverse().find((e) => e.req === r);
    if (entry) entry.status = `failed(${f})`;
    if (f.includes("ERR_ABORTED") || d.injected.has(r) || matchesRule(r.url())) return;
    d.warnings.push(`requestfailed: ${r.url()} ${f}`);
  });
  devices.set(name, d);
  return d;
}

async function closeDevice(name) {
  const d = devices.get(name);
  if (!d) return;
  devices.delete(name);
  await d.context.close().catch(() => {});
}

const dev = () => openDevice(current);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lesson(d, n) {
  const page = d.page;
  let typed = 0;
  for (let i = 0; i < n; i++) {
    let words = page.locator("[data-testid=words]");
    try {
      await words.first().waitFor({ state: "visible", timeout: 5000 });
    } catch {
      // Possibly on the intro step (no words shown): Enter skips it, then retry once.
      // Never press Enter on the summary screen (data-step === data-steps): it moves to the next lesson.
      const onIntro = await page.evaluate(() => {
        const el = document.querySelector("[data-testid=step-progress]");
        return !!el && el.getAttribute("data-step") === "1" && el.getAttribute("data-step") !== el.getAttribute("data-steps");
      });
      if (onIntro) {
        await page.keyboard.press("Enter");
        try {
          await words.first().waitFor({ state: "visible", timeout: 5000 });
        } catch {
          break;
        }
      } else break;
    }
    const raw = await words.first().innerText();
    const text = raw.replace(/\s+/g, " ").trim();
    await page.keyboard.type(text, { delay: 12 });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    typed++;
  }
  console.log(`[lesson] typed ${typed} drill(s)`);
}

let failed = false;
try {
  for (const step of steps) {
    const idx = step.indexOf(":");
    const cmd = idx === -1 ? step : step.slice(0, idx);
    const arg = idx === -1 ? "" : step.slice(idx + 1);
    try {
      switch (cmd) {
        case "dev": {
          current = arg || "default";
          await dev();
          console.log(`[dev] ${current}`);
          break;
        }
        case "fresh": {
          await closeDevice(arg);
          rmSync(resolve(profilesDir, arg), { recursive: true, force: true });
          console.log(`[fresh] ${arg} profile deleted`);
          break;
        }
        case "size": {
          const [w, h] = arg.split("x").map(Number);
          await (await dev()).page.setViewportSize({ width: w, height: h });
          console.log(`[size] ${w}x${h}`);
          break;
        }
        case "reload": {
          const { page } = await dev();
          await page.reload({ waitUntil: "networkidle", timeout: 60000 });
          console.log(`[reload] ${page.url()}`);
          break;
        }
        case "goto": {
          const { page } = await dev();
          await page.goto(new URL(arg, base).href, { waitUntil: "networkidle", timeout: 60000 });
          console.log(`[goto] ${page.url()} — "${await page.title()}"`);
          break;
        }
        case "wait":
          await sleep(Number(arg));
          break;
        case "waitfor": {
          const { page } = await dev();
          await page.waitForSelector(arg, { state: "visible", timeout: 15000 });
          console.log(`[waitfor] ${arg} visible`);
          break;
        }
        case "click": {
          const { page } = await dev();
          await page.click(arg, { timeout: 10000 });
          console.log(`[click] ${arg}`);
          break;
        }
        case "hover": {
          const { page } = await dev();
          await page.hover(arg, { timeout: 10000 });
          console.log(`[hover] ${arg}`);
          break;
        }
        case "fill": {
          const { page } = await dev();
          const i = arg.indexOf("=");
          if (i < 0) throw new Error("fill needs <selector>=<text>");
          await page.fill(arg.slice(0, i), arg.slice(i + 1), { timeout: 10000 });
          console.log(`[fill] ${arg.slice(0, i)}`);
          break;
        }
        case "type": {
          const { page } = await dev();
          await page.keyboard.type(arg, { delay: 30 });
          console.log(`[type] ${JSON.stringify(arg)}`);
          break;
        }
        case "press": {
          const { page } = await dev();
          await page.keyboard.press(arg);
          console.log(`[press] ${arg}`);
          break;
        }
        case "focuswin": {
          const { page } = await dev();
          await page.bringToFront();
          await page.evaluate(() => {
            document.dispatchEvent(new Event("visibilitychange"));
            window.dispatchEvent(new Event("focus"));
          });
          console.log("[focuswin] dispatched visibilitychange + focus");
          break;
        }
        case "text": {
          const { page } = await dev();
          const t = await page.innerText(arg || "body", { timeout: 10000 });
          console.log(`[text ${arg || "body"}]\n${t.slice(0, 4000)}`);
          break;
        }
        case "waittext": {
          const { page } = await dev();
          const i = arg.indexOf("=");
          if (i < 0) throw new Error("waittext needs <selector>=<substring>");
          const sel = arg.slice(0, i);
          const sub = arg.slice(i + 1);
          await page.waitForFunction(
            ([s, t]) => {
              const el = document.querySelector(s);
              return !!el && el.innerText.includes(t);
            },
            [sel, sub],
            { timeout: 15000 },
          );
          console.log(`[waittext] ${sel} contains ${JSON.stringify(sub)}`);
          break;
        }
        case "waitgone": {
          const { page } = await dev();
          await page.waitForSelector(arg, { state: "hidden", timeout: 15000 });
          console.log(`[waitgone] ${arg}`);
          break;
        }
        case "waitstore": {
          const { page } = await dev();
          const i = arg.indexOf("~");
          if (i < 0) throw new Error("waitstore needs <key>~<substring>");
          const key = arg.slice(0, i);
          const sub = arg.slice(i + 1);
          await page.waitForFunction(([k, t]) => (localStorage.getItem(k) ?? "").includes(t), [key, sub], { timeout: 15000 });
          console.log(`[waitstore] ${key} contains ${JSON.stringify(sub)}`);
          break;
        }
        case "eval": {
          const { page } = await dev();
          const r = await page.evaluate(arg);
          console.log(`[eval] ${JSON.stringify(r, null, 1)?.slice(0, 4000)}`);
          break;
        }
        case "assert": {
          const { page } = await dev();
          const r = await page.evaluate(arg);
          if (r) console.log(`[assert ok] ${arg}`);
          else {
            console.log(`[assert FAIL] ${arg} -> ${JSON.stringify(r)}`);
            failed = true;
          }
          break;
        }
        case "store": {
          const { page } = await dev();
          const r = await page.evaluate((k) => localStorage.getItem(k), arg);
          console.log(`[store ${arg}] ${String(r).slice(0, 4000)}`);
          break;
        }
        case "setstore": {
          const { page } = await dev();
          const i = arg.indexOf("=");
          if (i < 0) throw new Error("setstore needs <key>=<value>");
          await page.evaluate(([k, v]) => localStorage.setItem(k, v), [arg.slice(0, i), arg.slice(i + 1)]);
          console.log(`[setstore] ${arg.slice(0, i)}`);
          break;
        }
        case "clearstore": {
          const { page } = await dev();
          await page.evaluate(() => localStorage.clear());
          console.log("[clearstore]");
          break;
        }
        case "shot": {
          const { page } = await dev();
          const p = resolve(outDir, `${arg || "shot"}.png`);
          await page.screenshot({ path: p });
          console.log(`[shot] ${p}`);
          break;
        }
        case "block":
        case "fail": {
          const d = await dev();
          if (cmd === "block") d.rules.push({ kind: "block", sub: arg });
          else {
            const i = arg.lastIndexOf("=");
            if (i < 0) throw new Error("fail needs <url-substring>=<status>");
            d.rules.push({ kind: "fail", sub: arg.slice(0, i), status: Number(arg.slice(i + 1)) });
          }
          d.everRuled = true;
          console.log(`[${cmd}] ${arg}`);
          break;
        }
        case "unblock": {
          const d = await dev();
          d.rules = arg === "*" ? [] : d.rules.filter((r) => r.sub !== arg);
          console.log(`[unblock] ${arg} (${d.rules.length} rule(s) left)`);
          break;
        }
        case "netclear": {
          (await dev()).log.length = 0;
          console.log("[netclear]");
          break;
        }
        case "net": {
          const d = await dev();
          const m = d.log.filter((e) => e.url.includes(arg));
          console.log(`[net ${arg}] ${m.length} request(s)`);
          for (const e of m) console.log(`  ${e.method} ${e.path} -> ${e.status ?? "pending"}`);
          break;
        }
        case "assertnet": {
          const d = await dev();
          const m = arg.match(/^(.*?)(>=|=)(\d+)$/);
          if (!m) throw new Error("assertnet needs <substr>=N or <substr>>=N");
          const [, sub, op, nStr] = m;
          const n = Number(nStr);
          const hits = d.log.filter((e) => e.url.includes(sub));
          const ok = op === "=" ? hits.length === n : hits.length >= n;
          if (ok) console.log(`[assertnet ok] ${sub} ${op} ${n} (${hits.length})`);
          else {
            console.log(`[assertnet FAIL] ${sub} expected ${op} ${n}, got ${hits.length}`);
            for (const e of hits.slice(0, 10)) console.log(`  ${e.method} ${e.path} -> ${e.status ?? "pending"}`);
            failed = true;
          }
          break;
        }
        case "api": {
          const { page } = await dev();
          const m = arg.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/);
          if (!m) throw new Error("api needs <METHOD> <path> [json-body]");
          const [, method, path, body] = m;
          const r = await page.evaluate(
            async ([method, path, body]) => {
              const res = await fetch(path, {
                method,
                headers: { "Content-Type": "application/json", "X-LL-Sync": "1" },
                body: body ? body : undefined,
              });
              return { status: res.status, body: await res.text() };
            },
            [method.toUpperCase(), path, body],
          );
          console.log(`[api ${method} ${path}] ${r.status} ${r.body.slice(0, 2000)}`);
          break;
        }
        case "apiraw": {
          const d = await dev();
          const m = arg.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]*))?$/);
          if (!m) throw new Error("apiraw needs <METHOD> <path> [json {headers, body}]");
          const [, method, path, opts] = m;
          const o = opts ? JSON.parse(opts) : {};
          const data = o.body === undefined ? undefined : typeof o.body === "string" ? o.body : JSON.stringify(o.body);
          const res = await d.context.request.fetch(new URL(path, base).href, {
            method: method.toUpperCase(),
            headers: o.headers ?? {},
            data,
            maxRedirects: 0,
          });
          console.log(`[apiraw ${method} ${path}] ${res.status()} ${(await res.text()).slice(0, 2000)}`);
          break;
        }
        case "devlogin": {
          const d = await dev();
          const csrf = await (await d.context.request.get(new URL("/api/auth/csrf", base).href)).json();
          if (!csrf.csrfToken) throw new Error(`no csrfToken from /api/auth/csrf: ${JSON.stringify(csrf)}`);
          const res = await d.context.request.post(new URL("/api/auth/callback/dev", base).href, {
            form: { csrfToken: csrf.csrfToken, username: arg, json: "true" },
          });
          console.log(`[devlogin ${arg}] callback ${res.status()}`);
          const s = await d.context.request.get(new URL("/api/auth/session", base).href);
          console.log(`[session] ${(await s.text()).slice(0, 1000)}`);
          break;
        }
        case "lesson": {
          await lesson(await dev(), Number(arg) || 1);
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
} finally {
  for (const name of [...devices.keys()]) {
    // keep a copy of the problem lists before closing
    const d = devices.get(name);
    d.final = true;
  }
  var all = [...devices.values()];
  await Promise.all(all.map((d) => d.context.close().catch(() => {})));
}

let hardErrors = 0;
for (const d of all) {
  const p = [...new Set(d.problems)];
  const w = [...new Set(d.warnings)];
  hardErrors += p.length;
  if (!p.length && !w.length) {
    console.log(`\n--- [${d.name}] no console/page/network errors ---`);
    continue;
  }
  console.log(`\n--- [${d.name}] ${p.length} error(s), ${w.length} warning(s) ---`);
  for (const x of p) console.log(`  ERROR ${x}`);
  for (const x of w) console.log(`  warn  ${x}`);
}
process.exit(failed || hardErrors ? 1 : 0);
