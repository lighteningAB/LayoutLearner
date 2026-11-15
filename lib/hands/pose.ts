// Pose layer: decides where each hand and fingertip should be for the current
// target / modifier / key presses, animates towards it with critically damped
// springs, and solves per-digit IK every frame. Layout-agnostic: everything is
// derived from the keys' positions, `finger` and `isHome`.
//
// The per-frame path (`update`) performs no allocations.

import * as THREE from "three";
import { solveChain } from "./ik";
import { DIGITS, HAND_SCALE, THUMB, WRIST_HEIGHT, type HandRig } from "./rig";
import { KEY_TOP, KEY_TRAVEL, aimPoint, pointInKey, type KeyPlacement, type PlacedLayout } from "./space";

export interface KeySink {
  /** Momentary press: `dip` 0..1 travel, `flash` 0..1 highlight, `ok` picks the colour. */
  setKeyPress(id: string, dip: number, flash: number, ok: boolean): void;
  /** Held key (modifier): 0..1 travel. */
  setKeyHold(id: string, amount: number): void;
  /** Where fingertip `finger` (FINGER_ORDER index) is: world x/z and height above the key tops. */
  setContact(finger: number, x: number, z: number, lift: number): void;
}

// ---- tunables --------------------------------------------------------------
const ROOT_SMOOTH = 0.065; // s, hand translation / yaw
const TIP_SMOOTH = 0.04; // s, the reaching fingertip
const IDLE_SMOOTH = 0.07; // s, idle fingertips (relative to the hand)
const TAP_TIME = 0.15; // s, down + up
const FLASH_TIME = 0.4; // s
const TAP_WAIT = 0.5; // s, max time a tap waits for its finger to arrive
const YAW_PER_UNIT = 0.1; // rad of hand yaw (pivot about the wrist) per key unit of lateral reach
const YAW_MAX = 0.24;
const YAW_NEAR = 0.09; // cap for keys within ~2u of the finger's home key
const PALM_MIN = 0.1; // the palm always drifts along by at least this share of a reach...
const PALM_STEPS = 10; // ...and takes over more only when the finger alone would be strained
const FOLLOW = 0.1; // how much idle fingers follow a displaced hand (1 = rigidly)
const FOLLOW_FROM = 0.8; // hand displacement (key units) beyond which idle fingers start to ride along
const HOVER = 0.22; // idle fingers lift this much (max) while the hand is away from home
/** Horizontal knuckle -> pad distance of the relaxed arch, pinky..index (key units). */
const REST_REACH = [1.65, 1.92, 2.0, 2.1];
/** Rest-pose fit: weight of staying near the relaxed arch vs. keeping reach in reserve. */
const POSTURE = 4;
const RESERVE = 30;
/** Rows (key units) above and below home that a finger should reach without help from the palm. */
const ROW_RESERVE = 1;
/** Thumb tip rests this far inward (towards the other hand) of the index finger's home key. */
const THUMB_INSET = 0.5;
/** Root-frame point used to report how far the palm (not the wrist) has moved. */
const PALM_Z = -2;
const ARC = 0.38; // fingertip lift while travelling
const IK_ITERS = 12;
const IK_TOL = 2e-6; // chain units (~1e-4 key units)

let sdVel = 0;
/** Critically damped spring step (Game Programming Gems 4). Writes the new velocity to `sdVel`. */
function smoothDamp(cur: number, target: number, vel: number, smoothTime: number, dt: number): number {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + omega * change) * dt;
  sdVel = (vel - omega * temp) * exp;
  return target + (change + temp) * exp;
}

class Digit {
  /** Resting contact point (world) and its key, if the layout gives this digit one. */
  home = new THREE.Vector3();
  homeKey: KeyPlacement | null = null;
  /** `home` expressed in the hand's rest root frame — used to carry it along with the hand. */
  homeInRoot = new THREE.Vector3();
  /** World-space aim while the digit is active (target / modifier). */
  goal = new THREE.Vector3();
  /** Current fingertip target, world space. */
  cur = new THREE.Vector3();
  vel = new THREE.Vector3();
  /** Same in the hand's root frame; idle digits are animated there so they ride along with the hand. */
  curR = new THREE.Vector3();
  active = false;
  p = new Float64Array(3);
  /** Joint parameters of the settled rest pose (warm start for goal planning). */
  homeP = new Float64Array(3);
  /** Joint parameters of the relaxed arch this digit would take with nothing to touch. */
  restP = new Float64Array(3);
  /** 0 idle, 1 waiting to arrive, 2 dipping. */
  tapPhase = 0;
  tapT = 0;
  tapPoint = new THREE.Vector3();
  tapKey = "";
  tapOk = true;
  hold = 0;
  holdVel = 0;
  /** Last IK residual, key units. */
  residual = 0;
}

interface Reach {
  digit: number;
  pl: KeyPlacement;
  point: THREE.Vector3;
}

class Pose {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  copy(o: Pose): this {
    this.x = o.x;
    this.y = o.y;
    this.z = o.z;
    this.yaw = o.yaw;
    return this;
  }
}

