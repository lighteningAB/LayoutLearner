"use client";

// 3D keyboard + two rigged hands that show which finger presses which key,
// rendered as a drafted line drawing: unlit fills and constant-width lines, no
// lights and no shadows, on a transparent canvas so the sheet shows through.
// Client-only (WebGL). Import the SSR-safe wrapper from "components/hands".

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ParsedLayout } from "../../lib/types";
import { Keyboard3D } from "../../lib/hands/keyboard3d";
import { HandsController } from "../../lib/hands/pose";
import { HandRig, loadHandTemplate, type HandTemplate } from "../../lib/hands/rig";
import { KEY_GAP, KEY_TOP, placeLayout, type KeyPlacement, type PlacedLayout } from "../../lib/hands/space";
import { readTheme, watchTheme, type HandsTheme } from "../../lib/hands/theme";

export type HandsCamera = "top" | "angled" | "front";

/** Where one key is on the canvas: the midpoint of the cap edge that is highest on screen, in CSS px from the canvas's top-left. */
export interface HandsAnchor {
  /** The key this anchor is for (null: none). */
  keyId: string | null;
  x: number;
  y: number;
  /** false when the key is not on the board or lies outside the canvas. */
  visible: boolean;
}

/** Screen positions for annotations drawn over the canvas (leader lines). One object per scene, mutated in place. */
export interface HandsAnchors {
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  target: HandsAnchor;
  /** The first two held keys, in `holdKeyIds` order. */
  holds: [HandsAnchor, HandsAnchor];
}

export interface HandsSceneProps {
  layout: ParsedLayout;
  /** Next key to press: the assigned finger reaches for it and the key is filled in that finger's colour. */
  targetKeyId?: string | null;
  /**
   * Keys to keep held while `targetKeyId` is pressed (a layer key under a thumb, Shift under a pinky, ...).
   * Each is held by its own `finger`; ids not on the board or without a finger are ignored. A finger whose
   * key stays in the list across target changes stays down.
   */
  holdKeyIds?: readonly string[] | null;
  /** @deprecated single held key; use `holdKeyIds`. Appended to `holdKeyIds` when both are given. */
  modifierKeyId?: string | null;
  /** Tap animation on `keyId` whenever `nonce` changes. */
  press?: { keyId: string; nonce: number } | null;
  /** Colour of the tap flash: accent when true (default), error when false. */
  pressedOk?: boolean;
  /** "angled" (default): from above-behind, like looking at your own hands. "top": straight down. "front": low, from the typist's side. */
  camera?: HandsCamera;
  /** Orbit / zoom with the pointer. */
  interactive?: boolean;
  /** Tint idle keys with their finger's colour (default true). */
  fingerZones?: boolean;
  /** Show the hands (default true). With false only the 3D keyboard is drawn. */
  showHands?: boolean;
  /**
   * Called from the frame loop whenever the target key, a held key, the camera or the canvas size moved
   * what an annotation over the canvas must point at. The argument is one object reused for every call
   * (read it, do not keep copies of its parts); nothing is allocated per frame and React is not involved.
   */
  onAnchors?: (anchors: Readonly<HandsAnchors>) => void;
  /** Reports "loading" until the first frame with the rest-posed hands and the fitted camera has been drawn, then "ready" (or "error"). */
  onStatus?: (status: "loading" | "ready" | "error" | "nowebgl") => void;
  /** Dev only: exposes `window.__hands` and keeps the drawing buffer for screenshots. */
  debug?: boolean;
  className?: string;
}

type Status = "loading" | "ready" | "error" | "nowebgl";

const ELEVATION: Record<HandsCamera, number> = { angled: 62, top: 89.6, front: 27 };
const FOV = 30;

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * The framing must show the board and the fingers on it (FRAME_MIN key units past the board's front
 * edge): that decides the scale, so the board is always as large as the canvas allows. Height the
 * canvas has to spare at that scale then goes, in this order, to headroom past the far row (HEADROOM
 * key units, for fingers reaching over it) and to the hands, up to FRAME_MAX key units behind the
 * wrist joints. The forearms always run out of the frame.
 */
const FRAME_MIN = 0.5;
const FRAME_MAX = 3;
const HEADROOM = 0.6;
/** Height above the plate (key units) that the hands stay under. */
const HAND_TOP = 1.3;
const BOARD_TOP = 0.4;
/** Canvases narrower than this (CSS px) frame the letter block instead of the whole board, so its legends stay readable. */
const NARROW_CANVAS = 560;
/** Size of a word legend ("Shift") in key units, and the smallest it may be drawn on screen (CSS px) before word legends are left out. */
const WORD_LEGEND = 0.28;
const MIN_LEGEND_PX = 10.5;

