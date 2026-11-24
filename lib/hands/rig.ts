// Loads the rigged hand GLB (a single LEFT hand) and builds posable hand
// instances from it. The right hand is the same rig mirrored in x.
//
// The rig's bone rolls are not anatomical, so instead of rotating bones about
// their local axes we derive anatomical axes (palm normal, per-digit flexion
// axis) from the bind pose and express them in each joint's parent frame.

import { setHandModelProgress } from "./progress";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { chainRotations, chainTip, type ChainDef } from "./ik";
import { mixSRGB, type HandsTheme } from "./theme";
import { BODY_FRAGMENT, BODY_VERTEX, HULL_FRAGMENT, HULL_VERTEX } from "./handShaders";

// Served with an immutable one-year Cache-Control (next.config.js): bump when the file changes.
export const HAND_MODEL_URL = "/models/hand.glb?v=1";

/** Model units -> key units. ~50 gives an adult hand on a 19.05 mm pitch board. */
export const HAND_SCALE = 46;
/**
 * Wrist extension: the palm slopes up from the wrist to the knuckles (radians),
 * so the fingers arch over and come down onto the keys instead of lying flat.
 */
export const HAND_PITCH = 0.15;
/** Height of the wrist joint above the key tops (key units). */
export const WRIST_HEIGHT = 0.35;
/** Slight outward roll, thumb side up (radians). */
export const HAND_ROLL = 0.12;

/**
 * Per-digit length correction (pinky..thumb). The model's pinky is very short
 * next to its middle finger (0.64 : 1; real hands are about 0.75 : 1), which
 * left it unable to reach the rows above and below without dragging the hand.
 */
const DIGIT_SCALE = [1.12, 0.96, 0.94, 1.04, 0.92];

/**
 * Transverse arch of the palm: how far the metacarpal of each digit is lifted
 * (radians, pinky..thumb). Raising the knuckles of the two long fingers lets
 * them rest on a straight home row without having to curl up like a claw.
 */
const PALM_ARCH = [0.12, 0.12, 0.16, 0, 0];
// Metacarpal bones (children of the hand bone), pinky..index.
const PALM_BONES = ["palm04L001", "palm03L001", "palm02L001", "palm01L001"];

/** Length the forearm is stretched to, and where along it the fade to nothing starts / ends (key units behind the wrist). */
const FOREARM_LENGTH = 11;
const FOREARM_FADE: [number, number] = [4.5, 10];

/** Digit order inside one hand. */
export const DIGITS = ["pinky", "ring", "middle", "index", "thumb"] as const;
export const THUMB = 4;

// Names as sanitised by GLTFLoader (dots stripped).
const BONES: [string, string, string][] = [
  ["finger_pinky01L", "finger_pinky02L", "finger_pinky03L"],
  ["finger_ring01L", "finger_ring02L", "finger_ring03L"],
  ["finger_middle01L", "finger_middle02L", "finger_middle03L"],
  ["finger_index01L", "finger_index02L", "finger_index03L"],
  ["thumb01L", "thumb02L", "thumb03L"],
];

//                 spread / swing     knuckle / drop     curl
// (knuckle angles are relative to the palm plane, which is pitched up by HAND_PITCH)
const LIMITS_MIN: [number, number, number][] = [
  [-0.5, -0.3, 0.08],
  [-0.38, -0.3, 0.08],
  [-0.38, -0.3, 0.08],
  [-0.5, -0.3, 0.08],
  [-0.95, -0.35, -0.3],
];
const LIMITS_MAX: [number, number, number][] = [
  [0.5, 1.45, 1.75],
  [0.38, 1.45, 1.75],
  [0.38, 1.45, 1.75],
  [0.5, 1.45, 1.75],
  [0.8, 1.0, 1.35],
];
// Relaxed arch: knuckles gently flexed, middle joints bent, with plenty of
// extension AND curl left in reserve for the rows above and below.
const REST: [number, number, number][] = [
  [0, 0.5, 0.5],
  [0, 0.55, 0.7],
  [0, 0.55, 0.75],
  [0, 0.55, 0.6],
  [0.05, 0.3, 0.3],
];

export interface HandTemplate {
  armature: THREE.Object3D;
  chains: ChainDef[];
  /** Per vertex (x, y, z): the digit it belongs to (0 when none), how much it is that digit's tip (0..1), how much it is part of that finger at all (0..1). */
  digit: Float32Array;
  /** Per vertex: position along the hand's long axis, key units (0 at the wrist, positive towards the fingertips). */
  axis: Float32Array;
  /** Per finger (pinky..index): axis in the hand bone's frame about which its metacarpal lifts. */
  archAxes: THREE.Vector3[];
  /** Per vertex: distance behind the wrist along the forearm, key units (0 on the hand itself). */
  back: Float32Array;
}

