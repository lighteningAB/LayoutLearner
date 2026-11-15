// Tiny analytic-Jacobian-free IK for one digit: three joints, three parameters.
//
//   p[0]  joint 1, rotation about axisA  (fingers: lateral spread; thumb: swing in the palm plane)
//   p[1]  joint 1, rotation about axisB  (fingers: knuckle flexion; thumb: drop below the palm)
//   p[2]  joint 2, rotation about axisC2 (curl); joint 3 follows with `couple * p[2]`
//
// Three unknowns against a 3D fingertip target, solved with a few damped
// Gauss-Newton (Levenberg-Marquardt) steps on a finite-difference Jacobian and
// hard joint limits. Everything is expressed in the rest frame of the digit's
// (static) parent bone. No allocations after module load.

import * as THREE from "three";

export interface ChainDef {
  /** Uniform scale applied to bone 1 (already folded into t2, t3 and pad). */
  scale: number;
  /** Rest local positions of the three bones (bone 1 relative to the static parent). */
  t1: THREE.Vector3;
  t2: THREE.Vector3;
  t3: THREE.Vector3;
  /** Rest local rotations. */
  r1: THREE.Quaternion;
  r2: THREE.Quaternion;
  r3: THREE.Quaternion;
  /** Joint-1 axes, in the parent bone's frame. */
  axisA: THREE.Vector3;
  axisB: THREE.Vector3;
  /** Joint-2 axis in bone 1's rest frame; joint-3 axis in bone 2's rest frame. */
  axisC2: THREE.Vector3;
  axisC3: THREE.Vector3;
  /** Contact point (finger pad) in bone 3's frame. */
  pad: THREE.Vector3;
  couple: number;
  min: [number, number, number];
  max: [number, number, number];
  /** Natural relaxed typing posture. */
  rest: [number, number, number];
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const R = new THREE.Quaternion();
const v = new THREE.Vector3();
const tip0 = new THREE.Vector3();
const tipD = new THREE.Vector3();

/** Local rotations for the three bones given parameters `p`. */
export function chainRotations(
  d: ChainDef,
  p0: number,
  p1: number,
  p2: number,
  q1: THREE.Quaternion,
  q2: THREE.Quaternion,
  q3: THREE.Quaternion,
): void {
  qa.setFromAxisAngle(d.axisA, p0);
  qb.setFromAxisAngle(d.axisB, p1);
  q1.copy(qa).multiply(qb).multiply(d.r1);
  qa.setFromAxisAngle(d.axisC2, p2);
  q2.copy(qa).multiply(d.r2);
  qa.setFromAxisAngle(d.axisC3, p2 * d.couple);
  q3.copy(qa).multiply(d.r3);
}

const f1 = new THREE.Quaternion();
const f2 = new THREE.Quaternion();
const f3 = new THREE.Quaternion();

/** Forward kinematics: pad position in the parent bone's frame. */
export function chainTip(d: ChainDef, p0: number, p1: number, p2: number, out: THREE.Vector3): THREE.Vector3 {
  chainRotations(d, p0, p1, p2, f1, f2, f3);
  out.copy(d.t1);
  R.copy(f1);
  out.add(v.copy(d.t2).applyQuaternion(R));
  R.multiply(f2);
  out.add(v.copy(d.t3).applyQuaternion(R));
  R.multiply(f3);
  out.add(v.copy(d.pad).applyQuaternion(R));
  return out;
}

const H = 1e-3;
const J = new Float64Array(9); // column-major: J[c*3 + r]
const A = new Float64Array(9);
const g = new Float64Array(3);
const dl = new Float64Array(3);

function solve3(a: Float64Array, b: Float64Array, x: Float64Array): boolean {
  const a00 = a[0], a01 = a[1], a02 = a[2];
  const a11 = a[4], a12 = a[5], a22 = a[8];
  // symmetric 3x3 via cofactors
  const c00 = a11 * a22 - a12 * a12;
  const c01 = a02 * a12 - a01 * a22;
  const c02 = a01 * a12 - a02 * a11;
  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) < 1e-30) return false;
  const c11 = a00 * a22 - a02 * a02;
  const c12 = a01 * a02 - a00 * a12;
  const c22 = a00 * a11 - a01 * a01;
  const inv = 1 / det;
  x[0] = (c00 * b[0] + c01 * b[1] + c02 * b[2]) * inv;
  x[1] = (c01 * b[0] + c11 * b[1] + c12 * b[2]) * inv;
  x[2] = (c02 * b[0] + c12 * b[1] + c22 * b[2]) * inv;
  return true;
}

/**
 * Moves `p` (in place, warm start) so the pad approaches `target` (parent
 * frame). Returns the remaining distance in the chain's own units.
 */
export function solveChain(d: ChainDef, target: THREE.Vector3, p: Float64Array, iterations: number, tol: number): number {
  let err = 0;
  for (let it = 0; it <= iterations; it++) {
    chainTip(d, p[0], p[1], p[2], tip0);
    const ex = target.x - tip0.x;
    const ey = target.y - tip0.y;
    const ez = target.z - tip0.z;
    err = Math.sqrt(ex * ex + ey * ey + ez * ez);
    if (err < tol || it === iterations) break;
    for (let c = 0; c < 3; c++) {
      const old = p[c];
      p[c] = old + H;
      chainTip(d, p[0], p[1], p[2], tipD);
      p[c] = old;
      J[c * 3] = (tipD.x - tip0.x) / H;
      J[c * 3 + 1] = (tipD.y - tip0.y) / H;
      J[c * 3 + 2] = (tipD.z - tip0.z) / H;
    }
    let trace = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = r; c < 3; c++) {
        const s = J[r * 3] * J[c * 3] + J[r * 3 + 1] * J[c * 3 + 1] + J[r * 3 + 2] * J[c * 3 + 2];
        A[r * 3 + c] = s;
        A[c * 3 + r] = s;
      }
      trace += A[r * 4];
      g[r] = J[r * 3] * ex + J[r * 3 + 1] * ey + J[r * 3 + 2] * ez;
    }
    const lambda = trace * 4e-3 + 1e-12;
    A[0] += lambda;
    A[4] += lambda;
    A[8] += lambda;
    if (!solve3(A, g, dl)) break;
    for (let c = 0; c < 3; c++) {
      let step = dl[c];
      if (step > 0.6) step = 0.6;
      else if (step < -0.6) step = -0.6;
      let n = p[c] + step;
      if (n < d.min[c]) n = d.min[c];
      else if (n > d.max[c]) n = d.max[c];
      p[c] = n;
    }
  }
  return err;
}
