"use client";

// 3D keyboard + two rigged hands that show which finger presses which key.
// Client-only (WebGL). Import the SSR-safe wrapper from "components/hands".

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ParsedLayout } from "../../lib/types";
import { Keyboard3D } from "../../lib/hands/keyboard3d";
import { HandsController } from "../../lib/hands/pose";
import { HandRig, loadHandTemplate, type HandTemplate } from "../../lib/hands/rig";
import { placeLayout, type PlacedLayout } from "../../lib/hands/space";
import { readTheme, watchTheme, type HandsTheme } from "../../lib/hands/theme";

export type HandsCamera = "top" | "angled" | "front";

export interface HandsSceneProps {
  layout: ParsedLayout;
  /** Next key to press: the assigned finger reaches for it and the key glows in that finger's colour. */
  targetKeyId?: string | null;
  /** A key to hold meanwhile (e.g. the Shift on the other hand). */
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
  /** Dev only: exposes `window.__hands` and keeps the drawing buffer for screenshots. */
  debug?: boolean;
  className?: string;
}

type Status = "loading" | "ready" | "error" | "nowebgl";

// (plain `shadows` asks three for PCFSoftShadowMap, which r18x no longer has and warns about every frame)
const SHADOWS = { enabled: true, type: THREE.PCFShadowMap };
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

/** World-space points the camera must keep in view: the main key block plus both hands. */
function focusPoints(placed: PlacedLayout, controller: HandsController | null, extraIds: string[] = []): THREE.Vector3[] {
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
    if (Math.abs(p.cx - cx) > MAIN_BLOCK && !extraIds.includes(p.key.id)) continue;
    box.expandByPoint(new THREE.Vector3(p.cx - p.w / 2, 0, p.cz - p.h / 2));
    box.expandByPoint(new THREE.Vector3(p.cx + p.w / 2, 0, p.cz + p.h / 2));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-7, 0, -2.5), new THREE.Vector3(7, 0, 2.5));
  box.expandByVector(new THREE.Vector3(0.45, 0, 0.45));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? 0.4 : -0.3, i & 4 ? box.max.z : box.min.z));
  // hands: from just beyond the home row back to the wrists
  let wristZ = hz + 5.6;
  let x0 = cx - 6;
  let x1 = cx + 6;
  if (controller) {
    wristZ = Math.max(...controller.hands.map((h) => h.rest.z)) + 0.6;
    x0 = Math.min(...controller.hands.map((h) => h.rest.x)) - 2.6;
    x1 = Math.max(...controller.hands.map((h) => h.rest.x)) + 2.6;
  }
  for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? x1 : x0, i & 2 ? 2 : 0, i & 4 ? wristZ : hz - 1));
  return pts;
}

/** Keys further than this (key units, in x) from the home keys are outside the default framing. */
const MAIN_BLOCK = 9.6;

/** Ids among `ids` whose keys lie outside the default framing (joined, for use as an effect dependency). */
function outsideMainBlock(placed: PlacedLayout, ids: (string | null | undefined)[]): string {
  const homes = placed.list.filter((p) => p.key.isHome);
  if (!homes.length) return "";
  const cx = homes.reduce((s, p) => s + p.cx, 0) / homes.length;
  return ids
    .filter((id): id is string => {
      const p = id ? placed.byId.get(id) : undefined;
      return !!p && Math.abs(p.cx - cx) > MAIN_BLOCK;
    })
    .join(",");
}

const rel = new THREE.Vector3();

/** Computes a camera position (`pos`, looking at `target`) from which all `pts` are in view at the given elevation. */
function fitCamera(pts: THREE.Vector3[], elevationDeg: number, aspect: number, pos: THREE.Vector3, target: THREE.Vector3): void {
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

interface ContentsProps extends HandsSceneProps {
  onStatus: (s: Status) => void;
}

function Contents({
  layout,
  targetKeyId = null,
  modifierKeyId = null,
  press = null,
  pressedOk = true,
  camera: cameraMode = "angled",
  interactive = false,
  fingerZones = true,
  showHands = true,
  debug = false,
  onStatus,
}: ContentsProps) {
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
    onStatus("loading");
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

  useEffect(() => {
    if (controller) onStatus("ready");
    else if (!showHands) onStatus("ready");
  }, [controller, showHands, onStatus]);

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

  useEffect(() => {
    keyboard.setTarget(targetKeyId);
    controller?.setTarget(targetKeyId);
    invalidate();
  }, [keyboard, controller, targetKeyId, invalidate]);

  useEffect(() => {
    keyboard.setModifier(modifierKeyId);
    controller?.setModifier(modifierKeyId);
    invalidate();
  }, [keyboard, controller, modifierKeyId, invalidate]);

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
  const extra = outsideMainBlock(placed, [targetKeyId, modifierKeyId]);
  useLayoutEffect(() => {
    if (size.width < 2 || size.height < 2) return;
    const aspect = size.width / size.height;
    const goal = camGoal.current;
    const cur = camCur.current;
    fitCamera(focusPoints(placed, controller, extra ? extra.split(",") : []), ELEVATION[cameraMode], aspect, goal.pos, goal.target);
    const controls = controlsRef.current;
    if (cur.aspect === 0 || cur.aspect !== aspect || controls) {
      // first fit, resize, or the user is orbiting: no glide
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
  }, [cam, placed, controller, cameraMode, extra, size.width, size.height, invalidate]);

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

  const idle = useRef(true);
  useFrame((state, delta) => {
    // after an idle period the clock delta is the whole pause; start with one nominal frame instead
    const dt = idle.current ? 1 / 60 : delta;
    let moving = false;
    if (controller) moving = controller.update(dt);
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

  const shadowCam = useMemo(() => {
    const b = new THREE.Box3().setFromPoints(focusPoints(placed, null));
    return { cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2 + 2, half: Math.max(b.max.x - b.min.x, b.max.z - b.min.z + 8) / 2 + 1 };
  }, [placed]);
  const lightTarget = useMemo(() => new THREE.Object3D(), []);
  lightTarget.position.set(shadowCam.cx, 0, shadowCam.cz);

  const dark = theme.bgLuma < 0.5;
  return (
    <>
      <ambientLight intensity={dark ? 1.35 : 1.6} />
      <hemisphereLight args={[0xffffff, dark ? 0x30343c : 0x9a958c, 0.5]} />
      <primitive object={lightTarget} />
      <directionalLight
        position={[shadowCam.cx - 5, 16, shadowCam.cz + 3]}
        target={lightTarget}
        intensity={1.75}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
        shadow-radius={5}
        shadow-intensity={dark ? 0.55 : 0.3}
      >
        <orthographicCamera attach="shadow-camera" args={[-shadowCam.half, shadowCam.half, shadowCam.half, -shadowCam.half, 1, 40]} />
      </directionalLight>
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
        shadows={SHADOWS}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!props.debug }}
        camera={{ fov: FOV, near: 0.5, far: 200, position: [0, 24, 16] }}
        style={{ position: "absolute", inset: 0, touchAction: props.interactive ? "none" : "auto" }}
        aria-label="3D keyboard with guide hands"
        role="img"
      >
        <Contents {...props} onStatus={setStatus} />
      </Canvas>
      {status === "loading" && <div style={note}>loading hands…</div>}
      {status === "error" && <div style={note}>hand model unavailable</div>}
    </div>
  );
}
