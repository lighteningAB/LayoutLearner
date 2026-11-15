// Property tests for the sync core (lib/sync/doc.ts, lib/sync/view.ts).
//
//   node scripts/sync-property.mjs [--cases 5000] [--seed N]
//
// Random documents are generated from deliberately SMALL id / timestamp / value spaces, so that the
// interesting situations (same key on both sides, equal timestamps, tombstone-vs-live ties, equal
// epochs, shared device ids) come up in almost every case instead of almost never.
//
// Every case has its own PRNG derived from (seed, property, case index): a failure prints the seed,
// the case index and a JSON repro (shrunk where the inputs are documents) and exits 1.
// Needs Node >= 23.6 (imports the TypeScript sources directly through type stripping).

// Node warns that package.json has no "type" when it loads the .ts files as ES modules. Harmless.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => {
  const code = typeof rest[0] === "object" && rest[0] !== null ? rest[0].code : rest[1];
  if (code === "MODULE_TYPELESS_PACKAGE_JSON" || /MODULE_TYPELESS_PACKAGE_JSON|Module type of file/.test(String(w))) return;
  return emitWarning.call(process, w, ...rest);
};

const D = await import("../lib/sync/doc.ts");
const V = await import("../lib/sync/view.ts");
const {
  DOC_SCHEMA, LIMITS, TOMBSTONE_TTL_MS, CLIENT_TOMBSTONE_TTL_MS,
  emptyDoc, canonical, docsEqual, mergeDocs, includesDoc, pruneDoc, clampDocTimes, validateDoc,
} = D;
const { absorbView, projectDoc, emptyView } = V;

// ---------------------------------------------------------------------------------------------
// Arguments, PRNG, harness
// ---------------------------------------------------------------------------------------------

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(process.argv[i + 1]);
  if (!Number.isFinite(n)) {
    console.error(`bad value for ${name}`);
    process.exit(2);
  }
  return n;
}
const CASES = Math.max(1, Math.floor(arg("--cases", 5000)));
const SEED = arg("--seed", (Date.now() ^ (process.pid << 8)) >>> 0) >>> 0;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const next = mulberry32(seed);
  const r = {
    next,
    int: (n) => Math.floor(next() * n), // 0 .. n-1
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
  return r;
}
const caseSeed = (prop, i) => (Math.imul(SEED ^ Math.imul(prop + 1, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35)) >>> 0;

class Failure extends Error {
  constructor(message, repro) {
    super(message);
    this.repro = repro;
  }
}
const check = (cond, message, repro) => {
  if (!cond) throw new Failure(message, typeof repro === "function" ? repro() : repro);
};
const eq = (a, b) => canonical(a) === canonical(b);
const clone = (x) => JSON.parse(JSON.stringify(x));
function deepFreeze(x) {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const k of Object.keys(x)) deepFreeze(x[k]);
  }
  return x;
}

/**
 * Greedy shrinker for failures whose inputs are documents: keeps deleting map entries (registers,
 * layouts, lesson layouts, lessons, device counters) for as long as `fails(docs)` stays true.
 */
function shrinkDocs(docs, fails) {
  let cur = docs.map(clone);
  const stillFails = (cand) => {
    try {
      return fails(cand.map((d) => deepFreeze(clone(d)))) === true;
    } catch {
      return true; // a thrown Failure / exception is still a failure
    }
  };
  if (!stillFails(cur)) return cur; // not reproducible in isolation: report as is
  const paths = (doc) => {
    const out = [];
    for (const s of ["settings", "learn", "layouts"]) for (const k of Object.keys(doc[s])) out.push([s, k]);
    for (const l of Object.keys(doc.lessons.by)) {
      out.push(["lessons", "by", l]);
      for (const x of Object.keys(doc.lessons.by[l])) {
        out.push(["lessons", "by", l, x]);
        for (const d of Object.keys(doc.lessons.by[l][x].att)) out.push(["lessons", "by", l, x, "att", d]);
      }
    }
    return out;
  };
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < cur.length; i++) {
      for (const path of paths(cur[i])) {
        const cand = cur.map(clone);
        let o = cand[i];
        for (let j = 0; j < path.length - 1 && o; j++) o = o[path[j]];
        if (!o || !(path[path.length - 1] in o)) continue;
        delete o[path[path.length - 1]];
        if (stillFails(cand)) {
          cur = cand;
          progress = true;
        }
      }
    }
  }
  return cur;
}