class Hand {
  digits: Digit[] = [new Digit(), new Digit(), new Digit(), new Digit(), new Digit()];
  rest = new Pose();
  goal = new Pose();
  cur = new Pose();
  vx = 0;
  vz = 0;
  vyaw = 0;
  target: Reach | null = null;
  modifier: Reach | null = null;
  /** Digit whose reach currently decides the hand pose (-1: none). */
  lead = -1;
  constructor(
    readonly rig: HandRig,
    readonly side: "L" | "R",
  ) {}
}

interface Effect {
  id: string;
  t: number;
  ok: boolean;
}

export interface TargetDebug {
  targetKeyId: string | null;
  label?: string;
  finger?: string;
  /** World-space centre of the key top. */
  keyCentre?: number[];
  /** Point the finger aims at (equals keyCentre except on very wide keys such as space). */
  aim?: number[];
  /** World-space position of the assigned fingertip pad. */
  tip?: number[];
  /** |tip - aim| in key units. */
  distance?: number;
  /** |tip - keyCentre| in key units. */
  distanceToCentre?: number;
  /** Whether the fingertip is over the key. */
  onKey?: boolean;
  settled: boolean;
  /** How far each hand's wrist / palm centre is from its rest pose (key units, radians). */
  hands?: { hand: string; wrist: number; palm: number; yaw: number }[];
  /** Fingertips that are NOT reaching: xz distance from their home key centre and height above the key tops. */
  others?: { finger: string; off: number; lift: number }[];
  /** Largest `others[].off`. */
  maxOther?: number;
}

