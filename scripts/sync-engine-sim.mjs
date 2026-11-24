// Simulation of the client sync engine's decision logic (lib/sync/cycle.ts) against a model server.
//
//   node scripts/sync-engine-sim.mjs [--runs 400] [--seed N] [--devices 3] [--ops 120] [--only scenarios|random]
//
// What is real: everything in cycle.ts (trackLocal / integrateRemote / redoApply / link, unlink,
// adopt, rebuild, local reset), parseSidecar from meta.ts and the whole core below (doc.ts, view.ts).
// What is modelled, each as closely to lib/sync/engine.ts and lib/sync/local.ts as a few lines allow:
//
//   stores    per device, three "localStorage keys" that can be LOST (null) or partial; a read
//             answers with defaults for what is missing and says which fields it can vouch for
//             (readStores), exactly the situation in which made-up defaults must not become edits
//   engine    load -> finish an interrupted projection -> absorb / restore (absorbNow), the
//             write-ahead marker around every store write (commit) with injectable crashes, sign-in
//             with the "whose data is this" decision (evaluate), mismatch resolution, reset progress
//             (account vs local), delete account data, and the GET -> integrate -> PUT loop
//   server    one document per account: compare-and-set, join, prune, limits (the route's PUT)
//
// PART 1, scenarios: one deterministic story per finding of the sync review. Each asserts the
// DOCUMENTED behaviour and fails on the code as it was before the fix.
//
// PART 2, random runs: devices with clocks wrong by up to two hours before their first contact,
// requests cut into single steps so that devices interleave arbitrarily, stores that lose keys,
// lost sidecars, and "Reset progress" at any moment. Checked after every run:
//   1. convergence      every device's stores show the same synced data, every replica equals the
//                       server's document
//   2. no lost update   per setting / layout the write with the highest EFFECTIVE stamp is the final
//                       value. A write made before its device first met the account keeps its stamp
//                       unless that is more than FIRST_CONTACT_TOLERANCE_MS ahead of the server at
//                       that moment; then its age is unverifiable and it counts as oldest (stamp 1).
//   3. no resurrection  a layout whose winning write is a delete is gone everywhere
//   4. lessons          stars are the max and attempts are counted EXACTLY once each, over the
//                       results recorded under the final lessons epoch. Documented and inherent: a
//                       result that a device records before it has LEARNT of another device's reset
//                       belongs to the old epoch and is discarded. Nothing else is ever discarded.
//   5. an idle device never PUTs, and losing a store key or the sidecar changes nothing in the account
// Needs Node >= 23.6 (imports the TypeScript sources directly through type stripping).

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => {
  if (/MODULE_TYPELESS_PACKAGE_JSON|Module type of file/.test(String(w) + JSON.stringify(rest))) return;
  return emitWarning.call(process, w, ...rest);
};

const D = await import("../lib/sync/doc.ts");
const C = await import("../lib/sync/cycle.ts");
const M = await import("../lib/sync/meta.ts");
const { normalizeThemeId } = await import("../lib/settings/themes.ts");
const { emptyDoc, mergeDocs, pruneDoc, docsEqual, canonical, TOMBSTONE_TTL_MS, CLIENT_TOMBSTONE_TTL_MS, validateDoc, LIMITS } = D;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
}
const RUNS = Number(arg("--runs", 400));
const SEED = Number(arg("--seed", 12345));
const DEVICES = Number(arg("--devices", 3));
const OPS = Number(arg("--ops", 120));
const ONLY = arg("--only", "");

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
  settingsDefaults: { theme: "blueprint", punctuation: false, testMode: "time", testAmount: 30, fontSize: 24, customLayouts: [] },
  learnDefaults: { camera: "angled" },
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => canonical(a) === canonical(b);
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------
// The model: world (time + accounts), devices (stores + sidecar), engine
// ---------------------------------------------------------------------------------------------