const cache = new Map<string, Promise<HandTemplate>>();

export function loadHandTemplate(url: string = HAND_MODEL_URL): Promise<HandTemplate> {
  let p = cache.get(url);
  if (!p) {
    setHandModelProgress({ phase: "loading", loaded: 0, total: 0 });
    p = new GLTFLoader()
      .loadAsync(url, (e) => setHandModelProgress({ loaded: e.loaded, total: e.lengthComputable ? e.total : 0 }))
      .then((gltf) => buildTemplate(gltf.scene));
    p.then(
      () => setHandModelProgress({ phase: "done" }),
      () => {
        cache.delete(url);
        setHandModelProgress({ phase: "error" });
      },
    );
    cache.set(url, p);
  }
  return p;
}

function buildTemplate(scene: THREE.Object3D): HandTemplate {
  scene.updateMatrixWorld(true);
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
  });
  if (!mesh) throw new Error("hand model: no skinned mesh");
  const skinned = mesh as THREE.SkinnedMesh;
  const armature = skinned.parent ?? scene;
  const bones = skinned.skeleton.bones;
  const byName = (n: string) => {
    const b = bones.find((x) => x.name === n);
    if (!b) throw new Error(`hand model: bone ${n} missing`);
    return b;
  };

  // The geometry is stored in bind *world* space (glTF skinning ignores the mesh node).
  const pos = skinned.geometry.getAttribute("position");
  const si = skinned.geometry.getAttribute("skinIndex");
  const sw = skinned.geometry.getAttribute("skinWeight");
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const digitInfo = new Float32Array(pos.count * 3);
  const axis = new Float32Array(pos.count);

  const archAxes: THREE.Vector3[] = [];
  const chains: ChainDef[] = BONES.map((names, digit) => {
    const [b1, b2, b3] = names.map(byName);
    const parent = b1.parent as THREE.Object3D;
    const i3 = bones.indexOf(b3);
    const p1 = new THREE.Vector3().setFromMatrixPosition(b1.matrixWorld);
    const p3 = new THREE.Vector3().setFromMatrixPosition(b3.matrixWorld);
    const dir3 = new THREE.Vector3().setFromMatrixColumn(b3.matrixWorld, 1).normalize();

    // Length of the distal segment + where its underside is.
    let len = 0;
    const owned: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      let best = -1;
      let bw = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bw) {
          bw = w;
          best = si.getComponent(i, k);
        }
      }
      if (best !== i3) continue;
      v.fromBufferAttribute(pos, i);
      owned.push(v.clone());
      len = Math.max(len, v.clone().sub(p3).dot(dir3));
    }
    if (len <= 0) len = 0.02;
    const along = len * 0.8;
    let minY = Infinity;
    for (const o of owned) {
      const t = o.clone().sub(p3).dot(dir3);
      if (Math.abs(t - along) < len * 0.3) minY = Math.min(minY, o.y);
    }
    const padWorld = p3.clone().addScaledVector(dir3, along);
    if (Number.isFinite(minY)) padWorld.y = minY;

    // Fingertip tint: fades in over the distal segment so the colour sits at the very tip.
    for (let i = 0; i < pos.count; i++) {
      let w3 = 0;
      for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === i3) w3 += sw.getComponent(i, k);
      if (w3 <= 0) continue;
      const t = v.fromBufferAttribute(pos, i).sub(p3).dot(dir3) / len;
      const w = w3 * THREE.MathUtils.smoothstep(t, 0.0, 0.5);
      if (w > digitInfo[i * 3 + 1]) digitInfo[i * 3 + 1] = Math.min(1, w);
    }
    // Finger membership: how much of the vertex follows this digit's three bones.
    const own = names.map((n) => bones.indexOf(byName(n)));
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (own.includes(si.getComponent(i, k))) w += sw.getComponent(i, k);
      if (w > digitInfo[i * 3 + 2]) {
        digitInfo[i * 3 + 2] = Math.min(1, w);
        digitInfo[i * 3] = digit;
      }
    }

    // Anatomical axes in bind world space.
    const tipWorld = p3.clone().addScaledVector(dir3, len);
    const d = tipWorld.clone().sub(p1);
    d.y = 0;
    d.normalize();
    const flex = new THREE.Vector3().crossVectors(up, d).normalize();
    const isThumb = digit === THUMB;
    const axisAw = up;
    const axisBw = flex;
    const axisCw = isThumb ? up : flex;

    const qParent = new THREE.Quaternion();
    const q1 = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    parent.getWorldQuaternion(qParent);
    b1.getWorldQuaternion(q1);
    b2.getWorldQuaternion(q2);
    const toFrame = (axis: THREE.Vector3, q: THREE.Quaternion) =>
      axis.clone().applyQuaternion(q.clone().invert()).normalize();
    if (!isThumb) {
      const meta = byName(PALM_BONES[digit]);
      archAxes.push(toFrame(flex, (meta.parent as THREE.Object3D).getWorldQuaternion(new THREE.Quaternion())));
    }

    const ds = DIGIT_SCALE[digit];
    return {
      scale: ds,
      t1: b1.position.clone(),
      t2: b2.position.clone().multiplyScalar(ds),
      t3: b3.position.clone().multiplyScalar(ds),
      r1: b1.quaternion.clone(),
      r2: b2.quaternion.clone(),
      r3: b3.quaternion.clone(),
      axisA: toFrame(axisAw, qParent),
      axisB: toFrame(axisBw, qParent),
      axisC2: toFrame(axisCw, q1),
      axisC3: toFrame(axisCw, q2),
      pad: b3.worldToLocal(padWorld.clone()).multiplyScalar(ds),
      couple: isThumb ? 0.6 : 0.66,
      min: LIMITS_MIN[digit],
      max: LIMITS_MAX[digit],
      rest: REST[digit],
    };
  });

  // Forearm: the model only has a short stub that ends in an open cut. Stretch
  // it (those vertices follow bones we never move) so that it always runs out
  // of the frame, even when the hand reaches for the far corners of the board,
  // and record how far behind the wrist each vertex is so the material can
  // dissolve the far end (see FOREARM_FADE).
  const backDist = new Float32Array(pos.count);
  const wrist = new THREE.Vector3().setFromMatrixPosition(byName("handL").matrixWorld);
  const back = new THREE.Vector3().setFromMatrixColumn(byName("handL").matrixWorld, 1).normalize().negate();
  let maxBack = 0;
  for (let i = 0; i < pos.count; i++) {
    const t = v.fromBufferAttribute(pos, i).sub(wrist).dot(back);
    maxBack = Math.max(maxBack, t);
    axis[i] = -t * HAND_SCALE;
  }
  if (maxBack > 0) {
    const t0 = maxBack * 0.2; // leave the wrist itself alone
    const stretch = Math.max(1, (FOREARM_LENGTH / HAND_SCALE - t0) / (maxBack - t0));
    for (let i = 0; i < pos.count; i++) {
      const t = v.fromBufferAttribute(pos, i).sub(wrist).dot(back);
      if (t <= 0) continue;
      const extra = t > t0 ? (t - t0) * (stretch - 1) : 0;
      if (extra > 0) {
        v.fromBufferAttribute(pos, i).addScaledVector(back, extra);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      backDist[i] = (t + extra) * HAND_SCALE;
      axis[i] = -backDist[i];
    }
    // Close the open cut: pull its rim together into one point. The end is fully dissolved anyway,
    // but a closed tube means the outline pass can never be seen from inside through the hole.
    const rim: number[] = [];
    const centre = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      if (backDist[i] < (FOREARM_LENGTH - 0.25) * 0.999) continue;
      rim.push(i);
      centre.add(v.fromBufferAttribute(pos, i));
    }
    if (rim.length) {
      centre.divideScalar(rim.length);
      for (const i of rim) pos.setXYZ(i, centre.x, centre.y, centre.z);
    }
    pos.needsUpdate = true;
    skinned.geometry.computeBoundingSphere();
  }

  return { armature, chains, archAxes, digit: digitInfo, axis, back: backDist };
}