export interface KeyMeasure {
  /** |pad - aim| after settling, key units. */
  distance: number;
  finger: string;
  /** Rows above (-) / below (+) the hand's home row, and |key - home key| in key units. */
  row: number;
  reach: number;
  /** Wrist translation, palm-centre translation and yaw change of the reaching hand. */
  wrist: number;
  palm: number;
  yaw: number;
  /** Largest xz distance of a non-reaching fingertip (same hand) from its home key centre, and which finger. */
  others: number;
  othersFinger: string;
  /** Joint parameters of the reaching finger (spread, knuckle, curl). */
  joints: number[];
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const scratchP = new Float64Array(3);
const scratchPose = new Pose();
const measurePose = new Pose();
/** Outputs of `idleParams`. */
let idleLift = 0;
let idleFollow = 0;

/**
 * How idle fingers behave for a hand at `pose`: small moves -> they stay on
 * their home keys; big moves -> they travel with the hand, lifted off the keys.
 */
function idleParams(rest: Pose, pose: Pose): void {
  const away = Math.hypot(pose.x - rest.x, pose.z - rest.z) + Math.abs(pose.yaw - rest.yaw) * 2;
  idleLift = Math.min(HOVER, Math.max(0, away - 0.12) * 0.4);
  idleFollow = Math.min(0.92, Math.max(FOLLOW, FOLLOW + 0.55 * (away - FOLLOW_FROM)));
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export class HandsController {
  readonly hands: Hand[];
  private effects: Effect[] = [];
  private targetId: string | null = null;
  private modifierId: string | null = null;
  private goalsDirty = true;
  private settled = false;

  constructor(
    readonly placed: PlacedLayout,
    left: HandRig,
    right: HandRig,
    private sink: KeySink,
  ) {
    this.hands = [new Hand(left, "L"), new Hand(right, "R")];
    for (const h of this.hands) this.fitRest(h);
    this.snap();
  }

  // ---- public API ----------------------------------------------------------

  setTarget(id: string | null): void {
    if (id === this.targetId) return;
    this.targetId = id;
    this.assign();
  }

  setModifier(id: string | null): void {
    if (id === this.modifierId) return;
    if (this.modifierId) this.sink.setKeyHold(this.modifierId, 0);
    this.modifierId = id;
    this.assign();
  }

  /** Tap animation on a key: the assigned finger travels there (if needed), dips and releases. */
  press(id: string, ok = true): void {
    const pl = this.placed.byId.get(id);
    if (!pl) return;
    this.settled = false;
    const f = pl.key.finger;
    if (!f) {
      this.effects.push({ id, t: 0, ok });
      return;
    }
    const hand = this.hands[f.hand === "L" ? 0 : 1];
    const di = DIGITS.indexOf(f.finger);
    const d = hand.digits[di];
    d.tapPhase = 1;
    d.tapT = 0;
    d.tapKey = id;
    d.tapOk = ok;
    aimPoint(pl, d.home, d.tapPoint);
    this.goalsDirty = true;
  }

  /** Jump straight to the settled pose (no animation). */
  snap(): void {
    this.update(0, true);
    for (let i = 0; i < 4; i++) this.update(0);
    this.settled = false;
  }

  get isSettled(): boolean {
    return this.settled;
  }

  /**
   * Advances the animation and poses both rigs. Returns true while anything is
   * still moving (i.e. another frame is needed).
   */
  update(dt: number, snap = false): boolean {
    if (dt > 1 / 20) dt = 1 / 20;
    this.refreshGoals();
    let moving = false;

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dt;
      const dip = e.t < TAP_TIME ? Math.sin((Math.PI * e.t) / TAP_TIME) : 0;
      const flash = e.t < FLASH_TIME ? 1 - e.t / FLASH_TIME : 0;
      this.sink.setKeyPress(e.id, dip, flash * flash, e.ok);
      if (e.t >= FLASH_TIME) this.effects.splice(i, 1);
      moving = true;
    }

    for (let hi = 0; hi < 2; hi++) {
      const h = this.hands[hi];
      const c = h.cur;
      const g = h.goal;
      if (snap) {
        c.copy(g);
        h.vx = h.vz = h.vyaw = 0;
      } else if (dt > 0) {
        c.x = smoothDamp(c.x, g.x, h.vx, ROOT_SMOOTH, dt);
        h.vx = sdVel;
        c.z = smoothDamp(c.z, g.z, h.vz, ROOT_SMOOTH, dt);
        h.vz = sdVel;
        c.yaw = smoothDamp(c.yaw, g.yaw, h.vyaw, ROOT_SMOOTH, dt);
        h.vyaw = sdVel;
      }
      c.y = g.y;
      if (Math.abs(c.x - g.x) + Math.abs(c.z - g.z) + Math.abs(c.yaw - g.yaw) > 1e-4) moving = true;
      if (Math.abs(h.vx) + Math.abs(h.vz) + Math.abs(h.vyaw) > 1e-3) moving = true;

      const root = h.rig.root;
      root.position.set(c.x, c.y, c.z);
      root.rotation.y = c.yaw;
      const cosY = Math.cos(c.yaw);
      const sinY = Math.sin(c.yaw);

      idleParams(h.rest, c);
      const lift = idleLift;
      const follow = idleFollow;

      for (let di = 0; di < 5; di++) {
        const d = h.digits[di];
        const active =
          d.tapPhase !== 0 || (h.target !== null && h.target.digit === di) || (h.modifier !== null && h.modifier.digit === di);
        let wx: number;
        let wy: number;
        let wz: number;
        let endX = 0;
        let endZ = 0;
        if (active) {
          const want = d.tapPhase ? d.tapPoint : d.goal;
          wx = want.x;
          wy = want.y;
          wz = want.z;
          endX = wx;
          endZ = wz;
          if (h.lead === di && !snap) {
            // The finger that leads the hand arrives together with it instead of
            // straining ahead: hold it back by however far the hand still has to go.
            wx -= g.x - c.x;
            wz -= g.z - c.z;
          }
          if (!d.active) {
            d.active = true;
            d.vel.set(0, 0, 0);
          }
          if (snap) d.cur.set(wx, wy, wz);
          else if (dt > 0) {
            d.cur.x = smoothDamp(d.cur.x, wx, d.vel.x, TIP_SMOOTH, dt);
            d.vel.x = sdVel;
            d.cur.y = smoothDamp(d.cur.y, wy, d.vel.y, TIP_SMOOTH, dt);
            d.vel.y = sdVel;
            d.cur.z = smoothDamp(d.cur.z, wz, d.vel.z, TIP_SMOOTH, dt);
            d.vel.z = sdVel;
          }
        } else {
          if (d.active) {
            d.active = false;
            worldToRoot(c, d.curR.copy(d.cur));
            d.vel.set(0, 0, 0);
          }
          // idle target in the root frame: between "over the home key" and "riding with the hand"
          worldToRoot(c, v2.copy(d.home));
          const f = follow;
          const rx = v2.x + (d.homeInRoot.x - v2.x) * f;
          const rz = v2.z + (d.homeInRoot.z - v2.z) * f;
          const ry = d.homeInRoot.y + (di === THUMB ? lift * 0.5 : lift);
          if (snap) d.curR.set(rx, ry, rz);
          else if (dt > 0) {
            d.curR.x = smoothDamp(d.curR.x, rx, d.vel.x, IDLE_SMOOTH, dt);
            d.vel.x = sdVel;
            d.curR.y = smoothDamp(d.curR.y, ry, d.vel.y, IDLE_SMOOTH, dt);
            d.vel.y = sdVel;
            d.curR.z = smoothDamp(d.curR.z, rz, d.vel.z, IDLE_SMOOTH, dt);
            d.vel.z = sdVel;
          }
          rootToWorld(c, d.cur.copy(d.curR));
          rootToWorld(c, v2.set(rx, ry, rz));
          wx = v2.x;
          wy = v2.y;
          wz = v2.z;
        }
        const dx = wx - d.cur.x;
        const dz = wz - d.cur.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist + Math.abs(wy - d.cur.y) > 1e-4) moving = true;
        if (Math.abs(d.vel.x) + Math.abs(d.vel.y) + Math.abs(d.vel.z) > 1e-3) moving = true;

        // Remaining distance to where the digit is ultimately going.
        const arrive = active ? Math.hypot(endX - d.cur.x, endZ - d.cur.z) : dist;
        // Travel arc: lift proportionally to the remaining distance.
        let y = d.cur.y + (active ? ARC * Math.min(1, arrive * 1.4) : 0);

        if (d.tapPhase === 1) {
          d.tapT += dt;
          moving = true;
          // (also wait until the finger can actually get there: the hand may still be catching up)
          if ((arrive < 0.16 && d.residual < 0.03) || d.tapT > TAP_WAIT) {
            d.tapPhase = 2;
            d.tapT = 0;
            this.effects.push({ id: d.tapKey, t: 0, ok: d.tapOk });
          }
        } else if (d.tapPhase === 2) {
          d.tapT += dt;
          moving = true;
          if (d.tapT >= TAP_TIME) {
            d.tapPhase = 0;
            this.goalsDirty = true;
          } else {
            y -= KEY_TRAVEL * Math.sin((Math.PI * d.tapT) / TAP_TIME);
          }
        }

        // Held modifier: press down once the finger has arrived.
        const mod = h.modifier;
        const holding = mod !== null && mod.digit === di && !d.tapPhase && !(h.target && h.target.digit === di);
        const holdWant = holding && arrive < 0.2 ? 1 : 0;
        if (d.hold !== holdWant || d.holdVel !== 0) {
          if (dt > 0) {
            d.hold = smoothDamp(d.hold, holdWant, d.holdVel, 0.045, dt);
            d.holdVel = sdVel;
          }
          if (Math.abs(d.hold - holdWant) < 1e-3 && Math.abs(d.holdVel) < 1e-2) {
            d.hold = holdWant;
            d.holdVel = 0;
          } else moving = true;
          if (mod && mod.digit === di) this.sink.setKeyHold(mod.pl.key.id, d.hold);
        }
        y -= KEY_TRAVEL * d.hold;

        // World target -> root frame -> digit parent frame, then IK.
        const tx = d.cur.x - c.x;
        const tz = d.cur.z - c.z;
        v1.set(tx * cosY - tz * sinY, y - c.y, tx * sinY + tz * cosY).applyMatrix4(h.rig.fromRoot[di]);
        let err = solveChain(h.rig.chains[di], v1, d.p, active ? IK_ITERS * 2 : IK_ITERS, IK_TOL);
        if (err * UNIT > 0.05) {
          // The warm start can get wedged in a corner of the joint limits while
          // the hand sweeps past; if a fresh start from the home posture does
          // better, take that instead.
          scratchP[0] = d.homeP[0];
          scratchP[1] = d.homeP[1];
          scratchP[2] = d.homeP[2];
          const err2 = solveChain(h.rig.chains[di], v1, scratchP, IK_ITERS * 2, IK_TOL);
          if (err2 < err * 0.7) {
            err = err2;
            d.p[0] = scratchP[0];
            d.p[1] = scratchP[1];
            d.p[2] = scratchP[2];
          }
        }
        d.residual = err * UNIT;
        h.rig.setDigit(di, d.p[0], d.p[1], d.p[2]);
        this.sink.setContact(hi === 0 ? di : 9 - di, d.cur.x, d.cur.z, y - KEY_TOP + (d.homeKey || d.tapPhase ? 0 : 1));
      }
    }
    this.settled = !moving;
    return moving;
  }