function makeWorld() {
  const w = { T: 1_800_000_000_000, accounts: new Map(), devices: [], hooks: {} };

  const account = (uid) => {
    if (!w.accounts.has(uid)) w.accounts.set(uid, { doc: null, version: 0, gen: null, genSeq: 0, puts: 0 });
    return w.accounts.get(uid);
  };
  w.account = account;
  w.get = (uid) => {
    const s = account(uid);
    return { doc: s.doc, version: s.version, gen: s.gen, serverTime: w.T };
  };
  w.put = (uid, body) => {
    const s = account(uid);
    const checked = validateDoc(body.doc, { now: w.T, maxFutureMs: 3_600_000 });
    if (!checked.ok) return { status: 400, detail: checked.error };
    if (s.version !== body.baseVersion || (s.doc !== null && body.gen !== null && body.gen !== s.gen)) return { status: 409, body: w.get(uid) };
    const joined = pruneDoc(mergeDocs(s.doc ?? emptyDoc(), checked.doc), w.T, TOMBSTONE_TTL_MS);
    if (!validateDoc(joined, { now: w.T, maxFutureMs: DAY }).ok) return { status: 413, detail: "limit_exceeded" };
    s.doc = joined;
    s.version++;
    s.gen = s.gen ?? "g" + ++s.genSeq;
    s.puts++;
    return { status: 200, body: w.get(uid) };
  };
  w.erase = (uid) => {
    const s = account(uid);
    s.doc = null;
    s.version = 0;
    s.gen = null;
  };

  // --- device ---------------------------------------------------------------------------------
  w.device = (name, skew = 0) => {
    const d = {
      name,
      skew,
      ids: 0,
      user: null,
      // The three localStorage keys. null = the key is gone. A settings / learn object may lack fields.
      store: { settings: clone(CONFIG.settingsDefaults), learn: clone(CONFIG.learnDefaults), lessons: {} },
      acked: {},
      sc: null,
    };
    freshSidecar(d);
    w.devices.push(d);
    track(d); // the engine absorbs once on start
    return d;
  };
  const newId = (d) => `d_${d.name}_${d.ids++}`;
  function freshSidecar(d) {
    d.sc = { v: 1, deviceId: newId(d), link: null, orphanOf: null, doc: emptyDoc(), seen: null, dirty: false, lessonsResetPending: false, lastSyncedAt: null, serverOffset: null, barrier: null, applying: null };
  }
  const now = (d) => w.T + (d.sc.serverOffset === null ? d.skew : 0);

  /** readStores(): defaults for what is missing; `known` = only what the key really holds. */
  function read(d) {
    const part = (key, defaults) => {
      const raw = d.store[key];
      const value = { ...clone(defaults), ...(raw === null ? {} : clone(raw)) };
      const trusted = d.acked[key] === JSON.stringify(raw);
      return { value, known: trusted ? value : raw === null ? {} : clone(raw) };
    };
    const s = part("settings", CONFIG.settingsDefaults);
    const l = part("learn", CONFIG.learnDefaults);
    const lessons = clone(d.store.lessons ?? {});
    const view = { settings: s.value, learn: l.value, lessons };
    const full = Object.keys(s.known).length === Object.keys(s.value).length && Object.keys(l.known).length === Object.keys(l.value).length;
    const lessonsOk = d.store.lessons !== null || d.acked.lessons === "null";
    return full ? { view, known: view, gaps: !lessonsOk } : { view, known: { settings: s.known, learn: l.known, lessons }, gaps: true };
  }
  const ack = (d) => {
    for (const key of ["settings", "learn", "lessons"]) d.acked[key] = JSON.stringify(d.store[key]);
  };
  /** writeView(): a store is only written when its value differs; it then persists the whole object. */
  function write(d, target, current) {
    for (const key of ["settings", "learn", "lessons"]) if (!same(target[key], current[key])) d.store[key] = clone(target[key]);
  }
  /** commit(): marker -> stores -> sidecar. `crash` cuts it short where a tab could die. */
  function commit(d, next, target, current, mode, marked = false, crash = null) {
    if (!marked && C.sameView(target, current)) {
      d.sc = { ...next, seen: current, applying: null };
      ack(d);
      return;
    }
    d.sc = { ...next, applying: mode };
    if (crash === "before-stores") return;
    write(d, target, current);
    if (crash === "after-stores") return;
    d.sc = { ...next, seen: read(d).view, applying: null };
    ack(d);
  }
  /** load(): an interrupted projection is finished before anything else. */
  function ready(d) {
    if (!d.sc.applying) return;
    const rd = read(d);
    const out = C.redoApply(d.sc, rd.view, now(d), CONFIG);
    commit(d, out.sidecar, out.projected, rd.view, d.sc.applying, true);
  }
  /** absorbNow() */
  function track(d) {
    ready(d);
    const before = d.sc.doc;
    const rd = read(d);
    const out = C.trackLocal(d.sc, rd, now(d), CONFIG);
    if (out.restore !== null) commit(d, out.sidecar, out.restore, rd.view, "merge");
    else {
      d.sc = out.sidecar;
      ack(d);
    }
    if (w.hooks.absorbed) w.hooks.absorbed(d, before);
  }
  const canSync = (d) => d.user !== null && d.sc.link !== null && d.sc.link.userId === d.user.id;

  /** applyRemote() */
  function integrate(d, remote, crash = null) {
    ready(d);
    if (C.isRemoteDeleted(d.sc.link, remote)) {
      d.sc = C.unlinkSidecar(d.sc, "session");
      d.user = null;
      return "deleted";
    }
    const first = !d.sc.link.clockChecked;
    d.sc = { ...d.sc, serverOffset: 0 };
    const rd = read(d);
    const out = C.integrateRemote(d.sc, rd.view, remote, w.T, CONFIG, rd.known);
    commit(d, out.sidecar, out.projected, rd.view, "merge", false, crash);
    if (first && w.hooks.firstContact) w.hooks.firstContact(d, remote);
    return out;
  }

  /** evaluate(): "ok" = linked to the signed-in user, "mismatch" = the user has to choose. */
  function signIn(d, user) {
    d.user = user;
    track(d);
    const owner = C.localOwner(d.sc);
    if (owner !== null && owner.userId !== user.id) return "mismatch";
    if (d.sc.link === null) d.sc = C.linkSidecar(d.sc, user);
    return "ok";
  }
  function resolve(d, choice) {
    if (choice === "cancel") d.user = null;
    else if (choice === "merge") d.sc = C.linkSidecar(d.sc, d.user);
    else {
      const rd = read(d);
      const out = C.adoptAccount({ ...d.sc, serverOffset: 0 }, rd.view, clone(w.get(d.user.id)), w.T, CONFIG, d.user);
      commit(d, out.sidecar, out.projected, rd.view, "replace");
    }
  }
  function signOut(d) {
    track(d);
    d.user = null;
  }
  /** "Reset progress": the store's key is removed, then onLessonsReset decides what it means. */
  function resetLessons(d) {
    ready(d);
    d.store.lessons = null;
    d.sc = canSync(d) && C.hasMetAccount(d.sc) ? { ...d.sc, lessonsResetPending: true } : C.resetLessonsLocal(d.sc, newId(d));
    track(d);
  }
  /** deleteAccountData() */
  function deleteAccount(d) {
    w.erase(d.user.id);
    d.sc = C.unlinkSidecar(d.sc, "session");
    d.user = null;
  }
  /** The sidecar key is gone (the stores are not): a new device id, nothing known, signed out. */
  function loseSidecar(d) {
    freshSidecar(d);
    d.user = null;
    track(d);
  }
  /** A whole cycle: GET, then integrate / PUT until the server lacks nothing (at most 5 rounds). */
  function sync(d, maxRounds = 5) {
    if (!canSync(d)) return { skipped: true };
    track(d);
    let remote = w.get(d.user.id);
    let puts = 0;
    for (let round = 1; round <= maxRounds; round++) {
      const out = integrate(d, clone(remote));
      if (out === "deleted") return { deleted: true };
      if (!out.needPush) return { rounds: round, puts, settled: true, overflow: out.overflow };
      const res = w.put(d.user.id, { baseVersion: d.sc.link.version, gen: d.sc.link.gen, doc: clone(out.push) });
      puts++;
      if (res.status !== 200 && res.status !== 409) return { rounds: round, puts, error: res.detail };
      remote = res.body;
    }
    return { rounds: maxRounds, puts, settled: false };
  }

  Object.assign(w, { now, read, track, integrate, signIn, resolve, signOut, resetLessons, deleteAccount, loseSidecar, sync, canSync, newId, commit });
  return w;
}