const results = [];
let failed = false;
function property(index, name, cases, body) {
  const start = performance.now();
  let i = 0;
  try {
    for (; i < cases; i++) body(makeRng(caseSeed(index, i)), i);
    const ms = performance.now() - start;
    console.log(`ok   ${String(index).padStart(2)}. ${name.padEnd(58)} ${String(cases).padStart(6)} cases ${ms.toFixed(0).padStart(6)} ms`);
    results.push({ name, cases, ms });
  } catch (e) {
    failed = true;
    console.log(`FAIL ${String(index).padStart(2)}. ${name}`);
    console.log(`     seed ${SEED}, case ${i}: ${e && e.message}`);
    console.log(`     rerun: node scripts/sync-property.mjs --seed ${SEED} --cases ${Math.max(i + 1, 1)}`);
    if (e instanceof Failure) {
      if (e.repro !== undefined) console.log("     repro: " + JSON.stringify(e.repro));
    } else {
      console.log(e && e.stack);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Generators (small spaces on purpose)
// ---------------------------------------------------------------------------------------------

// "fontSize" is device-local and "testMode" is a group member under CONFIG: registers for them can only
// come from a client with a different config, and must be ignored by projectDoc.
const REG_KEYS = ["theme", "layoutId", "testMode+testAmount", "wordList", "punctuation", "futureKey", "fontSize", "testMode"];
const LEARN_KEYS = ["showHints", "course"];
const LAYOUT_IDS = ["L1", "L2", "L3"];
const LESSON_LAYOUTS = ["qwerty", "L1"];
const LESSON_IDS = ["a", "b", "c"];
const DEVICES = ["d1", "d2", "d3"];
const VALUES = [
  null, true, false, 0, 1, 30, 2.5, "", "dark", "light", "qwerty",
  [], [1, "x"], {}, { a: 1 }, { a: 1, b: [null, { c: "d" }] },
  { testMode: "time", testAmount: 30 }, { testMode: "words", testAmount: 50 }, { testMode: "words" },
];
const T_MAX = 5;

const genT = (r) => r.range(0, T_MAX);
const genValue = (r) => clone(r.pick(VALUES));
function genLayoutValue(r, id) {
  const v = { id, name: r.pick(["a", "b", "My layout"]), source: r.pick(["[]", '[["Q","W"]]']) };
  if (r.chance(0.3)) v.fingers = r.pick([{ KeyQ: 0 }, { KeyQ: 1, KeyW: 2 }, {}]);
  if (r.chance(0.1)) v.unknownField = genValue(r);
  return v;
}
function genRegisters(r, keys) {
  const out = {};
  for (const k of keys) if (r.chance(0.6)) out[k] = { t: genT(r), v: genValue(r) };
  return out;
}
function genLessonEntry(r) {
  const att = {};
  for (const d of DEVICES) if (r.chance(0.5)) att[d] = r.range(0, 4);
  return {
    stars: r.range(0, 3),
    bestWpm: r.pick([0, 10, 35.5, 80]),
    bestAccuracy: r.pick([0, 90, 97.5, 100]),
    completedAt: r.chance(0.4) ? null : genT(r),
    lastAt: genT(r),
    att,
  };
}
function genDoc(r) {
  const layouts = {};
  for (const id of LAYOUT_IDS) {
    if (!r.chance(0.7)) continue;
    layouts[id] = r.chance(0.4) ? { t: genT(r), del: true } : { t: genT(r), v: genLayoutValue(r, id) };
  }
  const by = {};
  for (const l of LESSON_LAYOUTS) {
    if (!r.chance(0.7)) continue;
    by[l] = {};
    for (const x of LESSON_IDS) if (r.chance(0.6)) by[l][x] = genLessonEntry(r);
  }
  return {
    schema: 1,
    settings: genRegisters(r, REG_KEYS),
    learn: genRegisters(r, LEARN_KEYS),
    layouts,
    lessons: { epoch: r.range(0, 2), by },
  };
}
const genFrozenDoc = (r) => deepFreeze(genDoc(r));

const CONFIG = deepFreeze({
  deviceLocal: ["emulateLayout", "showHands", "fontSize"],
  groups: [["testMode", "testAmount"]],
  layoutsField: "customLayouts",
  settingsDefaults: {
    theme: "dark", layoutId: "qwerty", emulateLayout: true, showHands: true, fontSize: 24,
    testMode: "time", testAmount: 30, wordList: "english200", punctuation: false,
  },
  learnDefaults: { showHints: true, course: "basic" },
});

/** A view with every device-local field and the layout order removed, for cross-device comparison. */
function comparableView(view) {
  const settings = { ...view.settings };
  for (const f of CONFIG.deviceLocal) delete settings[f];
  settings[CONFIG.layoutsField] = [...settings[CONFIG.layoutsField]].sort((a, b) => (a.id < b.id ? -1 : 1));
  return { settings, learn: view.learn, lessons: view.lessons };
}

// ---------------------------------------------------------------------------------------------
// 1 + 2. Semilattice laws, on frozen inputs
// ---------------------------------------------------------------------------------------------

const lawFailures = {
  commutative: ([a, b]) => !docsEqual(mergeDocs(a, b), mergeDocs(b, a)),
  associative: ([a, b, c]) => !docsEqual(mergeDocs(mergeDocs(a, b), c), mergeDocs(a, mergeDocs(b, c))),
  idempotent: ([a]) => !docsEqual(mergeDocs(a, a), a),
  absorbing: ([a, b]) => !docsEqual(mergeDocs(mergeDocs(a, b), b), mergeDocs(a, b)),
};
function checkLaw(name, docs) {
  const fails = lawFailures[name];
  if (fails(docs)) throw new Failure(`merge is not ${name}`, shrinkDocs(docs, fails));
}

property(1, "merge: commutative, associative, idempotent", CASES, (r) => {
  const a = genFrozenDoc(r), b = genFrozenDoc(r), c = genFrozenDoc(r);
  checkLaw("commutative", [a, b]);
  checkLaw("associative", [a, b, c]);
  checkLaw("idempotent", [a]);
  checkLaw("absorbing", [a, b]);
  // includesDoc agrees with the lattice order: a join includes both of its arguments.
  const m = mergeDocs(a, b);
  check(includesDoc(m, a) && includesDoc(m, b), "merge(a,b) does not include a and b", { a, b });
  check(includesDoc(a, b) === docsEqual(m, a), "includesDoc(a,b) != (merge(a,b) == a)", { a, b });
  check(includesDoc(a, emptyDoc()), "a does not include the empty doc", { a });
});

property(2, "inputs are never mutated (deep-frozen + snapshot)", CASES, (r) => {
  const a = genDoc(r), b = genDoc(r);
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  deepFreeze(a);
  deepFreeze(b);
  // In an ES module (strict mode) writing to a frozen object throws, so a mutation fails loudly.
  const m = mergeDocs(a, b);
  mergeDocs(m, a);
  includesDoc(a, b);
  pruneDoc(a, 4, 2);
  clampDocTimes(a, 2);
  validateDoc(a, { now: 100, maxFutureMs: 0 });
  const base = projectDoc(a, emptyView(CONFIG), CONFIG);
  deepFreeze(base);
  absorbView(a, null, base, { now: 9, deviceId: "d1", config: CONFIG });
  absorbView(a, base, projectDoc(b, base, CONFIG), { now: 9, deviceId: "d1", config: CONFIG, lessonsReset: r.chance(0.3) });
  check(JSON.stringify(a) === sa && JSON.stringify(b) === sb, "an input changed", { a: JSON.parse(sa), b: JSON.parse(sb) });
  check(m !== a && m !== b && m.settings !== a.settings && m.layouts !== a.layouts && m.lessons !== a.lessons, "merge returned an input container", { a, b });
});

// ---------------------------------------------------------------------------------------------
// 3. Lesson bests never decrease
// ---------------------------------------------------------------------------------------------

function entryLeq(e, m) {
  if (!m) return false;
  if (!(e.stars <= m.stars && e.bestWpm <= m.bestWpm && e.bestAccuracy <= m.bestAccuracy && e.lastAt <= m.lastAt)) return false;
  for (const d of Object.keys(e.att)) if (!(e.att[d] <= (m.att[d] ?? -1))) return false;
  if (e.completedAt !== null && (m.completedAt === null || m.completedAt > e.completedAt)) return false;
  return true;
}
function bestsFail([a, b]) {
  const m = mergeDocs(a, b);
  if (a.lessons.epoch !== b.lessons.epoch) {
    const hi = a.lessons.epoch > b.lessons.epoch ? a : b;
    return !(m.lessons.epoch === hi.lessons.epoch && eq(m.lessons.by, hi.lessons.by));
  }
  if (m.lessons.epoch !== a.lessons.epoch) return true;
  for (const side of [a, b]) {
    for (const l of Object.keys(side.lessons.by)) {
      if (!m.lessons.by[l]) return true;
      for (const x of Object.keys(side.lessons.by[l])) if (!entryLeq(side.lessons.by[l][x], m.lessons.by[l][x])) return true;
    }
  }
  // Nothing appears from nowhere, and completedAt is one of the inputs' values.
  for (const l of Object.keys(m.lessons.by)) {
    for (const x of Object.keys(m.lessons.by[l])) {
      const ea = a.lessons.by[l]?.[x], eb = b.lessons.by[l]?.[x], em = m.lessons.by[l][x];
      if (!ea && !eb) return true;
      const cs = [ea, eb].filter(Boolean).map((e) => e.completedAt).filter((c) => c !== null);
      if (em.completedAt !== (cs.length ? Math.min(...cs) : null)) return true;
      for (const d of Object.keys(em.att)) if (em.att[d] !== Math.max(ea?.att[d] ?? -1, eb?.att[d] ?? -1)) return true;
    }
  }
  return false;
}
property(3, "lessons: bests never decrease, higher epoch wins wholesale", CASES, (r) => {
  const a = genFrozenDoc(r);
  const b = r.chance(0.5) ? genFrozenDoc(r) : deepFreeze({ ...genDoc(r), lessons: { ...genDoc(r).lessons, epoch: a.lessons.epoch } });
  if (bestsFail([a, b])) throw new Failure("lesson merge rule violated", shrinkDocs([a, b], bestsFail));
});

// ---------------------------------------------------------------------------------------------
// 4. Deletes never resurrect
// ---------------------------------------------------------------------------------------------

const isDel = (item) => !!item && item.del === true;
function resurrects([a, b]) {
  const m = mergeDocs(a, b);
  for (const id of new Set([...Object.keys(a.layouts), ...Object.keys(b.layouts)])) {
    const ia = a.layouts[id], ib = b.layouts[id], im = m.layouts[id];
    if (!im) return true;
    if (isDel(ia) && (!ib || ia.t >= ib.t) && !isDel(im)) return true;
    if (isDel(ib) && (!ia || ib.t >= ia.t) && !isDel(im)) return true;
    if (im.t !== Math.max(ia?.t ?? -1, ib?.t ?? -1)) return true;
  }
  return false;
}
function permutations(xs) {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}
property(4, "layouts: deletes never resurrect (pairwise + 3 replicas)", CASES, (r) => {
  const a = genFrozenDoc(r), b = genFrozenDoc(r);
  if (resurrects([a, b])) throw new Failure("tombstone lost against an item that is not newer", shrinkDocs([a, b], resurrects));

  // History: A creates the layout, B deletes it at the same time or later, C is a stale replica that
  // holds a version that is not newer than the delete (possibly an edit made before it).
  const id = r.pick(LAYOUT_IDS);
  const tCreate = genT(r);
  const tDelete = tCreate + r.range(0, 2);
  const tStale = r.range(0, tDelete);
  const A = genDoc(r), B = genDoc(r), C = genDoc(r);
  A.layouts[id] = { t: tCreate, v: genLayoutValue(r, id) };
  B.layouts[id] = { t: tDelete, del: true };
  if (r.chance(0.8)) C.layouts[id] = { t: tStale, v: genLayoutValue(r, id) };
  else delete C.layouts[id];
  // Extra replicas relaying the same states (duplicates) must not change anything either.
  const replicas = [A, B, C].map(deepFreeze);
  for (const [x, y, z] of permutations(replicas)) {
    for (const m of [mergeDocs(mergeDocs(x, y), z), mergeDocs(x, mergeDocs(y, z)), mergeDocs(mergeDocs(x, y), mergeDocs(z, x))]) {
      check(isDel(m.layouts[id]) && m.layouts[id].t === tDelete, "a merge order ended with the layout alive", { id, A, B, C });
      check(projectDoc(m, emptyView(CONFIG), CONFIG).settings.customLayouts.every((l) => l.id !== id), "deleted layout is projected", { id, A, B, C });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 5. Convergence simulation through absorbView / mergeDocs / projectDoc
// ---------------------------------------------------------------------------------------------

const SIM_LESSONS = [["qwerty", "a"], ["qwerty", "b"], ["L1", "a"]];
const lessonKey = (l, x) => l + "/" + x;

function simulate(r) {
  const log = [];
  const n = r.range(2, 4);
  let clock = 10_000;
  let anyReset = false;
  const recorded = {}; // lessonKey -> number of attempts recorded anywhere
  const reps = [];
  for (let i = 0; i < n; i++) {
    const view = emptyView(CONFIG);
    // Device-local fields differ per device and must survive everything.
    view.settings.fontSize = r.pick([16, 24, 32]);
    view.settings.showHands = r.chance(0.5);
    view.settings.emulateLayout = r.chance(0.5);
    // Some devices were used before sync existed (untracked local state, absorbed with seen = null).
    if (r.chance(0.4)) view.settings.theme = r.pick(["light", "solar"]);
    if (r.chance(0.3)) view.settings.customLayouts = [genLayoutValue(r, r.pick(LAYOUT_IDS))];
    if (r.chance(0.3)) {
      const [l, x] = r.pick(SIM_LESSONS);
      const attempts = r.range(1, 3);
      view.lessons = { [l]: { [x]: { stars: r.range(0, 3), bestWpm: r.range(5, 60), bestAccuracy: r.range(80, 100), completedAt: null, attempts, lastAt: 9000 } } };
      recorded[lessonKey(l, x)] = (recorded[lessonKey(l, x)] ?? 0) + attempts;
    }
    const rep = {
      deviceId: "dev" + i,
      // Skewed clocks: up to 3 s behind or ahead, far more than the time between events.
      skew: r.range(-3000, 3000),
      doc: emptyDoc(),
      seen: null,
      view: deepFreeze(view),
      best: {}, // lessonKey -> best values this replica ever recorded itself
      local: { fontSize: view.settings.fontSize, showHands: view.settings.showHands, emulateLayout: view.settings.emulateLayout },
    };
    for (const l of Object.keys(view.lessons)) for (const x of Object.keys(view.lessons[l])) rep.best[lessonKey(l, x)] = { ...view.lessons[l][x] };
    reps.push(rep);
    log.push({ init: rep.deviceId, skew: rep.skew, view });
  }
  const repro = () => ({ log });
  const nowOf = (rep) => clock + rep.skew;

  const flush = (rep, lessonsReset = false) => {
    const before = rep.doc;
    rep.doc = deepFreeze(absorbView(rep.doc, rep.seen, rep.view, { now: nowOf(rep), deviceId: rep.deviceId, config: CONFIG, lessonsReset }));
    rep.seen = rep.view;
    // Absorbing is inflationary, except that a reset moves lessons to a new epoch (still "greater").
    check(includesDoc(rep.doc, before), "absorbView lost state of the replica", repro);
    // Nothing to absorb -> nothing changes (no spurious stamps).
    const again = absorbView(rep.doc, rep.seen, rep.view, { now: nowOf(rep) + 50, deviceId: rep.deviceId, config: CONFIG });
    check(docsEqual(again, rep.doc), "absorbView with view = seen changed the doc", repro);
  };
  const receive = (rep, doc) => {
    flush(rep);
    rep.doc = deepFreeze(mergeDocs(rep.doc, doc));
    rep.view = deepFreeze(projectDoc(rep.doc, rep.view, CONFIG));
    rep.seen = rep.view;
  };
  const setView = (rep, mutate) => {
    const next = clone(rep.view);
    mutate(next);
    rep.view = deepFreeze(next);
  };

  const steps = r.range(5, 40);
  for (let s = 0; s < steps; s++) {
    clock += r.range(0, 3); // often 0: several events in the same millisecond
    const rep = r.pick(reps);
    const op = r.int(100);
    if (op < 18) {
      const key = r.pick(["theme", "layoutId", "wordList", "punctuation"]);
      const value = key === "punctuation" ? r.chance(0.5) : r.pick(["a", "b", "c"]);
      log.push({ at: clock, dev: rep.deviceId, set: key, value });
      setView(rep, (v) => { v.settings[key] = value; });
    } else if (op < 28) {
      const mode = r.pick(["time", "words"]), amount = r.pick([15, 30, 50]);
      log.push({ at: clock, dev: rep.deviceId, group: [mode, amount] });
      setView(rep, (v) => { if (r.chance(0.7)) v.settings.testMode = mode; v.settings.testAmount = amount; });
    } else if (op < 34) {
      const value = r.chance(0.5);
      log.push({ at: clock, dev: rep.deviceId, learn: value });
      setView(rep, (v) => { v.learn.showHints = value; });
    } else if (op < 40) {
      // Device-local edit: must never leave the device.
      const value = r.pick([16, 20, 24, 32, 40]);
      log.push({ at: clock, dev: rep.deviceId, fontSize: value });
      rep.local.fontSize = value;
      setView(rep, (v) => { v.settings.fontSize = value; });
    } else if (op < 52) {
      const id = r.pick(LAYOUT_IDS);
      const layout = genLayoutValue(r, id);
      log.push({ at: clock, dev: rep.deviceId, putLayout: layout });
      setView(rep, (v) => {
        const arr = v.settings.customLayouts;
        const i = arr.findIndex((l) => l.id === id);
        if (i >= 0) arr[i] = layout;
        else arr.push(layout);
      });
    } else if (op < 60) {
      const id = r.pick(LAYOUT_IDS);
      log.push({ at: clock, dev: rep.deviceId, deleteLayout: id });
      setView(rep, (v) => { v.settings.customLayouts = v.settings.customLayouts.filter((l) => l.id !== id); });
    } else if (op < 78) {
      const [l, x] = r.pick(SIM_LESSONS);
      const run = { stars: r.range(0, 3), wpm: r.range(5, 90), acc: r.range(70, 100) };
      const at = Math.max(0, nowOf(rep));
      log.push({ at: clock, dev: rep.deviceId, lesson: [l, x], run });
      const k = lessonKey(l, x);
      recorded[k] = (recorded[k] ?? 0) + 1;
      setView(rep, (v) => {
        const prev = v.lessons[l]?.[x] ?? { stars: 0, bestWpm: 0, bestAccuracy: 0, completedAt: null, attempts: 0, lastAt: 0 };
        (v.lessons[l] ??= {})[x] = {
          stars: Math.max(prev.stars, run.stars),
          bestWpm: Math.max(prev.bestWpm, run.wpm),
          bestAccuracy: Math.max(prev.bestAccuracy, run.acc),
          completedAt: prev.completedAt ?? (run.stars > 0 ? at : null),
          attempts: prev.attempts + 1,
          lastAt: Math.max(prev.lastAt, at),
        };
      });
      const b = rep.best[k] ?? { stars: 0, bestWpm: 0, bestAccuracy: 0 };
      rep.best[k] = { stars: Math.max(b.stars, run.stars), bestWpm: Math.max(b.bestWpm, run.wpm), bestAccuracy: Math.max(b.bestAccuracy, run.acc) };
    } else if (op < 81) {
      log.push({ at: clock, dev: rep.deviceId, resetLessons: true });
      anyReset = true;
      flush(rep); // pending edits first, then the reset itself
      setView(rep, (v) => { v.lessons = {}; });
      flush(rep, true);
      check(Object.keys(rep.doc.lessons.by).length === 0, "reset left lessons in the doc", repro);
    } else if (op < 88) {
      log.push({ at: clock, dev: rep.deviceId, flush: true });
      flush(rep);
    } else {
      const from = r.pick(reps);
      if (from === rep) continue;
      log.push({ at: clock, sync: [from.deviceId, "->", rep.deviceId] });
      flush(from);
      receive(rep, from.doc);
    }
  }

  // Final full exchange, in a random order and through a relay (the "server").
  clock += 1;
  for (const rep of reps) flush(rep);
  let server = emptyDoc();
  const order = [...reps].sort(() => r.next() - 0.5);
  for (const rep of order) server = mergeDocs(server, rep.doc);
  deepFreeze(server);
  for (const rep of reps) receive(rep, server);

  const v0 = comparableView(reps[0].view);
  for (const rep of reps) {
    check(docsEqual(rep.doc, server), "replicas did not converge to the same doc", repro);
    check(eq(comparableView(rep.view), v0), "replicas project different views", repro);
    for (const f of Object.keys(rep.local)) check(rep.view.settings[f] === rep.local[f], `device-local field ${f} was overwritten`, repro);
    // Whatever absorbView builds must be acceptable to the server.
    const res = validateDoc(clone(rep.doc), { now: clock + 5000, maxFutureMs: 1000 });
    check(res.ok && docsEqual(res.doc, rep.doc), "absorbed doc does not validate: " + (res.ok ? "changed" : res.error), repro);
    check(docsEqual(absorbView(rep.doc, rep.seen, rep.view, { now: clock + rep.skew + 99, deviceId: rep.deviceId, config: CONFIG }), rep.doc), "final view is not a fixed point", repro);
  }
  if (!anyReset) {
    const lessons = reps[0].view.lessons;
    for (const k of Object.keys(recorded)) {
      const [l, x] = k.split("/");
      check(lessons[l]?.[x]?.attempts === recorded[k], `attempts for ${k}: expected ${recorded[k]}, got ${lessons[l]?.[x]?.attempts}`, repro);
    }
    for (const rep of reps) {
      for (const k of Object.keys(rep.best)) {
        const [l, x] = k.split("/");
        const e = lessons[l]?.[x], b = rep.best[k];
        check(e && e.stars >= b.stars && e.bestWpm >= b.bestWpm && e.bestAccuracy >= b.bestAccuracy, `bests of ${rep.deviceId} for ${k} were lost`, repro);
      }
    }
  }
}
property(5, "convergence simulation (2-4 replicas, skewed clocks)", CASES, simulate);

// ---------------------------------------------------------------------------------------------
// 6. validateDoc
// ---------------------------------------------------------------------------------------------

const OPTS = { now: 1_000_000, maxFutureMs: 60_000 };
const okEntry = () => ({ stars: 1, bestWpm: 10, bestAccuracy: 90, completedAt: null, lastAt: 1, att: { d1: 1 } });
const withDoc = (patch) => ({ schema: 1, settings: {}, learn: {}, layouts: {}, lessons: { epoch: 0, by: {} }, ...patch });
const lessonDoc = (entryPatch) => withDoc({ lessons: { epoch: 0, by: { qwerty: { a: { ...okEntry(), ...entryPatch } } } } });
const many = (n, make) => Object.fromEntries(Array.from({ length: n }, (_, i) => ["k" + i, make(i)]));
const nested = (depth, leaf = 1) => { let v = leaf; for (let i = 0; i < depth; i++) v = [v]; return v; };
const cyclic = {}; cyclic.self = cyclic;
const throwing = withDoc({}); Object.defineProperty(throwing, "settings", { enumerable: true, get() { throw new Error("boom"); } });
const SECRET = "SECRET-user-content-\u{1F511}";

const MALFORMED = [
  ["null", null], ["undefined", undefined], ["string", "doc"], ["number", 1], ["boolean", true], ["array", []],
  ["array of docs", [withDoc({})]], ["function", () => 1], ["Date", new Date(0)], ["Map", new Map()],
  ["no schema", { settings: {} }], ["schema 2", withDoc({ schema: 2 })], ["schema '1'", withDoc({ schema: "1" })],
  ["settings array", withDoc({ settings: [] })], ["settings null", withDoc({ settings: null })], ["settings string", withDoc({ settings: "x" })],
  ["learn number", withDoc({ learn: 5 })], ["layouts array", withDoc({ layouts: [] })], ["lessons array", withDoc({ lessons: [] })],
  ["lessons null", withDoc({ lessons: null })],
  ["register not object", withDoc({ settings: { a: 1 } })], ["register array", withDoc({ settings: { a: [1, 2] } })],
  ["register null", withDoc({ settings: { a: null } })],
  ["register without v", withDoc({ settings: { a: { t: 1 } } })], ["register without t", withDoc({ settings: { a: { v: 1 } } })],
  ["register t string", withDoc({ settings: { a: { t: "1", v: 1 } } })], ["register t float", withDoc({ settings: { a: { t: 1.5, v: 1 } } })],
  ["register t negative", withDoc({ settings: { a: { t: -1, v: 1 } } })], ["register t NaN", withDoc({ settings: { a: { t: NaN, v: 1 } } })],
  ["register t Infinity", withDoc({ settings: { a: { t: Infinity, v: 1 } } })], ["register t 2^60", withDoc({ settings: { a: { t: 2 ** 60, v: 1 } } })],
  ["register t in future", withDoc({ settings: { a: { t: OPTS.now + OPTS.maxFutureMs + 1, v: 1 } } })],
  ["learn t in future", withDoc({ learn: { a: { t: OPTS.now * 2, v: 1 } } })],
  ["register v NaN", withDoc({ settings: { a: { t: 1, v: NaN } } })], ["register v -Infinity", withDoc({ settings: { a: { t: 1, v: [-Infinity] } } })],
  ["register v undefined", withDoc({ settings: { a: { t: 1, v: undefined } } })], ["register v function", withDoc({ settings: { a: { t: 1, v: () => 1 } } })],
  ["register v Date", withDoc({ settings: { a: { t: 1, v: new Date(0) } } })], ["register v bigint", withDoc({ settings: { a: { t: 1, v: 1n } } })],
  ["register v sparse array", withDoc({ settings: { a: { t: 1, v: new Array(3) } } })],
  ["register v oversize", withDoc({ settings: { a: { t: 1, v: "x".repeat(LIMITS.registerBytes) } } })],
  ["register v oversize utf8", withDoc({ settings: { a: { t: 1, v: "é".repeat(LIMITS.registerBytes / 2) } } })],
  ["register v too deep", withDoc({ settings: { a: { t: 1, v: nested(LIMITS.depth + 1) } } })],
  ["register v very deep", withDoc({ settings: { a: { t: 1, v: nested(20_000) } } })],
  ["register v cyclic", withDoc({ settings: { a: { t: 1, v: cyclic } } })],
  ["register v bad nested key", withDoc({ settings: { a: { t: 1, v: JSON.parse('{"x":{"__proto__":1}}') } } })],
  ["register v nested constructor", withDoc({ settings: { a: { t: 1, v: { constructor: 1 } } } })],
  ["register v long nested key", withDoc({ settings: { a: { t: 1, v: { ["k".repeat(LIMITS.keyLen + 1)]: 1 } } } })],
  ["too many registers", withDoc({ settings: many(LIMITS.registers + 1, () => ({ t: 1, v: 1 })) })],
  ["too many learn registers", withDoc({ learn: many(LIMITS.registers + 1, () => ({ t: 1, v: 1 })) })],
  ["empty key", withDoc({ settings: { "": { t: 1, v: 1 } } })], ["long key", withDoc({ settings: { ["k".repeat(LIMITS.keyLen + 1)]: { t: 1, v: 1 } } })],
  ["__proto__ key", JSON.parse('{"schema":1,"settings":{"__proto__":{"t":1,"v":1}}}')],
  ["__proto__ top level", JSON.parse('{"schema":1,"__proto__":{"settings":{}},"learn":{"__proto__":{"t":1,"v":1}}}')],
  ["constructor key", withDoc({ learn: { constructor: { t: 1, v: 1 } } })], ["prototype key", withDoc({ layouts: { prototype: { t: 1, del: true } } })],
  ["__proto__ layout id", JSON.parse('{"schema":1,"layouts":{"__proto__":{"t":1,"del":true}}}')],
  ["__proto__ lesson layout", JSON.parse('{"schema":1,"lessons":{"epoch":0,"by":{"__proto__":{}}}}')],
  ["__proto__ lesson id", JSON.parse('{"schema":1,"lessons":{"epoch":0,"by":{"q":{"__proto__":{}}}}}')],
  ["__proto__ device id", lessonDoc({ att: JSON.parse('{"__proto__":1}') })],
  ["__proto__ in layout value", withDoc({ layouts: { L1: { t: 1, v: JSON.parse('{"id":"L1","fingers":{"__proto__":{"x":1}}}') } } })],
  ["layout item not object", withDoc({ layouts: { L1: 1 } })], ["layout item array", withDoc({ layouts: { L1: [] } })],
  ["layout neither v nor del", withDoc({ layouts: { L1: { t: 1 } } })], ["layout del + v", withDoc({ layouts: { L1: { t: 1, del: true, v: { id: "L1" } } } })],
  ["layout del false", withDoc({ layouts: { L1: { t: 1, del: false } } })], ["layout del 1", withDoc({ layouts: { L1: { t: 1, del: 1 } } })],
  ["layout del 'true'", withDoc({ layouts: { L1: { t: 1, del: "true" } } })],
  ["layout v string", withDoc({ layouts: { L1: { t: 1, v: "x" } } })], ["layout v array", withDoc({ layouts: { L1: { t: 1, v: [] } } })],
  ["layout v null", withDoc({ layouts: { L1: { t: 1, v: null } } })],
  ["layout id mismatch", withDoc({ layouts: { L1: { t: 1, v: { id: "L2" } } } })], ["layout id not string", withDoc({ layouts: { L1: { t: 1, v: { id: 1 } } } })],
  ["layout t in future", withDoc({ layouts: { L1: { t: OPTS.now + OPTS.maxFutureMs + 1, del: true } } })],
  ["layout t missing", withDoc({ layouts: { L1: { del: true } } })],
  ["layout v oversize", withDoc({ layouts: { L1: { t: 1, v: { id: "L1", source: "x".repeat(LIMITS.layoutBytes) } } } })],
  ["layout v too deep", withDoc({ layouts: { L1: { t: 1, v: { id: "L1", x: nested(LIMITS.depth) } } } })],
  ["layout v NaN", withDoc({ layouts: { L1: { t: 1, v: { id: "L1", x: NaN } } } })],
  ["too many layouts", withDoc({ layouts: many(LIMITS.layouts + 1, () => ({ t: 1, del: true })) })],
  ["lessons without epoch", withDoc({ lessons: { by: {} } })], ["lessons without by", withDoc({ lessons: { epoch: 0 } })],
  ["epoch float", withDoc({ lessons: { epoch: 0.5, by: {} } })], ["epoch negative", withDoc({ lessons: { epoch: -1, by: {} } })],
  ["epoch in future", withDoc({ lessons: { epoch: OPTS.now * 3, by: {} } })], ["epoch string", withDoc({ lessons: { epoch: "0", by: {} } })],
  ["by array", withDoc({ lessons: { epoch: 0, by: [] } })], ["lesson layout array", withDoc({ lessons: { epoch: 0, by: { q: [] } } })],
  ["lesson entry null", withDoc({ lessons: { epoch: 0, by: { q: { a: null } } } })], ["lesson entry array", withDoc({ lessons: { epoch: 0, by: { q: { a: [] } } } })],
  ["too many lesson layouts", withDoc({ lessons: { epoch: 0, by: many(LIMITS.lessonLayouts + 1, () => ({})) } })],
  ["too many lessons", withDoc({ lessons: { epoch: 0, by: { q: many(LIMITS.lessonsPerLayout + 1, okEntry) } } })],
  ["stars 4", lessonDoc({ stars: 4 })], ["stars -1", lessonDoc({ stars: -1 })], ["stars 1.5", lessonDoc({ stars: 1.5 })],
  ["stars '1'", lessonDoc({ stars: "1" })], ["stars missing", lessonDoc({ stars: undefined })],
  ["wpm negative", lessonDoc({ bestWpm: -1 })], ["wpm 1001", lessonDoc({ bestWpm: 1001 })], ["wpm NaN", lessonDoc({ bestWpm: NaN })],
  ["wpm Infinity", lessonDoc({ bestWpm: Infinity })], ["wpm string", lessonDoc({ bestWpm: "10" })],
  ["accuracy 100.5", lessonDoc({ bestAccuracy: 100.5 })], ["accuracy negative", lessonDoc({ bestAccuracy: -0.1 })], ["accuracy null", lessonDoc({ bestAccuracy: null })],
  ["completedAt float", lessonDoc({ completedAt: 1.5 })], ["completedAt future", lessonDoc({ completedAt: OPTS.now * 2 })],
  ["completedAt undefined", lessonDoc({ completedAt: undefined })], ["completedAt string", lessonDoc({ completedAt: "1" })],
  ["lastAt null", lessonDoc({ lastAt: null })], ["lastAt future", lessonDoc({ lastAt: OPTS.now + OPTS.maxFutureMs + 1 })], ["lastAt negative", lessonDoc({ lastAt: -5 })],
  ["att missing", lessonDoc({ att: undefined })], ["att array", lessonDoc({ att: [1] })], ["att float", lessonDoc({ att: { d: 1.5 } })],
  ["att negative", lessonDoc({ att: { d: -1 } })], ["att too big", lessonDoc({ att: { d: LIMITS.maxAttempts + 1 } })], ["att string", lessonDoc({ att: { d: "1" } })],
  ["att NaN", lessonDoc({ att: { d: NaN } })], ["att too many devices", lessonDoc({ att: many(LIMITS.devices + 1, () => 1) })],
  ["att long device id", lessonDoc({ att: { ["d".repeat(LIMITS.keyLen + 1)]: 1 } })],
  ["throwing getter", throwing],
  ["throwing proxy", new Proxy({}, { getPrototypeOf() { throw new Error("boom"); }, ownKeys() { throw new Error("boom"); } })],
  ["secret in key", withDoc({ settings: { [SECRET + "x".repeat(80)]: { t: 1, v: 1 } } })],
  ["secret in value", withDoc({ settings: { a: { t: 1, v: { [SECRET]: NaN } } } })],
  ["secret as section", withDoc({ layouts: SECRET })],
];

const ACCEPTED = [
  ["schema only", { schema: 1 }, emptyDoc()],
  ["unknown top-level keys dropped", withDoc({ extra: { x: 1 }, schemaVersion: 9 }), emptyDoc()],
  ["unknown lesson field dropped", lessonDoc({ extra: 1, attempts: 5 }), lessonDoc({})],
  ["unknown register field dropped", withDoc({ settings: { a: { t: 1, v: 1, by: "dev" } } }), withDoc({ settings: { a: { t: 1, v: 1 } } })],
  ["unknown layout fields kept", withDoc({ layouts: { L1: { t: 1, v: { id: "L1", fingers: { KeyQ: 0 }, future: [1, { a: null }] } } } }), null],
  ["layout value without id", withDoc({ layouts: { L1: { t: 1, v: { name: "x" } } } }), null],
  ["limits exactly met", withDoc({
    settings: { ...many(LIMITS.registers - 1, () => ({ t: OPTS.now + OPTS.maxFutureMs, v: nested(LIMITS.depth) })), ["k".repeat(LIMITS.keyLen)]: { t: 0, v: "x".repeat(LIMITS.registerBytes - 2) } },
    layouts: { ...many(LIMITS.layouts - 1, () => ({ t: 1, del: true })), L1: { t: 1, v: { id: "L1", x: nested(LIMITS.depth - 1) } } },
    lessons: { epoch: 0, by: { q: { a: { stars: 3, bestWpm: 1000, bestAccuracy: 100, completedAt: 0, lastAt: 0, att: many(LIMITS.devices, () => LIMITS.maxAttempts) } } } },
  }), null],
  ["accuracy as fraction", lessonDoc({ bestAccuracy: 0.97 }), null],
  ["-0 normalised", withDoc({ settings: { a: { t: 1, v: [-0] } } }), withDoc({ settings: { a: { t: 1, v: [0] } } })],
];

function noAliasing(input, output, path = "doc") {
  if (output === null || typeof output !== "object") return null;
  if (output === input) return path;
  if (input === null || typeof input !== "object") return null;
  for (const k of Object.keys(output)) {
    const hit = noAliasing(input[k], output[k], path + "." + k);
    if (hit) return hit;
  }
  return null;
}

let staticDone = false;
property(6, "validateDoc: accepts valid docs, rejects malformed, total", CASES, (r) => {
  if (!staticDone) {
    staticDone = true;
    for (const [name, input] of MALFORMED) {
      let res;
      try {
        res = validateDoc(input, OPTS);
      } catch (e) {
        throw new Failure(`validateDoc threw on "${name}": ${e && e.message}`);
      }
      check(res && res.ok === false, `malformed input accepted: "${name}"`);
      check(typeof res.error === "string" && res.error.length > 0 && res.error.length <= 60 && /^[a-z0-9 :+']+$/i.test(res.error), `bad error string for "${name}": ${JSON.stringify(res.error)}`);
      check(!res.error.includes("SECRET"), `error echoes user content for "${name}"`);
    }
    for (const [name, input, expected] of ACCEPTED) {
      const res = validateDoc(input, OPTS);
      check(res.ok === true, `valid input rejected: "${name}" (${res.error})`);
      check(eq(res.doc, expected ?? input), `"${name}" was not normalised as expected`, { got: res.doc });
      check(Object.is(res.doc.schema, DOC_SCHEMA), "schema missing");
    }
    // Prototype pollution: rejected, and Object.prototype is untouched afterwards.
    const polluted = validateDoc(JSON.parse('{"schema":1,"settings":{"__proto__":{"t":1,"v":1}}}'), OPTS);
    check(polluted.ok === false, "__proto__ register accepted");
    check({}.t === undefined && {}.v === undefined && Object.getPrototypeOf({}) === Object.prototype, "Object.prototype was polluted");
    check(Object.keys(Object.prototype).length === 0, "Object.prototype gained keys");
    // Bad options must not turn into "accept everything".
    check(validateDoc(withDoc({ settings: { a: { t: 1, v: 1 } } }), { now: NaN, maxFutureMs: 0 }).ok === false, "NaN clock accepts timestamps");
    check(validateDoc(withDoc({}), undefined).ok === false, "missing opts accepted");
    check(TOMBSTONE_TTL_MS === 180 * 86_400_000 && CLIENT_TOMBSTONE_TTL_MS === 179 * 86_400_000 && LIMITS.docBytes === 262_144, "constants changed");
  }

  // Every generated doc validates and round-trips, as an object and after a JSON round trip.
  const doc = genDoc(r);
  const opts = { now: T_MAX, maxFutureMs: 0 };
  for (const input of [deepFreeze(clone(doc)), JSON.parse(JSON.stringify(doc))]) {
    const res = validateDoc(input, opts);
    check(res.ok === true, "generated doc rejected: " + res.error, { doc });
    check(docsEqual(res.doc, doc), "validateDoc changed a valid doc", { doc, got: res.doc });
    const alias = noAliasing(input, res.doc);
    check(alias === null, "validateDoc output aliases its input at " + alias, { doc });
    check(validateDoc(res.doc, opts).ok, "validateDoc output does not validate", { doc });
  }
  // So do merges of valid docs (validity is closed under merge).
  const m = mergeDocs(doc, genDoc(r));
  check(validateDoc(m, opts).ok, "merge of two valid docs is not valid", { doc: m });
  // One random corruption of a valid doc is rejected, without throwing.
  const bad = clone(doc);
  const kind = r.int(6);
  if (kind === 0) bad.settings.x = { t: T_MAX + 1, v: 1 };
  else if (kind === 1) bad.layouts.L9 = { t: 1, v: { id: "L1" } };
  else if (kind === 2) bad.lessons.epoch = 0.5;
  else if (kind === 3) (bad.lessons.by.q ??= {}).z = { ...genLessonEntry(r), stars: 7 };
  else if (kind === 4) bad.learn.x = { t: 1 };
  else bad.layouts.L9 = { t: 1, del: true, v: {} };
  let res;
  try {
    res = validateDoc(bad, opts);
  } catch (e) {
    throw new Failure("validateDoc threw: " + (e && e.message), { bad });
  }
  check(res.ok === false, "corrupted doc accepted (kind " + kind + ")", { bad });
});

// ---------------------------------------------------------------------------------------------
// 7. prune / clamp
// ---------------------------------------------------------------------------------------------

function maxTime(doc) {
  let m = doc.lessons.epoch;
  for (const s of [doc.settings, doc.learn, doc.layouts]) for (const k of Object.keys(s)) m = Math.max(m, s[k].t);
  for (const l of Object.keys(doc.lessons.by)) for (const x of Object.keys(doc.lessons.by[l])) m = Math.max(m, doc.lessons.by[l][x].lastAt, doc.lessons.by[l][x].completedAt ?? 0);
  return m;
}
property(7, "prune drops only old tombstones; clamp; no resurrection", CASES, (r) => {
  const a = genFrozenDoc(r), b = genFrozenDoc(r);
  const now = r.range(0, T_MAX + 2), ttl = r.range(0, 4);
  const p = pruneDoc(a, now, ttl);
  check(eq(p.settings, a.settings) && eq(p.learn, a.learn) && eq(p.lessons, a.lessons) && p.schema === 1, "prune touched something other than layouts", { a, now, ttl });
  for (const id of Object.keys(a.layouts)) {
    const item = a.layouts[id];
    const shouldDrop = isDel(item) && item.t < now - ttl;
    check(shouldDrop ? !(id in p.layouts) : eq(p.layouts[id], item), "prune kept/dropped the wrong item " + id, { a, now, ttl });
  }
  check(Object.keys(p.layouts).every((id) => id in a.layouts), "prune invented an item", { a, now, ttl });
  check(docsEqual(pruneDoc(p, now, ttl), p), "prune is not idempotent", { a, now, ttl });
  check(includesDoc(a, p), "pruned doc is not included in the original", { a, now, ttl });
  check(docsEqual(pruneDoc(a, now, Infinity), a) && docsEqual(pruneDoc(a, 0, 0), a), "prune with nothing expired changed the doc", { a });
  // The client prunes earlier than the server, so after both pruned, the server never lacks a
  // tombstone the client still has (same starting state).
  const clientTtl = Math.max(0, ttl - 1);
  check(includesDoc(pruneDoc(a, now, ttl), pruneDoc(a, now, clientTtl)), "client kept a tombstone the server dropped", { a, now, ttl });

  // Merging two pruned docs: a tombstone that is still present on either side keeps winning.
  const pa = pruneDoc(a, now, ttl), pb = pruneDoc(b, now, ttl);
  if (resurrects([pa, pb])) throw new Failure("merge after prune resurrected a layout under a present tombstone", { a, b, now, ttl });
  const m = mergeDocs(pa, pb);
  for (const id of Object.keys(m.layouts)) {
    if (isDel(m.layouts[id])) continue;
    for (const side of [pa, pb]) check(!(isDel(side.layouts[id]) && side.layouts[id].t >= m.layouts[id].t), "live item survived a tombstone that is not older", { a, b, now, ttl });
  }

  // clamp
  const top = maxTime(a);
  check(docsEqual(clampDocTimes(a, top), a) && docsEqual(clampDocTimes(a, top + 7), a), "clamp changed a doc that has no later timestamps", { a });
  const maxT = r.range(0, T_MAX);
  const c = clampDocTimes(a, maxT);
  check(maxTime(c) <= maxT, "clamp left a later timestamp", { a, maxT });
  check(docsEqual(clampDocTimes(c, maxT), c), "clamp is not idempotent", { a, maxT });
  check(validateDoc(c, { now: maxT, maxFutureMs: 0 }).ok, "clamped doc is not valid at now = maxT", { a, maxT });
  // Clamp only lowers timestamps: same keys, same values.
  const strip = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k === "t" || k === "epoch" || k === "lastAt" || k === "completedAt" ? (v === null ? null : 0) : v)));
  check(eq(strip(c), strip(a)), "clamp changed something other than timestamps", { a, maxT });
});

// ---------------------------------------------------------------------------------------------
// 8. project / absorb
// ---------------------------------------------------------------------------------------------

function genBaseView(r) {
  const v = emptyView(CONFIG);
  v.settings.fontSize = r.pick([16, 24, 40]);
  if (r.chance(0.5)) v.settings.theme = r.pick(["light", "dark"]);
  if (r.chance(0.5)) v.settings.customLayouts = LAYOUT_IDS.filter(() => r.chance(0.5)).reverse().map((id) => genLayoutValue(r, id));
  if (r.chance(0.3)) v.lessons = { qwerty: { a: { stars: 1, bestWpm: 5, bestAccuracy: 50, completedAt: null, attempts: 2, lastAt: 3 } } };
  if (r.chance(0.3)) v.learn.showHints = false;
  return deepFreeze(v);
}
property(8, "project -> absorb is a fixed point; local edits round-trip", CASES, (r) => {
  const doc = genFrozenDoc(r);
  const base = genBaseView(r);
  const now = r.pick([0, 3, 100]); // 0 and 3: a clock BEHIND the timestamps already in the doc
  const ctx = { now, deviceId: r.pick(DEVICES), config: CONFIG };
  const P = deepFreeze(projectDoc(doc, base, CONFIG));
  const repro = () => ({ doc, base, now, deviceId: ctx.deviceId });

  check(docsEqual(absorbView(doc, P, P, ctx), doc), "absorb(project(doc)) changed the doc", repro);
  check(docsEqual(absorbView(doc, P, clone(P), { ...ctx, now: now + 1000 }), doc), "absorb of an equal copy changed the doc", repro);
  check(eq(projectDoc(doc, P, CONFIG), P), "project is not idempotent", repro);
  for (const f of CONFIG.deviceLocal) check(eq(P.settings[f], base.settings[f]), "device-local field projected: " + f, repro);
  check(P.settings.customLayouts.every((l) => doc.layouts[l.id] && !isDel(doc.layouts[l.id])), "projected a layout that is not live", repro);
  check(Object.keys(doc.layouts).filter((id) => !isDel(doc.layouts[id])).every((id) => P.settings.customLayouts.some((l) => l.id === id)), "a live layout is missing from the projection", repro);
  // Relative order of layouts the device already had is kept.
  const order = P.settings.customLayouts.map((l) => l.id).filter((id) => base.settings.customLayouts.some((l) => l.id === id));
  check(eq(order, base.settings.customLayouts.map((l) => l.id).filter((id) => order.includes(id))), "layout order of the device changed", repro);
  // Two devices with the same doc agree on everything that syncs, whatever their device-local
  // fields, layout lists and lessons were before. (Fields the doc has no register for keep the base
  // value by design, so those are the same in both bases here.)
  const other = genBaseView(r);
  const base2 = { settings: { ...base.settings, fontSize: 99, showHands: 0, customLayouts: other.settings.customLayouts }, learn: base.learn, lessons: other.lessons };
  check(eq(comparableView(P), comparableView(projectDoc(doc, base2, CONFIG))), "projection depends on device-local state of the base view", repro);

  // Random local edits on top of P. After absorbing them, the doc must project back to exactly the
  // edited view (the local edit wins on this device, whatever the clock says) and include the old doc.
  const E = clone(P);
  const edits = r.range(1, 5);
  let reset = false;
  for (let i = 0; i < edits; i++) {
    const op = r.int(9);
    if (op === 0) E.settings.theme = r.pick(["x", "y", "dark"]);
    else if (op === 1) E.settings.testMode = r.pick(["time", "words"]);
    else if (op === 2) E.settings.testAmount = r.pick([15, 30, 60]);
    else if (op === 3) E.learn.showHints = r.chance(0.5);
    else if (op === 4) E.settings.fontSize = r.pick([18, 22]);
    else if (op === 5) {
      const id = r.pick([...LAYOUT_IDS, "L4"]);
      const i2 = E.settings.customLayouts.findIndex((l) => l.id === id);
      if (i2 >= 0) E.settings.customLayouts[i2] = genLayoutValue(r, id);
      else E.settings.customLayouts.push(genLayoutValue(r, id));
    } else if (op === 6) {
      const id = r.pick(LAYOUT_IDS);
      E.settings.customLayouts = E.settings.customLayouts.filter((l) => l.id !== id);
    } else if (op === 7) {
      const l = r.pick(LESSON_LAYOUTS), x = r.pick(LESSON_IDS);
      const prev = E.lessons[l]?.[x] ?? { stars: 0, bestWpm: 0, bestAccuracy: 0, completedAt: null, attempts: 0, lastAt: 0 };
      (E.lessons[l] ??= {})[x] = {
        stars: Math.max(prev.stars, r.range(0, 3)), bestWpm: Math.max(prev.bestWpm, r.range(0, 90)), bestAccuracy: Math.max(prev.bestAccuracy, r.range(0, 100)),
        completedAt: prev.completedAt ?? now, attempts: prev.attempts + 1, lastAt: Math.max(prev.lastAt, now),
      };
    } else if (!reset && i === 0 && r.chance(0.5)) {
      reset = true;
      E.lessons = {};
    }
  }
  deepFreeze(E);
  const doc2 = absorbView(doc, P, E, { ...ctx, lessonsReset: reset });
  const repro2 = () => ({ ...repro(), edited: E, reset });
  check(includesDoc(doc2, doc), "absorbing local edits lost remote state", repro2);
  check(eq(projectDoc(doc2, E, CONFIG), E), "absorbed edits do not project back to the edited view", () => ({ ...repro2(), got: projectDoc(doc2, E, CONFIG) }));
  check(docsEqual(absorbView(doc2, E, E, ctx), doc2), "second absorb is not a no-op", repro2);
  // Device-local edits never enter the doc.
  for (const f of CONFIG.deviceLocal) check(!(f in doc2.settings) || eq(doc2.settings[f], doc.settings[f]), "device-local field absorbed: " + f, repro2);
  if (eq(E, P) && !reset) check(docsEqual(doc2, doc), "no edit, but the doc changed", repro2);

  // First absorb on a device (seen = null) uses the legacy stamp: it never beats what the doc has.
  const first = absorbView(doc, null, base, ctx);
  check(includesDoc(first, doc), "legacy absorb lost state", repro);
  for (const k of Object.keys(doc.settings)) check(doc.settings[k].t < 1 || first.settings[k].t > 1 || eq(first.settings[k], doc.settings[k]) || doc.settings[k].t === 1, "legacy absorb overwrote a real register: " + k, repro);
  for (const s of ["settings", "learn", "layouts"]) for (const k of Object.keys(first[s])) check(eq(first[s][k], doc[s][k]) || first[s][k].t === 1, "legacy absorb used a real timestamp for " + k, repro);

  // Odd view contents never throw and never produce an invalid doc.
  const odd = {
    settings: { ...clone(P.settings), theme: undefined, weird: () => 1, nan: NaN, deep: nested(30), big: "x".repeat(5000), ["k".repeat(200)]: 1,
      customLayouts: [null, 5, "x", { name: "no id" }, { id: "" }, { id: 7 }, { id: "L1", source: "x".repeat(70_000) }, { id: "ok", f: undefined }, { id: "L2", bad: NaN }, { id: "L3", n: 1 }, { id: "L3", n: 2 }] },
    learn: null,
    lessons: { qwerty: { a: null, b: { stars: 99, bestWpm: -5, bestAccuracy: Infinity, completedAt: "x", attempts: 2.7, lastAt: NaN }, c: "x" }, L1: 5, ["k".repeat(200)]: { a: {} } },
  };
  Object.defineProperty(odd.settings, "__proto__", { value: 1, enumerable: true });
  let oddDoc;
  try {
    oddDoc = absorbView(doc, r.chance(0.5) ? P : null, odd, { now: 50, deviceId: r.chance(0.2) ? "__proto__" : "d9", config: CONFIG, lessonsReset: r.chance(0.2) });
    absorbView(doc, P, {}, ctx);
    absorbView(doc, {}, P, ctx);
    projectDoc(doc, {}, CONFIG);
    projectDoc(doc, odd, CONFIG);
  } catch (e) {
    throw new Failure("absorb/project threw on odd view contents: " + (e && e.stack), repro());
  }
  const res = validateDoc(clone(oddDoc), { now: 100, maxFutureMs: 0 });
  check(res.ok && docsEqual(res.doc, oddDoc), "odd view produced an invalid doc: " + (res.ok ? "normalised differently" : res.error), repro);
  check({}.t === undefined && Object.keys(Object.prototype).length === 0, "Object.prototype was polluted");
});

// ---------------------------------------------------------------------------------------------

const total = results.reduce((s, x) => s + x.ms, 0);
const count = results.reduce((s, x) => s + x.cases, 0);
if (failed) {
  console.log(`FAILED (seed ${SEED})`);
  process.exit(1);
}
console.log(`all ${results.length} properties passed: ${count} cases in ${(total / 1000).toFixed(2)} s (seed ${SEED})`);