  /** World position of a fingertip pad for the current pose. */
  tipWorld(hand: 0 | 1, digit: number, out: THREE.Vector3): THREE.Vector3 {
    const h = this.hands[hand];
    const d = h.digits[digit];
    h.rig.tipInRoot(digit, d.p[0], d.p[1], d.p[2], out);
    return rootToWorld(h.cur, out);
  }

  debug(): TargetDebug {
    const out: TargetDebug = { targetKeyId: this.targetId, settled: this.settled };
    const t = new THREE.Vector3();
    out.hands = this.hands.map((h) => ({
      hand: h.side,
      wrist: r3(Math.hypot(h.cur.x - h.rest.x, h.cur.z - h.rest.z)),
      palm: r3(palmShift(h.rest, h.cur)),
      yaw: r3(h.cur.yaw - h.rest.yaw),
    }));
    out.others = [];
    this.hands.forEach((h, hi) => {
      h.digits.forEach((d, di) => {
        if (!d.homeKey || d.tapPhase || h.target?.digit === di || h.modifier?.digit === di) return;
        this.tipWorld(hi as 0 | 1, di, t);
        out.others!.push({ finger: `${h.side} ${DIGITS[di]}`, off: r3(Math.hypot(t.x - d.home.x, t.z - d.home.z)), lift: r3(t.y - KEY_TOP) });
      });
    });
    out.maxOther = out.others.reduce((m, o) => Math.max(m, o.off), 0);
    const pl = this.targetId ? this.placed.byId.get(this.targetId) : undefined;
    if (!pl) return out;
    out.label = pl.key.label.replace(/\n/g, " ");
    out.keyCentre = [r3(pl.cx), r3(KEY_TOP), r3(pl.cz)];
    const f = pl.key.finger;
    if (!f) return out;
    out.finger = `${f.hand} ${f.finger}`;
    const hi = f.hand === "L" ? 0 : 1;
    const h = this.hands[hi];
    const di = DIGITS.indexOf(f.finger);
    const aim = aimPoint(pl, h.digits[di].home, new THREE.Vector3());
    const tip = this.tipWorld(hi as 0 | 1, di, new THREE.Vector3());
    out.aim = [r3(aim.x), r3(aim.y), r3(aim.z)];
    out.tip = [r3(tip.x), r3(tip.y), r3(tip.z)];
    out.distance = r3(tip.distanceTo(aim));
    out.distanceToCentre = r3(Math.hypot(tip.x - pl.cx, tip.y - KEY_TOP, tip.z - pl.cz));
    out.onKey = pointInKey(pl, tip.x, tip.z);
    return out;
  }