const tmpQ1 = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpQ3 = new THREE.Quaternion();
const tmpV2 = new THREE.Vector2();

/** Silhouette line weight (CSS px): heavier than the key outlines, like an object line over construction lines. */
const OUTLINE_W = 2.75;
/** Contour (section) lines across the hand: spacing along the hand in key units, weight in CSS px. */
const CONTOUR_STEP = 0.5;
const CONTOUR_W = 1;
/** Time constant of the reaching-finger emphasis (s). */
const EMPH_SMOOTH = 0.07;
/** Emphasis of a finger that is holding a key (the reaching finger gets 1). */
const HOLD_EMPH = 0.55;

/**
 * One posable hand, drawn as see-through line art in three passes over the same skinned geometry:
 * a depth pre-pass (so the hand never shows through itself), a screen-space hull that leaves a
 * constant-width silhouette outline, and an unlit translucent body with contour lines and
 * finger-coloured tips. `root` is positioned/yawed in world space by the controller.
 */
export class HandRig {
  readonly side: "L" | "R";
  readonly root = new THREE.Group();
  readonly chains: ChainDef[];
  /** Per digit: digit-parent-bone frame -> root frame (root at identity), and inverse. */
  readonly toRoot: THREE.Matrix4[] = [];
  readonly fromRoot: THREE.Matrix4[] = [];