// ---------------------------------------------------------------------------------------------
// PART 1: scenarios
// ---------------------------------------------------------------------------------------------

const UA = { id: "u_a", name: "Ann" };
const UB = { id: "u_b", name: "Bob" };
const layout = (id, name = id) => ({ id, name, source: "[]" });
const lesson = (attempts, stars = 1) => ({ stars, bestWpm: 30, bestAccuracy: 95, completedAt: 1_799_000_000_000, attempts, lastAt: 1_799_000_000_000 });
const expect = (cond, message, detail) => {
  if (!cond) throw new Error(message + (detail === undefined ? "" : " -- " + JSON.stringify(detail)));
};
const settled = (r, what) => expect(r.settled === true, what + " did not settle", r);
const shown = (w, d) => w.read(d).view;
const layoutsOf = (w, d) => shown(w, d).settings.customLayouts.map((l) => l.id).sort();
const attemptsOf = (w, d, id) => shown(w, d).lessons.qwerty?.[id]?.attempts ?? 0;
/** Two devices of account A, in sync, with settings, layouts and lesson progress. */
function pair() {
  const w = makeWorld();
  const a = w.device("A");
  const b = w.device("B");
  Object.assign(a.store.settings, { theme: "whiteprint", testMode: "words", testAmount: 50, punctuation: true, customLayouts: [layout("x"), layout("y")] });
  a.store.learn.camera = "top";
  a.store.lessons = { qwerty: { l1: lesson(5, 2) } };
  w.signIn(a, UA);
  settled(w.sync(a), "A");
  w.signIn(b, UA);
  settled(w.sync(b), "B");
  w.T += DAY;
  return { w, a, b };
}
const bothSync = (w, ...devices) => {
  for (let i = 0; i < 2; i++) for (const d of devices) settled(w.sync(d), d.name);
};