  /** Fingertip positions of all ten digits (for debugging the rest pose). */
  debugTips(): { finger: string; tip: number[]; home: number[] | null; residual: number }[] {
    const res: { finger: string; tip: number[]; home: number[] | null; residual: number }[] = [];
    const t = new THREE.Vector3();
    this.hands.forEach((h, hi) => {
      h.digits.forEach((d, di) => {
        this.tipWorld(hi as 0 | 1, di, t);
        res.push({
          finger: `${h.side} ${DIGITS[di]}`,
          tip: [r3(t.x), r3(t.y), r3(t.z)],
          home: d.homeKey ? [r3(d.home.x), r3(d.home.y), r3(d.home.z)] : null,
          residual: r3(d.residual),
        });
      });
    });
    return res;
  }

  // ---- goals ---------------------------------------------------------------

  private assign(): void {
    for (const h of this.hands) {
      h.target = null;
      h.modifier = null;
    }
    this.assignOne(this.targetId, false);
    this.assignOne(this.modifierId, true);
    this.goalsDirty = true;
    this.settled = false;
  }

  private assignOne(id: string | null, modifier: boolean): void {
    if (!id) return;
    const pl = this.placed.byId.get(id);
    const f = pl?.key.finger;
    if (!pl || !f) return;
    const h = this.hands[f.hand === "L" ? 0 : 1];
    const di = DIGITS.indexOf(f.finger);
    const d = h.digits[di];
    const reach: Reach = { digit: di, pl, point: aimPoint(pl, d.home, new THREE.Vector3()) };
    if (modifier) h.modifier = reach;
    else h.target = reach;
  }

  private refreshGoals(): void {
    if (!this.goalsDirty) return;
    this.goalsDirty = false;
    for (const h of this.hands) this.computeGoals(h);
  }