const isLetterKey = (p: KeyPlacement) => p.key.isHome || /^\p{L}$/u.test(p.key.base.trim());

/**
 * World-space points the camera must keep in view: the main key block plus both hands. With
 * `lettersOnly` the block is only as wide as its letter keys (the outer keys run off the canvas).
 */
function focusPoints(placed: PlacedLayout, controller: HandsController | null, extraIds: string[] = [], lettersOnly = false, reach = 1, headroom = 1): THREE.Vector3[] {
  const homes = placed.list.filter((p) => p.key.isHome);
  let cx = 0;
  let hz = (placed.minZ + placed.maxZ) / 2;
  if (homes.length) {
    cx = homes.reduce((s, p) => s + p.cx, 0) / homes.length;
    hz = homes.reduce((s, p) => s + p.cz, 0) / homes.length;
  }
  const box = new THREE.Box3();
  for (const p of placed.list) {
    // skip numpads / far clusters unless the hands are being sent there
    if (Math.abs(p.cx - cx) > mainBlock(placed) && !extraIds.includes(p.key.id)) continue;
    // a far key the hand is sent to: leave room for the hand around it, not just the key
    const far = Math.abs(p.cx - cx) > mainBlock(placed) ? 2.4 : 0;
    if (lettersOnly && !far && !isLetterKey(p)) {
      // outer keys still set the depth of the frame (the thumbs need their row), not its width
      box.expandByPoint(new THREE.Vector3(cx, 0, p.cz - p.h / 2));
      box.expandByPoint(new THREE.Vector3(cx, 0, p.cz + p.h / 2));
      continue;
    }
    box.expandByPoint(new THREE.Vector3(p.cx - p.w / 2 - far, 0, p.cz - p.h / 2));
    box.expandByPoint(new THREE.Vector3(p.cx + p.w / 2 + far, 0, p.cz + p.h / 2));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-7, 0, -2.5), new THREE.Vector3(7, 0, 2.5));
  box.expandByVector(new THREE.Vector3(0.45, 0, 0.45));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? BOARD_TOP : -0.3, i & 4 ? box.max.z : box.min.z));
  // fingers reaching for the far row arch above and past it: `headroom` 0..1 keeps them inside the frame
  const headY = BOARD_TOP + (HAND_TOP - BOARD_TOP) * headroom;
  pts.push(new THREE.Vector3(box.min.x + 2, headY, box.min.z - HEADROOM * headroom), new THREE.Vector3(box.max.x - 2, headY, box.min.z - HEADROOM * headroom));
  // hands: from just beyond the home row back to the wrists
  let wristZ = hz + 5;
  // (room beside the wrists for the spread fingers; a letters-only frame keeps just the fingers at rest)
  const beside = lettersOnly ? 1.6 : 2.6;
  let x0 = cx - 3.4 - beside;
  let x1 = cx + 3.4 + beside;
  if (controller) {
    wristZ = Math.max(...controller.hands.map((h) => h.rest.z));
    x0 = Math.min(...controller.hands.map((h) => h.rest.x)) - beside;
    x1 = Math.max(...controller.hands.map((h) => h.rest.x)) + beside;
  }
  if (lettersOnly) {
    // the letter block alone sets the width: the outer edges of the hands may run off the canvas
    x0 = Math.max(x0, box.min.x);
    x1 = Math.min(x1, box.max.x);
  }
  // `reach` 0..1: from just past the board's front edge back to behind the wrists
  const near = Math.min(box.max.z + FRAME_MIN, wristZ + FRAME_MAX);
  const backZ = near + (wristZ + FRAME_MAX - near) * reach;
  // (the hands are as wide as their spread fingers over the keys and narrow to the wrists towards the typist)
  for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 4 ? (i & 1 ? x1 - 0.8 : x0 + 0.8) : i & 1 ? x1 : x0, i & 2 ? (i & 4 ? 1 : BOARD_TOP + 0.6) : 0, i & 4 ? backZ : hz - 1));
  return pts;
}

/** Keys further than this (key units, in x) from the home keys are outside the default framing. */
const MAIN_BLOCK = 9.6;

