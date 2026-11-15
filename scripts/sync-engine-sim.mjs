// Simulation of the client sync engine's decision logic (lib/sync/cycle.ts) against a model server.
//
//   node scripts/sync-engine-sim.mjs [--runs 400] [--seed N] [--devices 3] [--ops 120]
//
// What is real: absorbLocal / integrateRemote / isRemoteDeleted / linkSidecar from cycle.ts and the
// whole core below it (doc.ts, view.ts). What is modelled: the stores (a plain view object per
// device), the server (GET / PUT with the route's compare-and-set + join semantics) and the engine's
// loop (GET -> integrate -> PUT -> integrate ...), which is cut into single steps so that the steps
// of different devices interleave arbitrarily, with local edits in between and with device clocks
// that are wrong by up to two hours before the first contact with the server.
//
// Checked after every run, once all devices have synced to quiescence:
//   1. convergence      every device's stores show the same synced data, every replica equals the
//                       server's document
//   2. no lost update   for every setting, the value written last (in true time, by a device that
//                       had synced at least once) is the final value
//   3. no resurrection  a layout whose last operation anywhere was a delete is gone everywhere;
//                       one whose last operation was a create / edit exists with that content
//   4. lessons          since the last reset, stars are the max of all results and the attempts
//                       are counted exactly once each
//   5. an idle device never PUTs (a cycle with nothing to push makes one GET)
// Needs Node >= 23.6 (imports the TypeScript sources directly through type stripping).

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => {
  if (/MODULE_TYPELESS_PACKAGE_JSON|Module type of file/.test(String(w) + JSON.stringify(rest))) return;
  return emitWarning.call(process, w, ...rest);
};