  /** Rest pose: rigidly fit the relaxed fingertips onto this hand's home keys. */
  private fitRest(h: Hand): void {
    const sign = h.side === "L" ? 1 : -1;
    const rig = h.rig;
    const side = h.side;
    // Relaxed arch: every fingertip comes down onto the key plane a set distance
    // in front of its knuckle. That leaves extension in reserve for the row above
    // and curl for the row below, so letter-row reaches barely need the palm.
    const nominal = h.digits.map((d, di) => {
      const chain = rig.chains[di];
      const r = d.restP;
      r[0] = chain.rest[0];
      r[1] = chain.rest[1];
      r[2] = chain.rest[2];
      if (di !== THUMB) {
        v1.copy(chain.t1).applyMatrix4(rig.toRoot[di]);
        v1.set(v1.x, -WRIST_HEIGHT, v1.z - REST_REACH[di]).applyMatrix4(rig.fromRoot[di]);
        solveChain(chain, v1, r, 40, IK_TOL);
        r[0] = 0;
      }
      d.p[0] = r[0];
      d.p[1] = r[1];
      d.p[2] = r[2];
      return rig.tipInRoot(di, r[0], r[1], r[2], new THREE.Vector3());
    });

    const mine = this.placed.list.filter((p) => p.key.finger && p.key.finger.hand === side);
    for (let di = 0; di < THUMB; di++) {
      const cands = mine.filter((p) => p.key.finger!.finger === DIGITS[di]);
      h.digits[di].homeKey = cands.find((p) => p.key.isHome) ?? null;
    }

    // 2D rigid fit (yaw + translation) of nominal tips to home key centres.
    let n = 0;
    let hx = 0, hz = 0, kx = 0, kz = 0;
    for (let di = 0; di < THUMB; di++) {
      const pl = h.digits[di].homeKey;
      if (!pl) continue;
      n++;
      hx += nominal[di].x;
      hz += nominal[di].z;
      kx += pl.cx;
      kz += pl.cz;
    }
    const natural = -0.16 * sign; // fingers angled slightly towards the middle of the board
    let yaw = natural;
    if (n >= 2) {
      hx /= n; hz /= n; kx /= n; kz /= n;
      let a = 0;
      let b = 0;
      for (let di = 0; di < THUMB; di++) {
        const pl = h.digits[di].homeKey;
        if (!pl) continue;
        const ax = nominal[di].x - hx;
        const az = nominal[di].z - hz;
        const bx = pl.cx - kx;
        const bz = pl.cz - kz;
        a += bx * az - bz * ax;
        b += bx * ax + bz * az;
      }
      yaw = Math.atan2(a, b);
      // keep it anatomically plausible: between slightly outward and clearly inward
      const lo = sign > 0 ? -0.5 : -0.1;
      const hiL = sign > 0 ? 0.1 : 0.5;
      yaw = Math.min(hiL, Math.max(lo, yaw));
    } else if (n === 1) {
      hx /= n; hz /= n; kx /= n; kz /= n;
    } else {
      // No home keys for this hand: hover over its half of the board.
      const cx = (this.placed.minX + this.placed.maxX) / 2;
      const cz = (this.placed.minZ + this.placed.maxZ) / 2;
      for (let di = 0; di < THUMB; di++) {
        hx += nominal[di].x / THUMB;
        hz += nominal[di].z / THUMB;
      }
      kx = cx - sign * 3;
      kz = cz;
    }
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    h.rest.yaw = yaw;
    h.rest.x = kx - (hx * c + hz * s);
    h.rest.z = kz - (-hx * s + hz * c);
    h.rest.y = KEY_TOP + WRIST_HEIGHT;

    // Comfort search: slide and pivot the hand to where every finger rests on
    // its home key in a relaxed arch AND can still reach one row up (extending)
    // and one row down (curling) without the palm having to move.
    if (n > 0) {
      const yaw0 = h.rest.yaw;
      const x0 = h.rest.x;
      const z0 = h.rest.z;
      const reachErr = (di: number, pl: KeyPlacement, dz: number): number => {
        // (rows above / below are tested with the key pressed: the finger has to follow it down)
        worldToRoot(scratchPose, v1.set(pl.cx, dz ? KEY_TOP - KEY_TRAVEL : KEY_TOP, pl.cz + dz)).applyMatrix4(rig.fromRoot[di]);
        return solveChain(rig.chains[di], v1, scratchP, 16, 1e-4) * UNIT;
      };
      const cost = (ox: number, oz: number, oyaw: number): number => {
        // pivot about the middle of the home keys so yaw and translation stay independent
        scratchPose.yaw = yaw0 + oyaw;
        const c0 = Math.cos(yaw0);
        const s0 = Math.sin(yaw0);
        const c1 = Math.cos(scratchPose.yaw);
        const s1 = Math.sin(scratchPose.yaw);
        const lx = (kx - x0) * c0 - (kz - z0) * s0;
        const lz = (kx - x0) * s0 + (kz - z0) * c0;
        scratchPose.x = kx - (lx * c1 + lz * s1) + ox;
        scratchPose.z = kz - (-lx * s1 + lz * c1) + oz;
        scratchPose.y = h.rest.y;
        let sum = 0;
        for (let di = 0; di < THUMB; di++) {
          const pl = h.digits[di].homeKey;
          if (!pl) continue;
          const r = h.digits[di].restP;
          const chain = rig.chains[di];
          scratchP[0] = r[0];
          scratchP[1] = r[1];
          scratchP[2] = r[2];
          const err = reachErr(di, pl, 0);
          const p0 = scratchP[0];
          const p1 = scratchP[1];
          const p2 = scratchP[2];
          const a1 = p1 - r[1];
          const a2 = p2 - r[2];
          sum += 3 * p0 * p0 + POSTURE * (a1 * a1 + a2 * a2) + 400 * err * err;
          // a little spare range at home, so the resting pose is never against a joint limit
          const spare = Math.min(p1 - chain.min[1], p2 - chain.min[2]);
          if (spare < 0.1) sum += 40 * (0.1 - spare) * (0.1 - spare);
          const up = reachErr(di, pl, -ROW_RESERVE);
          scratchP[0] = p0;
          scratchP[1] = p1;
          scratchP[2] = p2;
          const down = reachErr(di, pl, ROW_RESERVE);
          sum += RESERVE * (up * up + down * down);
        }
        return sum;
      };
      let bx = 0;
      let bz = 0;
      let byaw = 0;
      let best = Infinity;
      for (let iy = -3; iy <= 3; iy++) {
        const oyaw = iy * 0.05;
        const y1 = yaw0 + oyaw;
        // keep it anatomically plausible: between slightly outward and clearly inward
        if (y1 * sign > 0.1 || y1 * sign < -0.5) continue;
        let cx = 0;
        let cz = 0;
        let cb = Infinity;
        for (let pass = 0; pass < 3; pass++) {
          const step = pass === 2 ? 0.05 : 0.2;
          const zr = pass === 2 ? 0.15 : 2;
          const xr = pass === 2 ? 0.15 : 0.8;
          const zc = cz;
          for (let oz = zc - zr; oz <= zc + zr + 1e-6; oz += step) {
            const c2 = cost(cx, oz, oyaw);
            if (c2 < cb) {
              cb = c2;
              cz = oz;
            }
          }
          const xc = cx;
          for (let ox = xc - xr; ox <= xc + xr + 1e-6; ox += step) {
            const c2 = cost(ox, cz, oyaw);
            if (c2 < cb) {
              cb = c2;
              cx = ox;
            }
          }
        }
        if (cb < best) {
          best = cb;
          bx = cx;
          bz = cz;
          byaw = oyaw;
        }
      }
      cost(bx, bz, byaw);
      h.rest.copy(scratchPose);
    }

    // Home contact points.
    const indexHome = h.digits[3].homeKey;
    for (let di = 0; di < 5; di++) {
      const d = h.digits[di];
      const carried = rootToWorld(h.rest, nominal[di].clone());
      // thumbs rest inward of the index finger (under the inner columns), like on a real space bar
      if (di === THUMB && indexHome) carried.x = indexHome.cx + sign * THUMB_INSET;
      if (di === THUMB) {
        // Thumb: this hand's thumb home key if the layout marks one, else the nearest thumb / space key.
        let cands = mine.filter((p) => p.key.finger!.finger === "thumb" && p.key.isHome);
        if (!cands.length) {
          cands = this.placed.list.filter((p) => p.key.base === " " || (p.key.finger?.finger === "thumb" && p.key.finger.hand === side));
        }
        let best: KeyPlacement | null = null;
        let bd = Infinity;
        for (const p of cands) {
          aimPoint(p, carried, v1);
          const dd = Math.hypot(v1.x - carried.x, v1.z - carried.z) - (p.key.base === " " ? 1 : 0);
          if (dd < bd) {
            bd = dd;
            best = p;
          }
        }
        // only rest on it if it is within comfortable thumb range
        d.homeKey = best && bd < 2.5 ? best : null;
      }
      if (d.homeKey) aimPoint(d.homeKey, carried, d.home);
      else d.home.copy(carried).setY(KEY_TOP + 0.3);
      // Settle the digit on its home point; if it cannot quite get there (thumbs
      // on far-away space bars), rest where it actually reaches instead.
      for (let pass = 0; pass < 3; pass++) {
        const r = d.restP;
        d.homeP[0] = r[0];
        d.homeP[1] = r[1];
        d.homeP[2] = r[2];
        worldToRoot(h.rest, v1.copy(d.home)).applyMatrix4(rig.fromRoot[di]);
        const err = solveChain(rig.chains[di], v1, d.homeP, 40, IK_TOL) * UNIT;
        if (err < 0.02) break;
        rootToWorld(h.rest, rig.tipInRoot(di, d.homeP[0], d.homeP[1], d.homeP[2], v3));
        if (d.homeKey && pointInKey(d.homeKey, v3.x, v3.z, -0.15)) d.home.set(v3.x, KEY_TOP, v3.z);
        else if (d.homeKey && pass === 0) aimPoint(d.homeKey, v3, d.home);
        else {
          d.homeKey = di === THUMB ? null : d.homeKey;
          d.home.copy(v3).setY(Math.max(v3.y, KEY_TOP + 0.25));
        }
      }
      d.p[0] = d.homeP[0];
      d.p[1] = d.homeP[1];
      d.p[2] = d.homeP[2];
      worldToRoot(h.rest, d.homeInRoot.copy(d.home));
      d.cur.copy(d.home);
      d.curR.copy(d.homeInRoot);
    }
  }