  private bones: THREE.Bone[][] = [];
  private mesh: THREE.SkinnedMesh;
  private depthMesh: THREE.SkinnedMesh;
  private hullMesh: THREE.SkinnedMesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private hullMaterial: THREE.ShaderMaterial;
  private depthMaterial: THREE.MeshBasicMaterial;
  /** Shared by the body and hull passes. */
  private uniforms = {
    uFinger: { value: [0, 1, 2, 3, 4].map(() => new THREE.Color()) },
    /** Per digit 0..1: how emphasised (reaching / holding) it is. */
    uEmph: { value: [0, 0, 0, 0, 0] },
    uBody: { value: new THREE.Color() },
    uLine: { value: new THREE.Color() },
    /** x: body alpha, y: extra alpha towards the silhouette, z: fingertip alpha, w: contour line alpha. */
    uLook: { value: new THREE.Vector4(0.3, 0.16, 0.26, 0.36) },
    /** x: outline px, y: contour px, z: device pixel ratio, w: contour spacing. */
    uLines: { value: new THREE.Vector4(OUTLINE_W, CONTOUR_W, 1, CONTOUR_STEP) },
    uFade: { value: new THREE.Vector2(FOREARM_FADE[0], FOREARM_FADE[1]) },
    /** Canvas size in CSS px. */
    uRes: { value: new THREE.Vector2(1, 1) },
  };