const blockCache = new WeakMap<PlacedLayout, number>();
/** MAIN_BLOCK widened for split boards: by half of whatever the hands are further apart than on a one-piece board. */
function mainBlock(placed: PlacedLayout): number {
  let b = blockCache.get(placed);
  if (b === undefined) {
    const xs: Record<string, number[]> = { L: [], R: [] };
    for (const p of placed.list) {
      const f = p.key.finger;
      if (f && p.key.isHome && f.finger !== "thumb") xs[f.hand].push(p.cx);
    }
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const sep = xs.L.length && xs.R.length ? Math.abs(mean(xs.R) - mean(xs.L)) : 6;
    b = MAIN_BLOCK + Math.max(0, sep - 6) / 2;
    blockCache.set(placed, b);
  }
  return b;
}

/** Ids among `ids` whose keys lie outside the default framing (joined, for use as an effect dependency). */
function outsideMainBlock(placed: PlacedLayout, ids: (string | null | undefined)[]): string {
  const homes = placed.list.filter((p) => p.key.isHome);
  if (!homes.length) return "";
  const cx = homes.reduce((s, p) => s + p.cx, 0) / homes.length;
  return ids
    .filter((id): id is string => {
      const p = id ? placed.byId.get(id) : undefined;
      return !!p && Math.abs(p.cx - cx) > mainBlock(placed);
    })
    .join(",");
}

const rel = new THREE.Vector3();

/** Computes a camera position (`pos`, looking at `target`) from which all `pts` are in view at the given elevation. Returns its distance. */
function fitCamera(pts: THREE.Vector3[], elevationDeg: number, aspect: number, pos: THREE.Vector3, target: THREE.Vector3): number {
  const el = (elevationDeg * Math.PI) / 180;
  const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
  const fwd = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tanV = Math.tan((FOV * Math.PI) / 360) * 0.95;
  const tanH = tanV * aspect;
  const focus = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
  let dist = 10;
  for (let pass = 0; pass < 6; pass++) {
    dist = 0;
    for (const p of pts) {
      rel.copy(p).sub(focus);
      const along = rel.dot(dir);
      dist = Math.max(dist, Math.abs(rel.dot(right)) / tanH + along, Math.abs(rel.dot(up)) / tanV + along);
    }
    // re-centre: perspective makes the near edge larger than the far edge
    let lo = Infinity;
    let hi = -Infinity;
    let l = Infinity;
    let r = -Infinity;
    for (const p of pts) {
      rel.copy(p).sub(focus);
      const d = dist - rel.dot(dir);
      const y = rel.dot(up) / (d * tanV);
      const x = rel.dot(right) / (d * tanH);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
      l = Math.min(l, x);
      r = Math.max(r, x);
    }
    const sy = ((lo + hi) / 2) * dist * tanV;
    const sx = ((l + r) / 2) * dist * tanH;
    if (Math.abs(sy) + Math.abs(sx) < 1e-3) break;
    focus.addScaledVector(up, sy).addScaledVector(right, sx);
  }
  pos.copy(focus).addScaledVector(dir, dist);
  target.copy(focus);
  return dist;
}