const D = await import("../lib/sync/doc.ts");
const C = await import("../lib/sync/cycle.ts");
const { emptyDoc, mergeDocs, pruneDoc, docsEqual, canonical, TOMBSTONE_TTL_MS, validateDoc } = D;
const { absorbLocal, integrateRemote, isRemoteDeleted, linkSidecar } = C;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
}
const RUNS = arg("--runs", 400);
const SEED = arg("--seed", 12345);
const DEVICES = arg("--devices", 3);
const OPS = arg("--ops", 120);

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONFIG = {
  deviceLocal: ["fontSize"],
  groups: [["testMode", "testAmount"]],
  layoutsField: "customLayouts",
  settingsDefaults: { theme: "tide", punctuation: false, testMode: "time", testAmount: 30, fontSize: 24, customLayouts: [] },
  learnDefaults: { camera: "angled" },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const USER = { id: "u_sim", name: "sim" };

function run(seed) {
  const rnd = prng(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let T = 1_800_000_000_000; // true time
  const tick = () => (T += 1 + Math.floor(rnd() * 5000));

  const server = { doc: null, version: 0, gen: null, puts: 0 };
  const get = () => ({ doc: server.doc, version: server.version, gen: server.gen, serverTime: T });
  const put = (body) => {
    const checked = validateDoc(body.doc, { now: T, maxFutureMs: 3_600_000 });
    if (!checked.ok) return { status: 400, detail: checked.error };
    if (server.version !== body.baseVersion || (server.doc !== null && body.gen !== null && body.gen !== server.gen)) {
      return { status: 409, body: get() };
    }
    server.doc = pruneDoc(mergeDocs(server.doc ?? emptyDoc(), checked.doc), T, TOMBSTONE_TTL_MS);
    server.version++;
    server.gen = server.gen ?? "g1";
    server.puts++;
    return { status: 200, body: get() };
  };

  const devices = [];
  for (let i = 0; i < DEVICES; i++) {
    devices.push({
      name: "dev" + i,
      skew: Math.floor((rnd() - 0.5) * 4 * 3_600_000),
      view: { settings: clone(CONFIG.settingsDefaults), learn: clone(CONFIG.learnDefaults), lessons: {} },
      sc: { v: 1, deviceId: "d_" + i, link: null, doc: emptyDoc(), seen: null, dirty: false, lessonsResetPending: false, lastSyncedAt: null, serverOffset: null, barrier: null },
      // in-flight request of the cycle that is under way: null | { kind: "get" | "put", response }
      flight: null,
      synced: false,
    });
  }
  const now = (d) => T + (d.sc.serverOffset === null ? d.skew : 0);
  // Ground truth for the invariants. An edit enters it when it is ABSORBED, because that is when
  // it gets its timestamp (the engine debounces; setting a value back to what the device last saw
  // is no edit at all). A key that was ever written before the device's first contact with the
  // server is not checked: that write carries an unverified clock (up to CLOCK_SLACK_MS ahead after
  // the clamp) and may legitimately beat later writes.
  const truth = { settings: {}, layouts: {}, lessons: {}, attempts: {} };
  const absorb = (d) => {
    const before = d.sc.doc;
    d.sc = absorbLocal(d.sc, clone(d.view), now(d), CONFIG);
    const tracked = d.sc.serverOffset !== null;
    for (const section of ["settings", "layouts"]) {
      for (const [key, item] of Object.entries(d.sc.doc[section])) {
        if (before[section][key] === item || canonical(before[section][key] ?? null) === canonical(item)) continue;
        truth[section][key] = {
          v: canonical(item.del ? null : item.v),
          untracked: !tracked || truth[section][key]?.untracked === true,
        };
      }
    }
  };

  let layoutSeq = 0;

  function localEdit(d) {
    tick();
    const kind = pick(["theme", "theme", "punct", "mode", "camera", "font", "addLayout", "editLayout", "delLayout", "lesson", "lesson", "reset"]);
    const s = d.view.settings;
    // A key that was ever written under an unverified clock is not checked: that write may carry a
    // timestamp up to CLOCK_SLACK_MS ahead and legitimately beat later writes.

    if (kind === "theme") {
      s.theme = pick(["tide", "paper", "dusk", "moss"]) + Math.floor(rnd() * 3);
    } else if (kind === "punct") {
      s.punctuation = !s.punctuation;
    } else if (kind === "mode") {
      s.testMode = pick(["time", "words"]);
      s.testAmount = pick([10, 15, 30, 60]);
    } else if (kind === "camera") {
      d.view.learn.camera = pick(["angled", "top"]) + Math.floor(rnd() * 3);
    } else if (kind === "font") {
      s.fontSize = 16 + Math.floor(rnd() * 20);
    } else if (kind === "addLayout") {
      const id = "L" + layoutSeq++;
      s.customLayouts.push({ id, name: id, source: "v0" });
    } else if (kind === "editLayout" && s.customLayouts.length) {
      const l = pick(s.customLayouts);
      l.source = "v" + Math.floor(rnd() * 1000);
    } else if (kind === "delLayout" && s.customLayouts.length) {
      const l = pick(s.customLayouts);
      s.customLayouts = s.customLayouts.filter((x) => x !== l);
    } else if (kind === "lesson") {
      const id = pick(["a", "b", "c"]);
      const forLayout = (d.view.lessons.qwerty ??= {});
      const prev = forLayout[id];
      const stars = Math.floor(rnd() * 4);
      forLayout[id] = {
        stars: Math.max(prev?.stars ?? 0, stars),
        bestWpm: Math.max(prev?.bestWpm ?? 0, Math.floor(rnd() * 100)),
        bestAccuracy: 100,
        completedAt: prev?.completedAt ?? (stars > 0 ? T : null),
        attempts: (prev?.attempts ?? 0) + 1,
        lastAt: T,
      };
      truth.lessons[id] = Math.max(truth.lessons[id] ?? 0, stars);
      truth.attempts[id] = (truth.attempts[id] ?? 0) + 1;
    } else if (kind === "reset" && d.synced && rnd() < 0.15) {
      // Only modelled on a device that is linked and in sync with the server, where "everything
      // before the reset is gone" is well defined.
      syncAll();
      tick();
      d.view.lessons = {};
      d.sc = { ...d.sc, lessonsResetPending: true };
      truth.lessons = {};
      truth.attempts = {};
      // Results recorded on a device that has not seen the reset yet are discarded with the old
      // epoch (core semantics, doc.ts), so let every device see it before the run goes on.
      syncAll();
    }
    // The debounced absorb, sometimes skipped (the edit is then absorbed by the next cycle step).
    if (rnd() < 0.7) absorb(d);
  }

  /** The stores' write + read-back: here the store keeps exactly what is projected. */
  function integrate(d, remote) {
    if (d.sc.link === null) d.sc = linkSidecar(d.sc, USER);
    if (isRemoteDeleted(d.sc.link, remote)) throw new Error("unexpected remote-deleted");
    d.sc = { ...d.sc, serverOffset: 0 };
    absorb(d); // integrateRemote absorbs as well; done here first only to observe what it stamps
    const out = integrateRemote(d.sc, clone(d.view), remote, now(d), CONFIG);
    d.view = clone(out.projected);
    d.sc = { ...out.sidecar, seen: clone(d.view) };
    d.synced = true;
    return out.needPush;
  }

  /** One step of device d's cycle: issue a request, or handle the response of the one in flight. */
  function step(d) {
    tick();
    if (d.flight === null) {
      absorb(d);
      d.flight = { kind: "get", response: { status: 200, body: clone(get()) } };
      return;
    }
    const { response } = d.flight;
    d.flight = null;
    if (response.status === 400) throw new Error("server rejected the document: " + response.detail);
    const needPush = integrate(d, response.body);
    if (!needPush) return;
    const body = { baseVersion: d.sc.link.version, gen: d.sc.link.gen, doc: clone(d.sc.doc) };
    d.flight = { kind: "put", response: clone(put(body)) };
  }

  function syncAll() {
    for (let round = 0; round < 50; round++) {
      for (const d of devices) while (d.flight !== null) step(d);
      const before = server.puts;
      for (const d of devices) {
        absorb(d);
        do step(d);
        while (d.flight !== null);
      }
      if (server.puts === before && devices.every((d) => !d.sc.dirty)) return;
    }
    throw new Error("no quiescence after 50 rounds");
  }

  for (let i = 0; i < OPS; i++) {
    const d = pick(devices);
    if (rnd() < 0.55) localEdit(d);
    else step(d);
  }
  syncAll();

  // 5. idle devices never PUT
  const putsBefore = server.puts;
  for (const d of devices) {
    do step(d);
    while (d.flight !== null);
  }
  if (server.puts !== putsBefore) throw new Error("an idle cycle made a PUT");

  // 1. convergence
  const synced = (v) => canonical({ ...v, settings: { ...v.settings, fontSize: 0, customLayouts: [...v.settings.customLayouts].sort((a, b) => (a.id < b.id ? -1 : 1)) } });
  for (const d of devices) {
    if (synced(d.view) !== synced(devices[0].view)) throw new Error(`views differ: ${d.name} vs dev0`);
    if (!docsEqual(d.sc.doc, pruneDoc(server.doc, T, D.CLIENT_TOMBSTONE_TTL_MS))) throw new Error(`replica of ${d.name} differs from the server`);
    if (d.sc.dirty) throw new Error(`${d.name} still dirty`);
  }
  const final = devices[0].view;
  // 2. no lost update (only keys whose every write came from a device with a verified clock)
  for (const [key, t] of Object.entries(truth.settings)) {
    if (t.untracked) continue;
    const got =
      key === "testMode+testAmount"
        ? canonical({ testMode: final.settings.testMode, testAmount: final.settings.testAmount })
        : canonical(final.settings[key]);
    if (got !== t.v) throw new Error(`lost update on ${key}: expected ${t.v}, got ${got}`);
  }
  // 3. no resurrection
  for (const [id, t] of Object.entries(truth.layouts)) {
    if (t.untracked) continue;
    const got = final.settings.customLayouts.find((l) => l.id === id);
    if (t.v === "null" && got) throw new Error(`layout ${id} was deleted last but exists`);
    if (t.v !== "null" && (!got || canonical(got) !== t.v)) throw new Error(`layout ${id}: expected ${t.v}, got ${got && canonical(got)}`);
  }
  // 4. lessons
  for (const id of ["a", "b", "c"]) {
    const got = final.lessons.qwerty?.[id];
    if ((got?.stars ?? 0) !== (truth.lessons[id] ?? 0)) throw new Error(`lesson ${id}: stars ${got?.stars} != ${truth.lessons[id]}`);
    if ((got?.attempts ?? 0) !== (truth.attempts[id] ?? 0)) throw new Error(`lesson ${id}: attempts ${got?.attempts} != ${truth.attempts[id]}`);
  }
}

let failed = 0;
for (let i = 0; i < RUNS; i++) {
  const seed = SEED + i * 7919;
  try {
    run(seed);
  } catch (e) {
    failed++;
    console.log(`FAIL seed ${seed}: ${e.message}`);
    if (failed >= 5) break;
  }
}
console.log(failed ? `${failed} failing run(s)` : `ok: ${RUNS} runs x ${OPS} ops x ${DEVICES} devices, seed ${SEED}`);
process.exit(failed ? 1 : 0);