  constructor(template: HandTemplate, side: "L" | "R") {
    this.side = side;
    this.chains = template.chains;
    const arm = cloneSkinned(template.armature);
    arm.position.set(0, 0, 0);
    arm.quaternion.identity();
    arm.scale.set(1, 1, 1);

    const fixed = new THREE.Group();
    fixed.matrixAutoUpdate = false;
    const m = new THREE.Matrix4();
    fixed.matrix.identity();
    if (side === "R") fixed.matrix.multiply(m.makeScale(-1, 1, 1));
    fixed.matrix
      .multiply(m.makeRotationZ(HAND_ROLL))
      .multiply(m.makeRotationX(HAND_PITCH))
      .multiply(m.makeScale(HAND_SCALE, HAND_SCALE, HAND_SCALE))
      .multiply(m.makeRotationY(-Math.PI / 2));
    fixed.add(arm);
    this.root.add(fixed);
    this.root.rotation.order = "YXZ";

    let mesh: THREE.SkinnedMesh | null = null;
    arm.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    this.mesh = mesh as unknown as THREE.SkinnedMesh;
    const skeleton = this.mesh.skeleton;

    // palm arch (static): lift the metacarpals before the digit frames are measured
    for (let d = 0; d < PALM_BONES.length; d++) {
      const meta = skeleton.bones.find((b) => b.name === PALM_BONES[d]);
      if (meta && PALM_ARCH[d]) meta.quaternion.premultiply(tmpQ1.setFromAxisAngle(template.archAxes[d], -PALM_ARCH[d]));
    }
    this.root.updateMatrixWorld(true);
    for (const names of BONES) {
      const bs = names.map((n) => skeleton.bones.find((b) => b.name === n) as THREE.Bone);
      bs[0].scale.setScalar(this.chains[this.bones.length].scale);
      this.bones.push(bs);
      const parent = bs[0].parent as THREE.Object3D;
      const toRoot = parent.matrixWorld.clone();
      this.toRoot.push(toRoot);
      this.fromRoot.push(toRoot.clone().invert());
    }

    // Per-hand geometry (the attribute arrays are shared with the template; colours are uniforms).
    this.geometry = this.mesh.geometry.clone();
    this.geometry.setAttribute("aDigit", new THREE.BufferAttribute(template.digit, 3));
    this.geometry.setAttribute("aBack", new THREE.BufferAttribute(template.back, 1));
    this.geometry.setAttribute("aAxis", new THREE.BufferAttribute(template.axis, 1));

    // Body: an unlit veil that stays see-through everywhere (legends under the hand must remain
    // readable), a little denser towards the silhouette, with contour lines and coloured fingertips.
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: BODY_VERTEX,
      fragmentShader: BODY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      toneMapped: false,
    });
    // Outline: back faces pushed out along the screen-space normal by a fixed number of pixels;
    // behind the depth pre-pass only the margin outside the silhouette survives.
    this.hullMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: HULL_VERTEX,
      fragmentShader: HULL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      // ...and, nudged back in depth, it also loses against the hand's own inside (the pre-pass writes
      // both faces) where the model's forearm has gaps that would otherwise show the hull from within
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
      toneMapped: false,
    });
    // Depth pre-pass: the translucent hand never shows its own back faces or
    // overlapping fingers through itself, only the keyboard underneath. It is
    // flagged transparent only so it sorts by renderOrder with the other passes: pre-pass 10, veil 11,
    // outline 12; the key legends come after all of them (14), so they stay whole and at full contrast.
    this.depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, transparent: true });

    const parent = this.mesh.parent as THREE.Object3D;
    this.mesh.geometry = this.geometry;
    this.mesh.material = this.material;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.castShadow = false;

    this.depthMesh = new THREE.SkinnedMesh(this.geometry, this.depthMaterial);
    this.depthMesh.bind(skeleton, this.mesh.bindMatrix);
    this.depthMesh.frustumCulled = false;
    this.depthMesh.renderOrder = 10;
    // first pass of the hand each frame: refresh the screen metrics the line widths depend on
    this.depthMesh.onBeforeRender = (renderer) => {
      renderer.getSize(tmpV2);
      this.uniforms.uRes.value.copy(tmpV2);
      this.uniforms.uLines.value.z = renderer.getPixelRatio();
    };
    parent.add(this.depthMesh);

    this.hullMesh = new THREE.SkinnedMesh(this.geometry, this.hullMaterial);
    this.hullMesh.bind(skeleton, this.mesh.bindMatrix);
    this.hullMesh.frustumCulled = false;
    this.hullMesh.renderOrder = 12;
    parent.add(this.hullMesh);

    for (let d = 0; d < 5; d++) this.setDigit(d, this.chains[d].rest[0], this.chains[d].rest[1], this.chains[d].rest[2]);
  }

  /** Applies joint parameters to one digit's bones. */
  setDigit(digit: number, p0: number, p1: number, p2: number): void {
    const b = this.bones[digit];
    chainRotations(this.chains[digit], p0, p1, p2, tmpQ1, tmpQ2, tmpQ3);
    b[0].quaternion.copy(tmpQ1);
    b[1].quaternion.copy(tmpQ2);
    b[2].quaternion.copy(tmpQ3);
  }

  /** Pad position in root space (root at identity) for the given parameters. */
  tipInRoot(digit: number, p0: number, p1: number, p2: number, out: THREE.Vector3): THREE.Vector3 {
    return chainTip(this.chains[digit], p0, p1, p2, out).applyMatrix4(this.toRoot[digit]);
  }

  /**
   * Eases the emphasis of each digit towards its goal: 1 for `reaching` (-1: none), HOLD_EMPH for the
   * digits in `holding` (bit per digit), 0 otherwise. `dt` <= 0 jumps. Returns true while still changing.
   */
  updateEmphasis(reaching: number, holding: number, dt: number): boolean {
    const e = this.uniforms.uEmph.value;
    const k = dt > 0 ? 1 - Math.exp(-Math.min(dt, 0.05) / EMPH_SMOOTH) : 1;
    let moving = false;
    for (let d = 0; d < 5; d++) {
      const goal = d === reaching ? 1 : holding & (1 << d) ? HOLD_EMPH : 0;
      const diff = goal - e[d];
      if (diff === 0) continue;
      if (Math.abs(diff) < 0.004) e[d] = goal;
      else {
        e[d] += diff * k;
        moving = true;
      }
    }
    return moving;
  }

  applyTheme(theme: HandsTheme): void {
    // Everything is a uniform derived from the tokens: a veil in the sheet's own tone (so the hand
    // reads as a region of the drawing, not an object lying on it), linework in the line colour,
    // fingertips in the finger colours.
    const u = this.uniforms;
    mixSRGB(u.uBody.value, theme.bg, theme.text, 0.14);
    u.uLine.value.copy(theme.text);
    for (let d = 0; d < 5; d++) {
      // FINGER_ORDER: L pinky..thumb = 0..4, R thumb..pinky = 5..9
      u.uFinger.value[d].copy(theme.fingers[this.side === "L" ? d : 9 - d]);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.hullMaterial.dispose();
    this.depthMaterial.dispose();
    this.mesh.skeleton.dispose();
  }
}