function aimCamera(cam: THREE.PerspectiveCamera, pos: THREE.Vector3, target: THREE.Vector3, aspect: number): void {
  const dist = pos.distanceTo(target);
  cam.fov = FOV;
  cam.aspect = aspect;
  cam.near = Math.max(0.5, dist - 45);
  cam.far = dist + 70;
  cam.position.copy(pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
}

/** Exponential approach; returns true while still far from `to`. */
function approach(v: THREE.Vector3, to: THREE.Vector3, k: number): boolean {
  if (v.distanceToSquared(to) < 1e-6) {
    v.copy(to);
    return false;
  }
  v.lerp(to, k);
  return true;
}

const anchorV = new THREE.Vector3();

/**
 * Writes where key `id` is on a `width` x `height` canvas into `out`: of the four edge midpoints of its
 * cap, the one highest on screen (a leader coming from above meets the key there, clear of its legend).
 * Returns true when `out` changed.
 */
function projectAnchor(out: HandsAnchor, id: string | null, placed: PlacedLayout, cam: THREE.Camera, width: number, height: number): boolean {
  const pl = id ? placed.byId.get(id) : undefined;
  let x = 0;
  let y = 0;
  let visible = false;
  if (pl) {
    const c = Math.cos(pl.rotY);
    const s = Math.sin(pl.rotY);
    const hw = (pl.w - KEY_GAP) / 2;
    const hh = (pl.h - KEY_GAP) / 2;
    y = Infinity;
    for (let e = 0; e < 4; e++) {
      const lx = e === 0 ? -hw : e === 1 ? hw : 0;
      const lz = e === 2 ? -hh : e === 3 ? hh : 0;
      anchorV.set(pl.cx + lx * c + lz * s, KEY_TOP, pl.cz - lx * s + lz * c).project(cam);
      const sy = (1 - anchorV.y) * 0.5 * height;
      if (sy < y && anchorV.z > -1 && anchorV.z < 1) {
        y = sy;
        x = (anchorV.x + 1) * 0.5 * width;
      }
    }
    visible = y !== Infinity && x >= 0 && x <= width && y >= 0 && y <= height;
    if (!visible) x = y = 0;
    // half-pixel steps: no sub-pixel churn while the camera settles
    x = Math.round(x * 2) / 2;
    y = Math.round(y * 2) / 2;
  }
  if (out.keyId === id && out.visible === visible && out.x === x && out.y === y) return false;
  out.keyId = id;
  out.visible = visible;
  out.x = x;
  out.y = y;
  return true;
}

type ContentsProps = HandsSceneProps;

function Contents({
  layout,
  targetKeyId = null,
  holdKeyIds = null,
  modifierKeyId = null,
  press = null,
  pressedOk = true,
  camera: cameraMode = "angled",
  interactive = false,
  fingerZones = true,
  showHands = true,
  debug = false,
  onStatus,
  onAnchors,
}: Omit<ContentsProps, "onStatus"> & { onStatus: (s: Status) => void }) {
  const gl = useThree((s) => s.gl);
  const cam = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const [theme, setTheme] = useState<HandsTheme>(() => readTheme());
  useEffect(() => {
    const update = () =>
      setTheme((prev) => {
        const next = readTheme();
        return next.signature === prev.signature ? prev : next;
      });
    update();
    return watchTheme(update);
  }, []);

  const placed = useMemo(() => placeLayout(layout), [layout]);
  const keyboard = useMemo(() => new Keyboard3D(placed), [placed]);
  useEffect(() => () => keyboard.dispose(), [keyboard]);

  const [template, setTemplate] = useState<HandTemplate | null>(null);
  useEffect(() => {
    if (!showHands) return;
    let alive = true;
    loadHandTemplate().then(
      (t) => alive && setTemplate(t),
      (e) => {
        console.warn("[hands] model failed to load", e);
        if (alive) onStatus("error");
      },
    );
    return () => {
      alive = false;
    };
  }, [showHands, onStatus]);

  const rigs = useMemo(() => (template && showHands ? [new HandRig(template, "L"), new HandRig(template, "R")] : null), [template, showHands]);
  useEffect(
    () => () => {
      rigs?.forEach((r) => r.dispose());
    },
    [rigs],
  );
  const controller = useMemo(() => (rigs ? new HandsController(placed, rigs[0], rigs[1], keyboard) : null), [rigs, placed, keyboard]);


  // ---- props -> scene
  useLayoutEffect(() => {
    keyboard.applyTheme(theme);
    rigs?.forEach((r) => r.applyTheme(theme));
    invalidate();
  }, [theme, keyboard, rigs, invalidate]);

  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    document.fonts.ready.then(() => {
      if (!alive) return;
      keyboard.redrawLegends();
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [keyboard, invalidate]);

  useEffect(() => {
    keyboard.setFingerZones(fingerZones);
    invalidate();
  }, [keyboard, fingerZones, invalidate]);

  // Held keys as a stable array: a new but equal `holdKeyIds` array must not re-run the effects.
  const holdSig = [...(holdKeyIds ?? []), modifierKeyId].filter((id, i, a): id is string => !!id && a.indexOf(id) === i).join("\n");
  const holdIds = useMemo(() => (holdSig ? holdSig.split("\n") : []), [holdSig]);

  // A new controller starts at its rest pose; its first target/held keys are applied without
  // animation, so the first frame shows the hands where they will be (no glide on appearance).
  const snappedFor = useRef<HandsController | null>(null);
  useEffect(() => {
    keyboard.setTarget(targetKeyId);
    controller?.setTarget(targetKeyId);
    invalidate();
  }, [keyboard, controller, targetKeyId, invalidate]);

  useEffect(() => {
    keyboard.setHolds(holdIds);
    controller?.setHolds(holdIds);
    if (controller && snappedFor.current !== controller) {
      snappedFor.current = controller;
      controller.snap();
    }
    invalidate();
  }, [keyboard, controller, holdIds, invalidate]);

  // While one of a layer's activators is held the keycaps show that layer's legends (derived from the
  // layout and the held keys, so callers need no extra prop); back to base when the hold ends.
  const activeLayer = useMemo(() => layout.layers?.find((l) => l.activatorIds.some((id) => holdIds.includes(id))) ?? null, [layout, holdIds]);
  useEffect(() => {
    keyboard.setLayer(activeLayer);
    invalidate();
  }, [keyboard, activeLayer, invalidate]);

  const lastNonce = useRef<number | null>(press ? press.nonce : null);
  const okRef = useRef(pressedOk);
  okRef.current = pressedOk;
  const fallbackFx = useRef<{ id: string; t: number; ok: boolean }[]>([]);
  useEffect(() => {
    if (!press || press.nonce === lastNonce.current) return;
    lastNonce.current = press.nonce;
    if (controller) controller.press(press.keyId, okRef.current);
    else fallbackFx.current.push({ id: press.keyId, t: 0, ok: okRef.current });
    invalidate();
  }, [press, controller, invalidate]);

  // ---- camera: fitted to the key block + hands; glides when the framing changes
  const controlsRef = useRef<OrbitControls | null>(null);
  const camGoal = useRef({ pos: new THREE.Vector3(), target: new THREE.Vector3() });
  const camCur = useRef({ pos: new THREE.Vector3(), target: new THREE.Vector3(), aspect: 0, moving: false });
  const fittedFor = useRef<HandsController | null | undefined>(undefined);
  const extra = outsideMainBlock(placed, [targetKeyId, ...holdIds]);
  const narrow = size.width < NARROW_CANVAS;
  useLayoutEffect(() => {
    if (size.width < 2 || size.height < 2) return;
    const aspect = size.width / size.height;
    const goal = camGoal.current;
    const cur = camCur.current;
    // The board decides the scale; whatever height that leaves goes to the hands (as much of them as fits).
    const extraIds = extra ? extra.split(",") : [];
    const fit = (reach: number, headroom: number) =>
      fitCamera(focusPoints(placed, controller, extraIds, narrow, reach, headroom), ELEVATION[cameraMode], aspect, goal.pos, goal.target);
    const limit = fit(0, 0) * 1.004;
    /** The largest 0..1 value of one of the two extras that keeps the board at its scale. */
    const most = (f: (t: number) => number): number => {
      if (f(1) <= limit) return 1;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 5; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) <= limit) lo = mid;
        else hi = mid;
      }
      return lo;
    };
    const headroom = most((t) => fit(0, t));
    fit(
      most((t) => fit(t, headroom)),
      headroom,
    );
    // Legends are functional text: when a word legend ("Shift") would come out too small to read at
    // this framing, the caps carry single characters only (drawn large) instead of illegible words.
    const pxPerUnit = size.height / (2 * Math.tan((FOV * Math.PI) / 360) * goal.pos.distanceTo(goal.target));
    keyboard.setLegendDetail(pxPerUnit * WORD_LEGEND >= MIN_LEGEND_PX ? "full" : "letters");
    const controls = controlsRef.current;
    const firstWithController = !!controller && fittedFor.current === null;
    fittedFor.current = controller;
    if (cur.aspect === 0 || cur.aspect !== aspect || controls || firstWithController) {
      // first fit, the hands arriving (fit changes from the default wrist spots to the real rest pose),
      // resize, or the user is orbiting: no glide
      cur.pos.copy(goal.pos);
      cur.target.copy(goal.target);
      cur.moving = false;
      aimCamera(cam, cur.pos, cur.target, aspect);
      if (controls) {
        controls.target.copy(cur.target);
        controls.update();
      }
    } else {
      cur.moving = true;
    }
    cur.aspect = aspect;
    invalidate();
  }, [cam, placed, controller, keyboard, cameraMode, extra, narrow, size.width, size.height, invalidate]);

  useEffect(() => {
    if (!interactive) return;
    const controls = new OrbitControls(cam, gl.domElement);
    controls.target.copy(camCur.current.target);
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.update();
    const onChange = () => invalidate();
    controls.addEventListener("change", onChange);
    controlsRef.current = controls;
    return () => {
      controls.removeEventListener("change", onChange);
      controls.dispose();
      controlsRef.current = null;
      // glide back to the fitted view
      camCur.current.moving = true;
      invalidate();
    };
  }, [interactive, cam, gl, invalidate]);

  // ---- render on demand; pause when off screen / tab hidden
  const visible = useRef(true);
  useEffect(() => {
    const el = gl.domElement;
    let onScreen = true;
    const sync = () => {
      const v = onScreen && document.visibilityState !== "hidden";
      if (v && !visible.current) invalidate();
      visible.current = v;
    };
    const io = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [gl, invalidate]);

  // ---- anchors for annotations over the canvas (see `onAnchors`)
  const anchors = useRef<HandsAnchors | null>(null);
  if (!anchors.current) {
    anchors.current = {
      width: 0,
      height: 0,
      target: { keyId: null, x: 0, y: 0, visible: false },
      holds: [
        { keyId: null, x: 0, y: 0, visible: false },
        { keyId: null, x: 0, y: 0, visible: false },
      ],
    };
  }
  type AnchorsFn = HandsSceneProps["onAnchors"];
  const anchorIds = useRef<{ target: string | null; holds: string[]; cb: AnchorsFn; sent: AnchorsFn }>({ target: null, holds: [], cb: undefined, sent: undefined });
  anchorIds.current.target = targetKeyId;
  anchorIds.current.holds = holdIds;
  anchorIds.current.cb = onAnchors;
  useEffect(() => {
    // a new listener (or a new board) gets the current positions with the next frame
    if (onAnchors) invalidate();
  }, [onAnchors, placed, invalidate]);

  // Tell the panel when the first complete frame is on the canvas: hands at rest (or no hands needed)
  // and the camera fitted. Effects have run by the time this frame is requested, so reporting from
  // inside the frame loop means the reveal can never show an unposed or unfitted scene.
  const reported = useRef(false);
  const emphSnapped = useRef<HandsController | null>(null);
  const idle = useRef(true);
  useFrame((state, delta) => {
    if (!reported.current && camCur.current.aspect !== 0 && (controller != null || !showHands) && (snappedFor.current === controller || !controller)) {
      reported.current = true;
      onStatus("ready");
    }
    // after an idle period the clock delta is the whole pause; start with one nominal frame instead
    const dt = idle.current ? 1 / 60 : delta;
    let moving = false;
    if (controller) {
      moving = controller.update(dt);
      // the reaching finger (and, less so, fingers holding a key) is drawn emphasised
      for (const h of controller.hands) {
        let holding = 0;
        for (const r of h.holds) holding |= 1 << r.digit;
        if (h.rig.updateEmphasis(h.target ? h.target.digit : -1, holding, emphSnapped.current === controller ? dt : 0)) moving = true;
      }
      emphSnapped.current = controller;
    }
    const fx = fallbackFx.current;
    if (fx.length) {
      // key press feedback while the hands are not (yet) available
      for (let i = fx.length - 1; i >= 0; i--) {
        const e = fx[i];
        e.t += Math.min(dt, 0.05);
        const dip = e.t < 0.15 ? Math.sin((Math.PI * e.t) / 0.15) : 0;
        const flash = Math.max(0, 1 - e.t / 0.4);
        keyboard.setKeyPress(e.id, dip, flash * flash, e.ok);
        if (e.t >= 0.4) fx.splice(i, 1);
      }
      moving = true;
    }
    const cc = camCur.current;
    if (cc.moving) {
      const k = 1 - Math.exp(-Math.min(dt, 0.05) / 0.09);
      const a = approach(cc.pos, camGoal.current.pos, k);
      const b = approach(cc.target, camGoal.current.target, k);
      cc.moving = a || b;
      aimCamera(cam, cc.pos, cc.target, cc.aspect);
      moving = true;
    }
    const ids = anchorIds.current;
    if (ids.cb && cc.aspect !== 0) {
      const a = anchors.current as HandsAnchors;
      const w = state.size.width;
      const h = state.size.height;
      cam.updateMatrixWorld();
      let changed = ids.sent !== ids.cb || a.width !== w || a.height !== h;
      a.width = w;
      a.height = h;
      if (projectAnchor(a.target, ids.target, placed, cam, w, h)) changed = true;
      if (projectAnchor(a.holds[0], ids.holds[0] ?? null, placed, cam, w, h)) changed = true;
      if (projectAnchor(a.holds[1], ids.holds[1] ?? null, placed, cam, w, h)) changed = true;
      if (changed) {
        ids.sent = ids.cb;
        ids.cb(a);
      }
    }
    idle.current = !moving;
    if (moving && visible.current) state.invalidate();
  });

  // ---- debug handle
  useEffect(() => {
    if (!debug || typeof window === "undefined") return;
    const handle = {
      controller,
      keyboard,
      placed,
      camera: cam,
      renderer: gl,
      debug: () => controller?.debug() ?? null,
      tips: () => controller?.debugTips() ?? null,
      /** Static settled error for every key that has a finger. */
      measureAll: () =>
        placed.list
          .filter((p) => p.key.finger)
          .map((p) => ({ id: p.key.id, label: p.key.label.replace(/\n/g, " "), ...controller?.measure(p.key.id) })),
      /**
       * `measureAll` condensed per row (rows relative to the home row). "letter" groups hold the
       * character keys of the three letter rows within 2u of the finger's home key; "far" the rest.
       */
      report: () => {
        type Group = { n: number; distance: number; others: number; palm: number; wrist: number; worst: Record<string, string> };
        const groups: Record<string, Group> = {};
        for (const p of placed.list) {
          const m = p.key.finger ? controller?.measure(p.key.id) : null;
          if (!m) continue;
          const letter = Math.abs(m.row) <= 1 && m.reach <= 2 && p.key.base.trim().length === 1;
          const name = `${letter ? "letter" : "far"} row ${m.row}`;
          const g = (groups[name] ??= { n: 0, distance: 0, others: 0, palm: 0, wrist: 0, worst: {} });
          const label = p.key.label.replace(/\n/g, " ") || p.key.code || p.key.id;
          g.n++;
          for (const k of ["distance", "others", "palm", "wrist"] as const) {
            if (m[k] >= g[k]) {
              g[k] = m[k];
              g.worst[k] = k === "others" ? `${label} (${m.othersFinger})` : label;
            }
          }
        }
        return groups;
      },
      snap: () => {
        controller?.snap();
        invalidate();
      },
      info: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
      }),
    };
    (window as unknown as { __hands?: unknown }).__hands = handle;
    return () => {
      const w = window as unknown as { __hands?: unknown };
      if (w.__hands === handle) delete w.__hands;
    };
  }, [debug, controller, keyboard, placed, cam, gl, invalidate]);

  return (
    <>
      <primitive object={keyboard.group} />
      {rigs && <primitive object={rigs[0].root} />}
      {rigs && <primitive object={rigs[1].root} />}
    </>
  );
}