const scenarios = {
  "T0 a retired theme id read from storage or the account becomes its successor"() {
    // The real normalisation (lib/settings/themes.ts), the one store.ts applies when it reads settings.
    expect(normalizeThemeId("tide") === "blueprint", 'stored "tide" was not read back as blueprint', normalizeThemeId("tide"));
    expect(normalizeThemeId("paper") === "whiteprint", 'stored "paper" was not read back as whiteprint', normalizeThemeId("paper"));
    expect(normalizeThemeId("blueprint") === "blueprint" && normalizeThemeId("nonsense") === null, "current ids must pass through and unknown ids be rejected");
  },
  "C1 a lost settings / learn key is restored, not synced as a reset"() {
    for (const loss of [null, {}, { fontSize: 30 }]) {
      const { w, a, b } = pair();
      a.store.settings = loss === null ? null : clone(loss); // evicted, or replaced by something with no usable field
      a.store.learn = null;
      a.acked = {};
      w.track(a); // the page loads
      expect(shown(w, a).settings.theme === "whiteprint" && layoutsOf(w, a).join() === "x,y" && shown(w, a).learn.camera === "top", "the device did not get its data back", shown(w, a));
      bothSync(w, a, b);
      const s = shown(w, b).settings;
      expect(s.theme === "whiteprint" && s.testMode === "words" && s.testAmount === 50 && s.punctuation === true, "the other device was reset to defaults", s);
      expect(layoutsOf(w, b).join() === "x,y" && shown(w, b).learn.camera === "top", "the other device lost layouts / prefs", shown(w, b));
      expect(Object.values(w.account("u_a").doc.layouts).every((i) => !i.del), "the account holds tombstones nobody asked for");
      expect(w.account("u_a").puts === 1, "something was uploaded because of the loss", w.account("u_a").puts);
    }
  },
  "C1 lost lesson key, and a lost key on a device that never signed in"() {
    const { w, a, b } = pair();
    a.store.lessons = null;
    a.acked = {};
    w.track(a);
    expect(attemptsOf(w, a, "l1") === 5, "lesson progress was not restored from the replica");
    bothSync(w, a, b);
    expect(attemptsOf(w, b, "l1") === 5, "lesson progress changed on the other device");
    // Anonymous device: tracked edits survive the loss of the key as well.
    const c = w.device("C");
    c.store.settings.theme = "whiteprint";
    c.store.settings.customLayouts = [layout("c1")];
    w.track(c);
    c.store.settings = null;
    c.acked = {};
    w.track(c);
    expect(shown(w, c).settings.theme === "whiteprint" && layoutsOf(w, c).join() === "c1", "anonymous device was not restored", shown(w, c).settings);
  },
  "C1 the legitimate flows still sync: reset settings, delete the last layout"() {
    const { w, a, b } = pair();
    // Reset settings writes the complete default object (and the UI keeps the layouts).
    a.store.settings = { ...clone(CONFIG.settingsDefaults), customLayouts: a.store.settings.customLayouts };
    bothSync(w, a, b);
    expect(shown(w, b).settings.theme === "blueprint" && shown(w, b).settings.testMode === "time", "reset settings did not sync", shown(w, b).settings);
    expect(layoutsOf(w, b).join() === "x,y", "reset settings removed layouts");
    w.T += 1000;
    a.store.settings.customLayouts = [];
    bothSync(w, a, b);
    expect(layoutsOf(w, b).length === 0, "deleting every layout did not sync");
    expect(Object.values(w.account("u_a").doc.layouts).every((i) => i.del === true), "deleted layouts have no tombstones");
  },
  "H1a an anonymous device joins an account that once reset its progress: union"() {
    const w = makeWorld();
    const a = w.device("A");
    a.store.lessons = { qwerty: { l1: lesson(5) } };
    w.signIn(a, UA);
    settled(w.sync(a), "A");
    w.T += 1000;
    w.resetLessons(a);
    settled(w.sync(a), "A");
    expect(w.account("u_a").doc.lessons.epoch > 0, "the account reset did not bump the epoch");
    const k = w.device("K");
    k.store.lessons = { qwerty: { lx: lesson(40, 3), ly: lesson(10, 3) } };
    w.track(k);
    w.T += 1000;
    w.signIn(k, UA);
    bothSync(w, k, a);
    expect(attemptsOf(w, k, "lx") === 40 && attemptsOf(w, k, "ly") === 10, "the device's progress was wiped on sign-in", shown(w, k).lessons);
    expect(attemptsOf(w, a, "lx") === 40 && attemptsOf(w, a, "ly") === 10, "the device's progress did not reach the account", shown(w, a).lessons);
  },
  "H1b merging another account's device adds to the account and removes nothing"() {
    const w = makeWorld();
    const x = w.device("X"); // account A, which has reset its progress once
    x.store.lessons = { qwerty: { l1: lesson(2) } };
    w.signIn(x, UA);
    settled(w.sync(x), "X");
    w.T += 1000;
    w.resetLessons(x);
    x.store.lessons = { qwerty: { l1: lesson(1), l9: lesson(3, 2) } };
    settled(w.sync(x), "X");
    const b1 = w.device("B1"); // account B, never reset: epoch 0
    b1.store.lessons = { qwerty: { l1: lesson(40, 3), l2: lesson(10, 3), l3: lesson(7, 2) } };
    w.signIn(b1, UB);
    settled(w.sync(b1), "B1");
    w.signOut(x);
    w.T += 5000;
    expect(w.signIn(x, UB) === "mismatch", "another account's data was not gated");
    expect(w.sync(x).skipped === true, "synced while the mismatch was undecided");
    w.resolve(x, "merge");
    bothSync(w, x, b1);
    const got = shown(w, b1).lessons.qwerty;
    expect(got.l1.attempts === 41 && got.l2.attempts === 10 && got.l3.attempts === 7 && got.l9.attempts === 3, "merge did not produce the union of both sides", got);
    expect(got.l1.stars === 3, "merge lowered a best", got.l1);
    expect(same(shown(w, x).lessons, shown(w, b1).lessons), "devices differ after the merge");
  },
  "H1c reset progress on a signed-out device is local; the account keeps everything"() {
    const { w, a, b } = pair();
    w.signOut(b);
    w.resetLessons(b); // "in this browser"
    expect(attemptsOf(w, b, "l1") === 0, "the local reset did not empty the device");
    expect(b.sc.doc.lessons.epoch === 0, "a signed-out reset bumped the epoch", b.sc.doc.lessons.epoch);
    w.T += DAY;
    b.store.lessons = { qwerty: { l1: lesson(1) } }; // one more attempt after the local reset
    w.track(b);
    a.store.lessons.qwerty.l2 = lesson(9, 3);
    settled(w.sync(a), "A");
    w.T += DAY;
    w.signIn(b, UA);
    bothSync(w, b, a);
    expect(attemptsOf(w, a, "l1") === 6 && attemptsOf(w, a, "l2") === 9, "the account lost lessons / attempts to a signed-out reset", shown(w, a).lessons);
    expect(same(shown(w, a).lessons, shown(w, b).lessons), "the account's lessons did not come back to the reset device");
    // The same reset while signed in IS an account reset.
    w.T += 1000;
    w.resetLessons(b);
    bothSync(w, b, a);
    expect(same(shown(w, a).lessons, {}), "a signed-in reset did not reach the other device", shown(w, a).lessons);
  },
  "H2 a field the snapshot does not know never overrides another device"() {
    const { w, a, b } = pair();
    a.store.settings.newField = "default"; // the upgraded app adds a field with its default ...
    settled(w.sync(a), "A");
    w.T += 1000;
    a.store.settings.newField = "chosen"; // ... and the user picks something
    settled(w.sync(a), "A");
    w.T += DAY;
    b.store.settings.newField = "default"; // B upgrades a day later
    delete b.sc.seen.settings.punctuation; // and its snapshot predates another field
    bothSync(w, b, a);
    expect(shown(w, a).settings.newField === "chosen", "a default from an upgrading device overrode a choice", w.account("u_a").doc.settings.newField);
    expect(shown(w, a).settings.punctuation === true && shown(w, b).settings.punctuation === true, "a field missing from the snapshot was stamped as an edit");
  },
  "M1 attempts are counted once: rebuilt replica, lost sidecar, interrupted projection"() {
    const { w, a, b } = pair();
    b.store.lessons.qwerty.l1.attempts += 5;
    bothSync(w, b, a);
    expect(attemptsOf(w, a, "l1") === 10, "setup", shown(w, a).lessons);
    // (i) the stored replica cannot be read back
    const raw = JSON.parse(M.serializeSidecar(a.sc));
    raw.doc.lessons = "garbage";
    const parsed = M.parseSidecar(JSON.stringify(raw), w.newId(a));
    expect(parsed.kind === "ok" && parsed.sidecar.seen === null && parsed.sidecar.link.clockChecked === false, "a broken replica was not rebuilt as a first contact", parsed);
    a.sc = parsed.sidecar;
    w.track(a);
    bothSync(w, a, b);
    expect(attemptsOf(w, a, "l1") === 10 && attemptsOf(w, b, "l1") === 10, "a rebuilt replica counted attempts again", w.account("u_a").doc.lessons.by.qwerty.l1.att);
    // (ii) the sidecar is gone, the stores are not; twice
    for (let i = 0; i < 2; i++) {
      w.loseSidecar(a);
      a.store.lessons.qwerty.l1.attempts += 1; // one real attempt while signed out
      w.track(a);
      expect(w.signIn(a, UA) === "ok", "sign-in after sidecar loss");
      bothSync(w, a, b);
      expect(attemptsOf(w, b, "l1") === 11 + i, "a lost sidecar inflated the attempts", w.account("u_a").doc.lessons.by.qwerty.l1.att);
    }
    // (iii) the tab dies between writing the stores and saving the sidecar
    w.T += 1000;
    a.store.lessons.qwerty.l1.attempts += 3;
    a.store.settings.theme = "whiteprint";
    settled(w.sync(a), "A");
    w.track(b);
    w.integrate(b, clone(w.get("u_a")), "after-stores");
    expect(b.sc.applying === "merge", "no marker was left");
    w.T += 1000;
    a.store.settings.theme = "blueprint";
    settled(w.sync(a), "A");
    w.T += 1000;
    bothSync(w, b, a);
    expect(attemptsOf(w, a, "l1") === 15, "an interrupted projection counted downloaded attempts as local", w.account("u_a").doc.lessons.by.qwerty.l1.att);
    expect(shown(w, a).settings.theme === "blueprint" && shown(w, b).settings.theme === "blueprint", "an interrupted projection re-stamped a remote value over a newer edit");
  },
  "M1 an edit made between the crash and the recovery is kept"() {
    for (const crash of ["before-stores", "after-stores"]) {
      const { w, a, b } = pair();
      a.store.settings.theme = "whiteprint";
      a.store.lessons.qwerty.l1.attempts += 2;
      settled(w.sync(a), "A");
      w.track(b);
      w.integrate(b, clone(w.get("u_a")), crash);
      w.T += 1000;
      b.store.settings.punctuation = false; // the user, in another tab, before anything recovered
      b.store.learn.camera = "side";
      b.store.settings.customLayouts = b.store.settings.customLayouts.filter((l) => l.id !== "y").concat([layout("z")]);
      b.store.lessons.qwerty.l7 = lesson(1);
      bothSync(w, b, a);
      const s = shown(w, a).settings;
      expect(s.punctuation === false && shown(w, a).learn.camera === "side" && layoutsOf(w, a).join() === "x,z", `edit made after a crash (${crash}) was lost`, { s, learn: shown(w, a).learn });
      expect(s.theme === "whiteprint" && attemptsOf(w, a, "l1") === 7 && attemptsOf(w, a, "l7") === 1, `recovery after a crash (${crash}) broke remote data`, shown(w, a));
      expect(same(shown(w, a).lessons, shown(w, b).lessons) && b.sc.applying === null, "not converged after recovery");
    }
  },
  "M2 a device returning 179-180 days after a delete: no PUT loop, layout gone"() {
    const { w, a, b } = pair();
    b.store.settings.customLayouts = b.store.settings.customLayouts.filter((l) => l.id !== "x");
    settled(w.sync(b), "B");
    const puts = w.account("u_a").puts;
    w.T += 179 * DAY + 3_600_000;
    for (let i = 0; i < 3; i++) {
      const r = w.sync(a);
      expect(r.settled && r.puts === 0, "stale device keeps pushing in the last TTL day", r);
      expect(layoutsOf(w, a).join() === "y", "deleted layout is still shown", layoutsOf(w, a));
    }
    expect(w.account("u_a").puts === puts, "PUTs were made");
  },
  "M3 data left behind by a deleted account is not merged into another account unasked"() {
    const { w, a, b } = pair();
    w.deleteAccount(a);
    expect(a.sc.link === null && a.sc.orphanOf.userId === "u_a", "unlinking forgot whose data it was", a.sc.orphanOf);
    expect(w.sync(b).deleted === true && b.user === null && b.sc.orphanOf.userId === "u_a", "the other device did not notice the deletion");
    expect(w.signIn(a, UB) === "mismatch", "another user got the orphaned data without being asked");
    expect(w.sync(a).skipped === true && w.account("u_b").doc === null, "orphaned data was uploaded to another account");
    w.resolve(a, "cancel");
    expect(w.signIn(a, UA) === "ok", "the same user was asked about their own data");
    settled(w.sync(a), "A");
    expect(Object.keys(w.account("u_a").doc.layouts).sort().join() === "x,y", "signing in again did not start from this device's data");
    // "Use the account's data" for orphaned data replaces it.
    expect(w.signIn(b, UB) === "mismatch", "mismatch for the second orphan");
    w.resolve(b, "use-account");
    settled(w.sync(b), "B");
    expect(layoutsOf(w, b).length === 0 && w.account("u_b").doc === null && b.sc.orphanOf === null, "use-account kept or uploaded the old data", layoutsOf(w, b));
    // Data that never belonged to an account joins whoever signs in.
    const c = w.device("C");
    c.store.settings.theme = "whiteprint";
    w.track(c);
    expect(w.signIn(c, UB) === "ok", "never-linked data was gated");
  },
  "M4 a clock-ahead anonymous edit does not beat later edits"() {
    for (const ahead of [365 * DAY, 20 * 60_000]) {
      const w = makeWorld();
      const a = w.device("A");
      a.store.settings.theme = "t0";
      w.signIn(a, UA);
      settled(w.sync(a), "A");
      const b = w.device("B", ahead);
      b.store.settings.theme = "old-anon-edit";
      b.store.settings.customLayouts = [layout("anon")];
      b.store.lessons = { qwerty: { l1: { ...lesson(2), lastAt: w.T + ahead, completedAt: w.T + ahead } } };
      w.track(b);
      const c = w.device("C");
      w.signIn(c, UA);
      settled(w.sync(c), "C");
      w.signIn(b, UA);
      settled(w.sync(b), "B"); // B links: its stamps are far ahead of the server
      expect(shown(w, b).settings.theme === "t0", "an edit of unverifiable age won at link time", w.account("u_a").doc.settings.theme);
      const e = w.account("u_a").doc.lessons.by.qwerty.l1;
      expect(e.lastAt <= w.T && e.completedAt <= w.T, "a lesson time from the future was uploaded", e);
      expect(layoutsOf(w, b).join() === "anon", "a layout the account lacks was not uploaded");
      w.T += 60_000;
      c.store.settings.theme = "C-newer"; // one minute later, C has not merged B's value
      settled(w.sync(c), "C");
      bothSync(w, a, b, c);
      for (const d of [a, b, c]) expect(shown(w, d).settings.theme === "C-newer", "a genuinely later edit lost to a clock-ahead one", w.account("u_a").doc.settings.theme);
    }
  },
  "M5 a sidecar from a newer build is left alone; unknown fields survive"() {
    const { a } = pair();
    const raw = JSON.parse(M.serializeSidecar(a.sc));
    expect(M.parseSidecar(JSON.stringify({ ...raw, v: 2 })).kind === "newer", "v 2 is not reported as newer");
    expect(M.parseSidecar(JSON.stringify({ ...raw, doc: { ...raw.doc, schema: 2 } })).kind === "newer", "doc schema 2 is not reported as newer");
    expect(M.parseSidecar("{not json").kind === "unusable" && M.parseSidecar("[]").kind === "unusable" && M.parseSidecar('{"v":0}').kind === "unusable", "corrupt text is not unusable");
    const p = M.parseSidecar(JSON.stringify({ ...raw, futureField: { x: 1 }, link: { ...raw.link, futureLinkField: 1 } }));
    expect(p.kind === "ok" && docsEqual(p.sidecar.doc, a.sc.doc) && p.sidecar.link.userId === "u_a", "unknown fields made a sidecar unreadable", p.kind);
    const again = JSON.parse(M.serializeSidecar(C.linkSidecar(C.unlinkSidecar(p.sidecar, null), UA)));
    expect(same(again.futureField, { x: 1 }) && again.v === 1, "an unknown field was dropped on write", Object.keys(again));
    const old = { ...raw };
    delete old.orphanOf;
    delete old.applying;
    expect(M.parseSidecar(JSON.stringify(old)).kind === "ok", "a sidecar written before this change no longer loads");
  },
  "L1 tombstones and device counters cannot grow into a permanent error"() {
    const w = makeWorld();
    const a = w.device("A");
    for (let i = 0; i < 260; i++) {
      w.T += 2;
      a.store.settings.customLayouts = [layout("c" + i)];
      w.track(a);
      w.T += 2;
      a.store.settings.customLayouts = [];
      w.track(a);
    }
    expect(Object.keys(a.sc.doc.layouts).length <= LIMITS.layouts, "tombstones pile up on an anonymous device", Object.keys(a.sc.doc.layouts).length);
    expect(M.parseSidecar(M.serializeSidecar(a.sc)).kind === "ok", "the sidecar no longer loads");
    w.signIn(a, UA);
    settled(w.sync(a), "first sync after 260 create+delete");
    // More LIVE layouts than an account may hold: the rest stays on the device, sync goes on.
    const big = w.device("BIG");
    big.store.settings.customLayouts = Array.from({ length: LIMITS.layouts + 7 }, (_, i) => layout("b" + i));
    big.store.settings.theme = "whiteprint";
    w.track(big);
    const p = M.parseSidecar(M.serializeSidecar(big.sc));
    expect(p.kind === "ok" && Object.keys(p.sidecar.doc.layouts).length === LIMITS.layouts + 7, "a replica over the limit does not load or was rebuilt");
    w.T += 1000;
    w.signIn(big, UA);
    const r = w.sync(big);
    expect(r.settled && r.overflow === true && r.error === undefined, "too many layouts blocked the sync", r);
    const doc = w.account("u_a").doc;
    expect(Object.values(doc.layouts).filter((i) => !i.del).length === LIMITS.layouts && doc.settings.theme.v === "whiteprint", "the account does not hold the newest 200 layouts and the rest of the data", Object.keys(doc.layouts).length);
    expect(layoutsOf(w, big).length === LIMITS.layouts + 7, "layouts that did not fit were removed from the device");
    const r2 = w.sync(big);
    expect(r2.settled && r2.puts === 0, "an over-full device keeps pushing", r2);
    // The 65th device of an account: its attempts for a full entry are not counted, nothing breaks.
    const w2 = makeWorld();
    let last = null;
    for (let i = 0; i < LIMITS.devices + 3; i++) {
      const d = w2.device("P" + i);
      w2.signIn(d, UA);
      settled(w2.sync(d), d.name);
      const prev = d.store.lessons.qwerty?.l1;
      d.store.lessons = { qwerty: { l1: { ...lesson((prev?.attempts ?? 0) + 1), stars: i % 4 === 3 ? 3 : 1 } } };
      last = w2.sync(d);
      expect(last.settled && last.error === undefined, "device " + i + " cannot sync", last);
    }
    const e = w2.account("u_a").doc.lessons.by.qwerty.l1;
    expect(Object.keys(e.att).length === LIMITS.devices && e.stars === 3, "device counters are not capped at the limit", Object.keys(e.att).length);
  },
  "documented: results recorded before a device learns of a reset are discarded, nothing else"() {
    const { w, a, b } = pair();
    w.resetLessons(a); // A resets the account ...
    settled(w.sync(a), "A");
    w.T += DAY;
    b.store.lessons.qwerty.l2 = lesson(4, 3); // ... B, offline since before, practises on
    b.store.settings.theme = "whiteprint";
    b.store.settings.customLayouts.push(layout("offline"));
    w.track(b);
    w.T += DAY;
    bothSync(w, b, a);
    expect(same(shown(w, b).lessons, {}) && same(shown(w, a).lessons, {}), "results of the old epoch survived the reset", shown(w, b).lessons);
    expect(shown(w, a).settings.theme === "whiteprint" && layoutsOf(w, a).join() === "offline,x,y", "the reset discarded more than lesson results", shown(w, a).settings);
    w.T += 1000;
    b.store.lessons = { qwerty: { l2: lesson(1) } }; // after learning of it, results count again
    bothSync(w, b, a);
    expect(attemptsOf(w, a, "l2") === 1, "results after the reset are not recorded");
  },
};