  private computeGoals(h: Hand): void {
    // Which reach drives the hand?
    let lead: Reach | null = h.target;
    let leadPoint: THREE.Vector3 | null = lead ? lead.point : null;
    let leadDigit = lead ? lead.digit : -1;
    if (!lead) {
      for (let di = 0; di < 5; di++) {
        if (h.digits[di].tapPhase) {
          leadDigit = di;
          leadPoint = h.digits[di].tapPoint;
          break;
        }
      }
    }
    if (leadDigit < 0 && h.modifier) {
      lead = h.modifier;
      leadDigit = lead.digit;
      leadPoint = lead.point;
    }

    if (leadPoint) this.reachPose(h, leadDigit, leadPoint, h.goal);
    else h.goal.copy(h.rest);
    h.lead = leadPoint ? leadDigit : -1;

    if (h.target) h.digits[h.target.digit].goal.copy(h.target.point);
    if (h.modifier && !(h.target && h.target.digit === h.modifier.digit)) h.digits[h.modifier.digit].goal.copy(h.modifier.point);
  }

  /**
   * Hand pose that puts `digit`'s pad on `point`. The finger does as much of
   * the reach as it comfortably can (extending / curling out of the relaxed
   * arch, spreading a little); the hand pivots slightly about the wrist for the
   * lateral part and translates only by what is left. Far keys therefore move
   * the whole hand, letter-row keys hardly at all.
   */
  private reachPose(h: Hand, digit: number, point: THREE.Vector3, out: Pose): void {
    const d = h.digits[digit];
    const rest = h.rest;
    out.copy(rest);
    const dxHome = point.x - d.home.x;
    const dzHome = point.z - d.home.z;
    if (Math.abs(dxHome) + Math.abs(dzHome) < 1e-3) return;

    const thumb = digit === THUMB;
    // Pivot about the wrist for the sideways part: gently for nearby keys (the
    // other fingers have to stay on their home keys), more for far ones.
    const reach = Math.hypot(dxHome, dzHome);
    const yawCap = YAW_NEAR + (YAW_MAX - YAW_NEAR) * Math.min(1, Math.max(0, reach - 1.9));
    let dyaw = thumb ? 0 : -YAW_PER_UNIT * dxHome;
    dyaw = Math.max(-yawCap, Math.min(yawCap, dyaw));
    out.yaw = rest.yaw + dyaw;
    // where the home point ends up from the pivot alone
    rootToWorld(out, v2.copy(d.homeInRoot));
    const remX = point.x - v2.x;
    const remZ = point.z - v2.z;

    // kx / kz = share of the remaining reach (sideways / along the fingers) taken
    // by the palm. Pick the comfortable combination with the least palm travel;
    // (1, 1) is a rigid move of the rest pose, which always works.
    const chain = h.rig.chains[digit];
    let bestX = 1;
    let bestZ = 1;
    let best = remX * remX + remZ * remZ;
    for (let ix = 0; ix < PALM_STEPS; ix++) {
      const kx = PALM_MIN + ((1 - PALM_MIN) * ix) / (PALM_STEPS - 1);
      const tx = remX * kx;
      if (tx * tx >= best) break;
      for (let iz = 0; iz < PALM_STEPS; iz++) {
        const kz = PALM_MIN + ((1 - PALM_MIN) * iz) / (PALM_STEPS - 1);
        const tz = remZ * kz;
        const travel = tx * tx + tz * tz;
        if (travel >= best) break;
        out.x = rest.x + tx;
        out.z = rest.z + tz;
        scratchP[0] = d.homeP[0];
        scratchP[1] = d.homeP[1];
        scratchP[2] = d.homeP[2];
        // (tested with the key fully pressed: the finger must be able to follow it down)
        v1.copy(point).y -= KEY_TRAVEL;
        worldToRoot(out, v1).applyMatrix4(h.rig.fromRoot[digit]);
        const err = solveChain(chain, v1, scratchP, 24, IK_TOL) * UNIT;
        if (err > 0.01) continue;
        // reject solutions pinned against a joint limit: they look strained
        let pinned = false;
        for (let j = 0; j < 3; j++) {
          if (scratchP[j] < chain.min[j] + 0.03 || scratchP[j] > chain.max[j] - 0.03) pinned = true;
        }
        if (pinned) continue;
        best = travel;
        bestX = kx;
        bestZ = kz;
        break;
      }
    }
    out.x = rest.x + remX * bestX;
    out.z = rest.z + remZ * bestZ;
  }

