// Maps a ParsedLayout (key units, y down) into the 3D world used by the hands
// scene: 1 world unit = 1u, +x right, +z towards the typist, +y up. The layout's
// bounding box is centred on the origin and key tops sit at y = KEY_TOP.

import * as THREE from "three";
import { fingerIndex, type LayoutKey, type ParsedLayout } from "../types";

/** Height of a key top above the plate (world units). */
export const KEY_TOP = 0.36;
/** How far a key travels when pressed. */
export const KEY_TRAVEL = 0.14;
/** Visual gap between neighbouring caps. */
export const KEY_GAP = 0.08;

export interface KeyPlacement {
  key: LayoutKey;
  /** World-space centre of the key top. */
  cx: number;
  cz: number;
  /** Rotation about +y in radians (KLE clockwise angle negated). */
  rotY: number;
  w: number;
  h: number;
  /** 0..9 (FINGER_ORDER) or -1 when the key has no finger. */
  fingerIdx: number;
}

export interface PlacedLayout {
  layout: ParsedLayout;
  list: KeyPlacement[];
  byId: Map<string, KeyPlacement>;
  /** World-space bounds of all keys. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function placeLayout(layout: ParsedLayout): PlacedLayout {
  const raw = layout.keys.map((key) => {
    let cx = key.x + key.w / 2;
    let cy = key.y + key.h / 2;
    let rotY = 0;
    const r = key.rotation;
    if (r && r.angle) {
      const a = (r.angle * Math.PI) / 180;
      const dx = cx - r.cx;
      const dy = cy - r.cy;
      cx = r.cx + dx * Math.cos(a) - dy * Math.sin(a);
      cy = r.cy + dx * Math.sin(a) + dy * Math.cos(a);
      rotY = -a;
    }
    return { key, cx, cy, rotY };
  });
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const k of raw) {
    const half = Math.hypot(k.key.w, k.key.h) / 2;
    const ex = k.rotY ? half : k.key.w / 2;
    const ez = k.rotY ? half : k.key.h / 2;
    minX = Math.min(minX, k.cx - ex);
    maxX = Math.max(maxX, k.cx + ex);
    minZ = Math.min(minZ, k.cy - ez);
    maxZ = Math.max(maxZ, k.cy + ez);
  }
  if (!raw.length) {
    minX = minZ = 0;
    maxX = maxZ = 1;
  }
  const ox = (minX + maxX) / 2;
  const oz = (minZ + maxZ) / 2;
  const list: KeyPlacement[] = raw.map((k) => ({
    key: k.key,
    cx: k.cx - ox,
    cz: k.cy - oz,
    rotY: k.rotY,
    w: k.key.w,
    h: k.key.h,
    fingerIdx: k.key.finger ? fingerIndex(k.key.finger) : -1,
  }));
  const byId = new Map<string, KeyPlacement>();
  for (const p of list) byId.set(p.key.id, p);
  return { layout, list, byId, minX: minX - ox, maxX: maxX - ox, minZ: minZ - oz, maxZ: maxZ - oz };
}

/**
 * Point on the key top a finger should land on. Normal keys: the centre. Very
 * wide/tall keys (space bars): the point of the key closest to `natural`
 * (where the finger would be anyway), kept away from the key's ends.
 */
export function aimPoint(p: KeyPlacement, natural: THREE.Vector3 | null, out: THREE.Vector3): THREE.Vector3 {
  // (`out` may alias `natural`)
  const dx = natural ? natural.x - p.cx : 0;
  const dz = natural ? natural.z - p.cz : 0;
  out.set(p.cx, KEY_TOP, p.cz);
  if (!natural || Math.max(p.w, p.h) <= 2.8) return out;
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  // world -> key-local (inverse of rotation about +y)
  let lx = dx * c - dz * s;
  let lz = dx * s + dz * c;
  const mx = Math.max(0, p.w / 2 - 0.7);
  const mz = Math.max(0, p.h / 2 - 0.3);
  lx = Math.min(mx, Math.max(-mx, lx));
  lz = Math.min(mz, Math.max(-mz, lz));
  out.x = p.cx + lx * c + lz * s;
  out.z = p.cz - lx * s + lz * c;
  return out;
}

/** True if the world point lies over the key (xz), with `margin` slack in key units. */
export function pointInKey(p: KeyPlacement, x: number, z: number, margin = 0): boolean {
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const dx = x - p.cx;
  const dz = z - p.cz;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= p.w / 2 + margin && Math.abs(lz) <= p.h / 2 + margin;
}