// ---------------------------------------------------------------------------------------------
// PART 2: random runs
// ---------------------------------------------------------------------------------------------

const USER = { id: "u_sim", name: "sim" };

function run(seed) {
  const rnd = prng(seed);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const w = makeWorld();
  const tick = () => (w.T += 1 + Math.floor(rnd() * 5000));
  const server = w.account(USER.id);

  // --- ground truth ---------------------------------------------------------------------------
  // Settings / layouts: every write is logged when it is ABSORBED (that is when it gets its stamp;
  // the engine debounces, and setting a value back to what the device last saw is no edit). The
  // stamp is read from the replica. A write made before the device met the account is "pending":
  // only the device's LATEST pending write per key ever leaves the device, and at the first contact
  // it either keeps its stamp or is demoted to 1 (see check 2 at the top).
  const writes = { settings: {}, layouts: {} };
  // Lessons: one record per result, tagged with the lessons epoch it was recorded under.
  const results = [];
  w.hooks.absorbed = (d, before) => {
    d.pending ??= {};
    d.unrecorded ??= [];
    d.early ??= [];
    const met = C.hasMetAccount(d.sc);
    for (const section of ["settings", "layouts"]) {
      for (const [key, item] of Object.entries(d.sc.doc[section])) {
        if (before[section][key] === item || same(before[section][key] ?? null, item)) continue;
        const entry = { t: item.t, del: item.del === true, v: item.del ? "null" : canonical(item.v) };
        const log = (writes[section][key] ??= []);
        if (!met) {
          const old = d.pending[section + "/" + key];
          if (old) log.splice(log.indexOf(old), 1);
          d.pending[section + "/" + key] = entry;
        }
        log.push(entry);
      }
    }
    const epoch = d.sc.doc.lessons.epoch;
    for (const r of d.unrecorded) (met ? results : d.early).push({ ...r, epoch });
    d.unrecorded = [];
  };
  w.hooks.firstContact = (d, remote) => {
    for (const entry of Object.values(d.pending)) if (entry.t > remote.serverTime + C.FIRST_CONTACT_TOLERANCE_MS) entry.t = 1;
    d.pending = {};
    // Results recorded before the first contact join the account's CURRENT epoch.
    for (const r of d.early) results.push({ ...r, epoch: d.sc.doc.lessons.epoch });
    d.early = [];
  };

  const devices = [];
  for (let i = 0; i < DEVICES; i++) {
    const d = w.device("dev" + i, Math.floor((rnd() - 0.5) * 4 * 3_600_000));
    Object.assign(d, { pending: {}, unrecorded: [], early: [], flight: null });
    w.signIn(d, USER);
    devices.push(d);
  }

  let layoutSeq = 0;
  function localEdit(d) {
    tick();
    const kind = pick(["theme", "theme", "punct", "mode", "camera", "font", "addLayout", "editLayout", "delLayout", "lesson", "lesson", "reset", "loseSettings", "loseLearn", "loseLessons", "loseSidecar"]);
    const s = d.store.settings;
    if (kind === "theme") {
      s.theme = pick(["blueprint", "whiteprint"]) + Math.floor(rnd() * 3);
    } else if (kind === "punct") {
      s.punctuation = !s.punctuation;
    } else if (kind === "mode") {
      s.testMode = pick(["time", "words"]);
      s.testAmount = pick([10, 15, 30, 60]);
    } else if (kind === "camera") {
      d.store.learn.camera = pick(["angled", "top"]) + Math.floor(rnd() * 3);
    } else if (kind === "font") {
      s.fontSize = 16 + Math.floor(rnd() * 20);
    } else if (kind === "addLayout") {
      const id = "L" + layoutSeq++;
      s.customLayouts.push({ id, name: id, source: "v0" });
    } else if (kind === "editLayout" && s.customLayouts.length) {
      pick(s.customLayouts).source = "v" + Math.floor(rnd() * 1000);
    } else if (kind === "delLayout" && s.customLayouts.length) {
      const l = pick(s.customLayouts);
      s.customLayouts = s.customLayouts.filter((x) => x !== l);
    } else if (kind === "lesson") {
      const id = pick(["a", "b", "c"]);
      const forLayout = ((d.store.lessons ??= {}).qwerty ??= {});
      const prev = forLayout[id];
      const stars = Math.floor(rnd() * 4);
      forLayout[id] = {
        stars: Math.max(prev?.stars ?? 0, stars),
        bestWpm: Math.max(prev?.bestWpm ?? 0, Math.floor(rnd() * 100)),
        bestAccuracy: 100,
        completedAt: prev?.completedAt ?? (stars > 0 ? w.T : null),
        attempts: (prev?.attempts ?? 0) + 1,
        lastAt: w.T,
      };
      d.unrecorded.push({ id, stars });
    } else if (kind === "reset" && C.hasMetAccount(d.sc) && rnd() < 0.2) {
      // "Reset progress" at any moment, with whatever the other devices happen to hold: results
      // they record before they learn of it are discarded with the old epoch (documented).
      d.unrecorded = [];
      w.resetLessons(d);
      return;
    } else if ((kind === "loseSettings" || kind === "loseLearn" || kind === "loseLessons") && rnd() < 0.3) {
      // The browser evicted a key. Edits not absorbed yet are honestly lost with it; nothing else
      // may change anywhere. The page then loads with the key missing.
      w.track(d);
      if (kind === "loseLessons") d.unrecorded = [];
      const key = kind === "loseSettings" ? "settings" : kind === "loseLearn" ? "learn" : "lessons";
      const font = d.store.settings.fontSize;
      d.store[key] = null;
      d.acked = {};
      w.track(d);
      d.store.settings ??= clone(CONFIG.settingsDefaults);
      d.store.learn ??= clone(CONFIG.learnDefaults);
      d.store.settings.fontSize = font;
      return;
    } else if (kind === "loseSidecar" && rnd() < 0.15) {
      // The sidecar is gone while the stores survive. From a device that is in sync, signing in
      // again must change nothing in the account: no value re-stamped, no attempt counted twice.
      syncAll();
      const puts = server.puts;
      w.loseSidecar(d);
      Object.assign(d, { pending: {}, early: [], flight: null });
      w.signIn(d, USER);
      syncAll();
      if (server.puts !== puts) throw new Error("signing in again after losing the sidecar uploaded something");
      return;
    }
    // The debounced absorb, sometimes skipped (the edit is then absorbed by the next cycle step).
    if (rnd() < 0.7) w.track(d);
  }

  /** One step of device d's cycle: issue a request, or handle the response of the one in flight. */
  function step(d) {
    tick();
    if (d.flight === null) {
      w.track(d);
      d.flight = { status: 200, body: clone(w.get(USER.id)) };
      return;
    }
    const response = d.flight;
    d.flight = null;
    if (response.status !== 200 && response.status !== 409) throw new Error("server rejected the document: " + response.detail);
    w.track(d);
    const out = w.integrate(d, response.body);
    if (out === "deleted") throw new Error("unexpected remote-deleted");
    if (!out.needPush) return;
    d.flight = clone(w.put(USER.id, { baseVersion: d.sc.link.version, gen: d.sc.link.gen, doc: clone(out.push) }));
  }

  function syncAll() {
    for (let round = 0; round < 50; round++) {
      for (const d of devices) while (d.flight !== null) step(d);
      const before = server.puts;
      for (const d of devices) {
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
  const views = devices.map((d) => w.read(d).view);
  devices.forEach((d, i) => {
    if (synced(views[i]) !== synced(views[0])) throw new Error(`views differ: ${d.name} vs dev0`);
    if (!docsEqual(d.sc.doc, pruneDoc(server.doc, w.T, CLIENT_TOMBSTONE_TTL_MS))) throw new Error(`replica of ${d.name} differs from the server`);
    if (d.sc.dirty || d.sc.applying) throw new Error(`${d.name} still dirty`);
  });
  const final = views[0];
  // 2. + 3. the write with the highest effective stamp wins (ties: delete, then canonical order)
  const winner = (log) => log.reduce((a, b) => (a.t !== b.t ? (a.t > b.t ? a : b) : a.del !== b.del ? (a.del ? a : b) : a.v >= b.v ? a : b));
  for (const [key, log] of Object.entries(writes.settings)) {
    if (log.length === 0) continue;
    const got = key === "testMode+testAmount" ? canonical({ testMode: final.settings.testMode, testAmount: final.settings.testAmount }) : canonical(final.settings[key]);
    const want = winner(log).v;
    if (got !== want) throw new Error(`lost update on ${key}: expected ${want}, got ${got}`);
  }
  for (const [id, log] of Object.entries(writes.layouts)) {
    if (log.length === 0) continue;
    const want = winner(log);
    const got = final.settings.customLayouts.find((l) => l.id === id);
    if (want.del && got) throw new Error(`layout ${id} was deleted last but exists`);
    if (!want.del && (!got || canonical(got) !== want.v)) throw new Error(`layout ${id}: expected ${want.v}, got ${got && canonical(got)}`);
  }
  // 4. lessons: exactly the results recorded under the final epoch
  const epoch = server.doc.lessons.epoch;
  for (const id of ["a", "b", "c"]) {
    const mine = results.filter((r) => r.id === id && r.epoch === epoch);
    const got = final.lessons.qwerty?.[id];
    const stars = mine.reduce((m, r) => Math.max(m, r.stars), 0);
    if ((got?.stars ?? 0) !== stars) throw new Error(`lesson ${id}: stars ${got?.stars} != ${stars}`);
    if ((got?.attempts ?? 0) !== mine.length) throw new Error(`lesson ${id}: attempts ${got?.attempts} != ${mine.length}`);
  }
}

// ---------------------------------------------------------------------------------------------

let failed = 0;
if (ONLY !== "random") {
  for (const [name, body] of Object.entries(scenarios)) {
    try {
      body();
      console.log("ok    " + name);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    }
  }
}
if (ONLY !== "scenarios") {
  let bad = 0;
  for (let i = 0; i < RUNS; i++) {
    const seed = SEED + i * 7919;
    try {
      run(seed);
    } catch (e) {
      bad++;
      console.log(`FAIL seed ${seed}: ${e.message}`);
      if (bad >= 5) break;
    }
  }
  failed += bad;
  console.log(bad ? `${bad} failing random run(s)` : `ok    random: ${RUNS} runs x ${OPS} ops x ${DEVICES} devices, seed ${SEED}`);
}
console.log(failed ? `${failed} failure(s)` : "all passed");
process.exit(failed ? 1 : 0);