  /**
   * Settled result for a key without animating (same goal + IK code as the
   * live path): fingertip error, how far the hand had to move and how far the
   * other fingers of that hand end up from their home keys. Key units.
   */
  measure(id: string): KeyMeasure | null {
    const pl = this.placed.byId.get(id);
    const f = pl?.key.finger;
    if (!pl || !f) return null;
    const hi = f.hand === "L" ? 0 : 1;
    const h = this.hands[hi];
    const di = DIGITS.indexOf(f.finger);
    const d = h.digits[di];
    const pose = measurePose;
    const point = aimPoint(pl, d.home, new THREE.Vector3());
    this.reachPose(h, di, point, pose);
    const p = new Float64Array(d.homeP);
    const local = worldToRoot(pose, point.clone()).applyMatrix4(h.rig.fromRoot[di]);
    solveChain(h.rig.chains[di], local, p, 40, IK_TOL);
    const tip = rootToWorld(pose, h.rig.tipInRoot(di, p[0], p[1], p[2], new THREE.Vector3()));

    // the idle fingers of the same hand
    idleParams(h.rest, pose);
    let others = 0;
    let othersFinger = "";
    const q = new Float64Array(3);
    const t = new THREE.Vector3();
    for (let oi = 0; oi < 5; oi++) {
      const o = h.digits[oi];
      if (oi === di || !o.homeKey) continue;
      worldToRoot(pose, t.copy(o.home));
      const fl = idleFollow;
      t.set(t.x + (o.homeInRoot.x - t.x) * fl, o.homeInRoot.y + (oi === THUMB ? idleLift * 0.5 : idleLift), t.z + (o.homeInRoot.z - t.z) * fl);
      q.set(o.homeP);
      solveChain(h.rig.chains[oi], t.applyMatrix4(h.rig.fromRoot[oi]), q, 40, IK_TOL);
      rootToWorld(pose, h.rig.tipInRoot(oi, q[0], q[1], q[2], t));
      const off = Math.hypot(t.x - o.home.x, t.z - o.home.z);
      if (off > others) {
        others = off;
        othersFinger = DIGITS[oi];
      }
    }
    let homeZ = 0;
    let n = 0;
    for (let oi = 0; oi < THUMB; oi++) {
      const hk = h.digits[oi].homeKey;
      if (hk) {
        homeZ += hk.cz;
        n++;
      }
    }
    return {
      distance: r3(tip.distanceTo(point)),
      finger: `${f.hand} ${f.finger}`,
      row: n ? Math.round(pl.cz - homeZ / n) : 0,
      reach: r3(Math.hypot(point.x - d.home.x, point.z - d.home.z)),
      wrist: r3(Math.hypot(pose.x - h.rest.x, pose.z - h.rest.z)),
      palm: r3(palmShift(h.rest, pose)),
      yaw: r3(pose.yaw - h.rest.yaw),
      others: r3(others),
      othersFinger,
      joints: [r3(p[0]), r3(p[1]), r3(p[2])],
    };
  }
}

/** Distance the palm centre moves between two hand poses (key units). */
function palmShift(a: Pose, b: Pose): number {
  const ax = a.x + PALM_Z * Math.sin(a.yaw);
  const az = a.z + PALM_Z * Math.cos(a.yaw);
  const bx = b.x + PALM_Z * Math.sin(b.yaw);
  const bz = b.z + PALM_Z * Math.cos(b.yaw);
  return Math.hypot(bx - ax, bz - az);
}

/** Chain units -> key units (the rig's fixed uniform scale). */
const UNIT = HAND_SCALE;

function rootToWorld(pose: Pose, v: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  const x = v.x * c + v.z * s;
  const z = -v.x * s + v.z * c;
  v.x = x + pose.x;
  v.y += pose.y;
  v.z = z + pose.z;
  return v;
}

function worldToRoot(pose: Pose, v: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  const x = v.x - pose.x;
  const z = v.z - pose.z;
  v.y -= pose.y;
  v.x = x * c - z * s;
  v.z = x * s + z * c;
  return v;
}