const fill: React.CSSProperties = { position: "relative", width: "100%", height: "100%", minHeight: 0, overflow: "hidden" };
const note: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 8,
  textAlign: "center",
  font: "500 12px var(--font-sans, system-ui, sans-serif)",
  color: "var(--sub, #7d8896)",
  pointerEvents: "none",
};
const centre: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  textAlign: "center",
  font: "500 13px var(--font-sans, system-ui, sans-serif)",
  color: "var(--sub, #7d8896)",
};

export default function HandsScene(props: HandsSceneProps) {
  const [supported] = useState(() => (typeof document === "undefined" ? true : webglAvailable()));
  const [status, setStatus] = useState<Status>("loading");
  const { onStatus } = props;
  const reportStatus = supported ? status : "nowebgl";
  useEffect(() => {
    onStatus?.(reportStatus);
  }, [onStatus, reportStatus]);

  if (!supported) {
    return (
      <div className={props.className} style={fill} data-testid="hands-scene" data-hands-status="nowebgl">
        <div style={centre}>The 3D hands need WebGL, which is not available in this browser.</div>
      </div>
    );
  }

  return (
    <div className={props.className} style={fill} data-testid="hands-scene" data-hands-status={status} data-hands-camera={props.camera ?? "angled"}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        flat
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!props.debug }}
        camera={{ fov: FOV, near: 0.5, far: 200, position: [0, 24, 16] }}
        style={{ position: "absolute", inset: 0, touchAction: props.interactive ? "none" : "auto" }}
        aria-label="3D keyboard with guide hands"
        role="img"
      >
        <Contents {...props} onStatus={setStatus} />
      </Canvas>
      {!onStatus && status === "loading" && <div style={note}>loading hands…</div>}
      {!onStatus && status === "error" && <div style={note}>hand model unavailable</div>}
    </div>
  );
}
