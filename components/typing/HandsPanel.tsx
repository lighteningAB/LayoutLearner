"use client";
// The 3D guide hands for the typing test and the lessons. Mounts into KeyboardGuide's `handsSlot`.
//
//   const view = useGuideView();                       // which guides to show (settings + WebGL)
//   const [press, notePress] = useGuidePress();        // feed it every character keystroke
//   <KeyboardGuide showKeyboard={view.showKeyboard} maxUnit={view.keyboardUnit}
//                  hintEnd={<GuideViewSwitch />}
//                  handsSlot={view.showHands ? <HandsPanel layout={layout} nextChar={nextChar} press={press} compact={view.view === "both"} /> : null} />
//
// The three.js bundle is only fetched when the panel actually renders (settings.showHands on and
// WebGL available). Without WebGL nothing renders and `useGuideView().showKeyboard` turns true, so
// the 2D board silently takes over.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ComponentType } from "react";
import type { HandsAnchors, HandsSceneProps } from "@/components/hands/HandsScene";
import { Icon, Kbd, ProgressBar, SegmentedControl, cx } from "@/components/ui";
import { getHandModelProgress, subscribeHandModelProgress } from "@/lib/hands/progress";
import { useLearnPrefs } from "@/components/learn/prefs";
import { stableLayout } from "@/components/learn/stableLayout";
import { getSettings, useSettings } from "@/lib/settings";
import type { ParsedLayout } from "@/lib/types";
import { fingerName, guideForTarget, type GuideAction } from "./KeyboardGuide";
import "./typing.css";

export type GuideView = "hands" | "keys" | "both" | "none";
/** "front" is only available as a fixed `camera` (the toggle switches between angled and top). */
export type HandsPanelCamera = "angled" | "top" | "front";
/**
 * How large the plate is when it sizes itself (ignored with `fill`):
 * "default" is a 2:1 box up to about half the viewport height, "large" a 3:2 box up to a little more
 * (lessons, where the hands are the teacher). Either can be overridden from CSS, without !important,
 * by setting these custom properties on any ancestor (also inside media queries):
 *   --hands-height      a definite height (e.g. clamp(240px, 50dvh, 520px)); the box is then full width
 *   --hands-aspect      aspect-ratio of the box (set `auto` together with --hands-height)
 *   --hands-max-height  the height cap (`none` to lift it)
 */
export type HandsPanelSize = "default" | "large";

export interface GuidePress {
  keyId: string;
  /** Whether the keystroke produced the expected character. */
  ok: boolean;
  nonce: number;
}

// ────────────────────────────────────────────────────────────────────────── WebGL support

let webglCache: boolean | null = null;

function detectWebGL(): boolean {
  if (webglCache != null) return webglCache;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    webglCache = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** null until checked on the client (first effect), then whether WebGL2 can be used. */
export function useWebGLSupport(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(webglCache);
  useEffect(() => {
    setOk(detectWebGL());
  }, []);
  return ok;
}

// ────────────────────────────────────────────────────────────────────────── early preload

// Start fetching the 3D scene chunk and the hand model as soon as this module runs in the browser,
// instead of after the first render, but only when the saved settings ask for hands (so routes and
// profiles that never show them download nothing). Settings are read from localStorage here; nothing
// is rendered from them, so hydration is unaffected. The panel's own effect calls the same
// `import()` and `loadHandTemplate()`, which share their promises / cache: no second download.
if (typeof window !== "undefined" && getSettings().showHands) {
  import("@/components/hands/HandsScene").catch(() => {});
  import("@/lib/hands/rig").then((m) => m.loadHandTemplate()).catch(() => {});
}

// ────────────────────────────────────────────────────────────────────────── load failure

// The 3D scene could not load (chunk or model): for the rest of this page's life the 2D keyboard stands in.
let handsFailed = false;
const failListeners = new Set<() => void>();
function markHandsFailed() {
  if (handsFailed) return;
  handsFailed = true;
  failListeners.forEach((l) => l());
}
function useHandsFailed(): boolean {
  return useSyncExternalStore(
    (l) => {
      failListeners.add(l);
      return () => {
        failListeners.delete(l);
      };
    },
    () => handsFailed,
    () => false,
  );
}

// ────────────────────────────────────────────────────────────────────────── view state

export interface GuideViewState {
  /** What the settings ask for. */
  view: GuideView;
  setView: (view: Exclude<GuideView, "none">) => void;
  /** Render <HandsPanel>: hands are on and WebGL is not known to be missing. */
  showHands: boolean;
  /** Pass to KeyboardGuide: the 2D board is on, or it stands in for hands that cannot render. */
  showKeyboard: boolean;
  /** `maxUnit` for KeyboardGuide: the 2D board shrinks when it sits under the hands. */
  keyboardUnit: number;
  /** Pass to KeyboardGuide `reserveBox`: keeps the hands' footprint free while the guide is on "keys" (so text does not jump on switching). */
  reserveBox: CSSProperties | undefined;
  /** false once we know WebGL is unavailable (the view switch hides itself). */
  handsSupported: boolean;
}

/** Which guides to show: settings.showHands / settings.showKeyboard (+ the "both" opt-in), corrected for missing WebGL. */
export function useGuideView(): GuideViewState {
  const [settings, update] = useSettings();
  const [prefs, setPrefs] = useLearnPrefs();
  const webgl = useWebGLSupport();
  const failed = useHandsFailed();
  // The 3D scene already draws the keyboard, so with hands on the 2D board is only added when
  // the user explicitly picked "both" (a fresh profile has both settings on and shows the hands).
  const view: GuideView = settings.showHands
    ? settings.showKeyboard && prefs.bothGuides
      ? "both"
      : "hands"
    : settings.showKeyboard
      ? "keys"
      : "none";
  const setView = useCallback(
    (v: Exclude<GuideView, "none">) => {
      setPrefs({ bothGuides: v === "both" });
      update({ showHands: v !== "keys", showKeyboard: v !== "hands" });
    },
    [update, setPrefs],
  );
  const showHands = settings.showHands && webgl !== false && !failed;
  const showKeyboard = view === "both" || view === "keys" || (settings.showHands && (webgl === false || failed));
  return { view, setView, showHands, showKeyboard, keyboardUnit: showHands && showKeyboard ? 30 : 46,
    reserveBox: view === "keys" && webgl !== false && !failed ? handsBoxStyle(false) : undefined,
    handsSupported: webgl !== false && !failed,
  };
}

/**
 * Latest character keystroke for the hands' tap animation. Call `note(keyId, ok)` from the same
 * handler that feeds the typing engine: React batches both updates into one render.
 */
export function useGuidePress(): [GuidePress | null, (keyId: string | null | undefined, ok: boolean) => void] {
  const [press, setPress] = useState<GuidePress | null>(null);
  const nonce = useRef(0);
  const note = useCallback((keyId: string | null | undefined, ok: boolean) => {
    if (!keyId) return;
    setPress({ keyId, ok, nonce: ++nonce.current });
  }, []);
  return [press, note];
}

// ────────────────────────────────────────────────────────────────────────── view switch

export interface GuideViewSwitchProps {
  className?: string;
}

/** "3D hands / 2D keys / both". Persists through settings.showHands + settings.showKeyboard. */
export function GuideViewSwitch({ className }: GuideViewSwitchProps) {
  const { view, setView, handsSupported } = useGuideView();
  if (!handsSupported) return null;
  return (
    <div className={cx("inline-flex shrink-0 items-center gap-1", className)}>
      <span aria-hidden className="ll-lettering-sm mr-1 text-sub">
        Guide
      </span>
      <SegmentedControl
        variant="inline"
        size="sm"
        aria-label="Typing guide"
        data-testid="view-switch"
        className="shrink-0 flex-nowrap !gap-x-0"
        value={view}
        onChange={(v) => {
          if (v === "none") return;
          setView(v);
          // Clicked with the pointer: hand the keyboard back to the text (Enter / Tab keep working).
          // Arrow-key changes re-focus the new option right after, so keyboard users keep their place.
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }}
        options={[
          {
            value: "hands",
            label: (
              <>
                <span className="sr-only">3D </span>hands
              </>
            ),
          },
          {
            value: "keys",
            label: (
              <>
                <span className="sr-only">2D </span>keys
              </>
            ),
          },
          { value: "both", label: "both" },
        ]}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────── panel

export interface HandsPanelProps {
  layout: ParsedLayout;
  /** Character to type next: its finger reaches for the key (and Shift / a layer key is held meanwhile when needed). */
  nextChar: string | null;
  /** Reach for an action key instead (Backspace while the current word has a typo). */
  nextAction?: GuideAction | null;
  /** Latest keystroke (`useGuidePress`): taps the key, in the accent or the error colour. */
  press?: GuidePress | null;
  /** Shorter panel, for when the 2D board is shown underneath. */
  compact?: boolean;
  /** Fixed camera; hides the camera toggle. Default: the persisted choice (angled / top). */
  camera?: HandsPanelCamera;
  /** Take the parent's full height instead of the default aspect box (pair with `<KeyboardGuide fill>`). */
  fill?: boolean;
  /** Size of the self-sized box (see HandsPanelSize; CSS custom properties override it). Default "default". */
  size?: HandsPanelSize;
  /**
   * Draw the annotation: a label that names the finger and the key ("LEFT INDEX -> T"), joined to the
   * target key by a leader line (and a dashed leader to a key that is held meanwhile). Default true.
   * A `<KeyboardGuide>` around the panel hides its own hint line while this one is drawn.
   */
  leader?: boolean;
  className?: string;
}

type SceneStatus = "loading" | "ready" | "error" | "nowebgl";
type SceneComponent = ComponentType<HandsSceneProps>;

/** The loader waits this long before it shows: a fast load never flashes a bar. */
const LOADER_DELAY_MS = 150;
const FADE_MS = 300;

/**
 * Progress 0..1 of the whole load: the scene chunk and the model download run in parallel, each worth
 * about half; the last few percent are the first frame. `indeterminate` when the model size is unknown.
 */
function useLoadProgress(chunkLoaded: boolean, needsModel: boolean, ready: boolean, reduceMotion: boolean): { value: number; indeterminate: boolean } {
  const model = useSyncExternalStore(subscribeHandModelProgress, getHandModelProgress, getHandModelProgress);
  const known = model.phase === "loading" && model.total > 0;
  const indeterminate = !ready && needsModel && model.phase === "loading" && !known;
  // Unknown size: creep towards (never reach) the end so the bar visibly moves; no creeping with reduced motion.
  const [creep, setCreep] = useState(0.3);
  useEffect(() => {
    if (!indeterminate || reduceMotion) return;
    const id = window.setInterval(() => setCreep((c) => c + (0.9 - c) * 0.12), 250);
    return () => window.clearInterval(id);
  }, [indeterminate, reduceMotion]);
  let modelPart = 0;
  if (!needsModel || model.phase === "done") modelPart = 1;
  else if (known) modelPart = Math.min(1, model.loaded / model.total);
  else if (model.phase === "loading") modelPart = reduceMotion ? 0.5 : creep;
  const value = ready ? 1 : 0.08 + 0.42 * (chunkLoaded ? 1 : 0) + 0.4 * modelPart;
  return { value, indeterminate };
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return reduce;
}

const BOX: Record<HandsPanelSize, Record<"full" | "compact", { aspect: string; cap: string }>> = {
  default: { full: { aspect: "2 / 1", cap: "clamp(240px, 48dvh, 520px)" }, compact: { aspect: "5 / 2", cap: "clamp(160px, 26dvh, 300px)" } },
  large: { full: { aspect: "3 / 2", cap: "clamp(260px, 52dvh, 580px)" }, compact: { aspect: "2 / 1", cap: "clamp(180px, 30dvh, 340px)" } },
};

/**
 * Size of the hands box (also reserved for the 2D board when the guide is switched to "keys"): an
 * aspect box under a height cap. Every part reads a custom property first, so a caller's stylesheet
 * can resize it (see HandsPanelSize). Put the class `tt-hands-box` on the element as well: it applies
 * `--hands-height` (a stylesheet rule, so that a caller's own `height` rule still wins over it).
 */
export function handsBoxStyle(compact: boolean, size: HandsPanelSize = "default"): CSSProperties {
  const box = BOX[size][compact ? "compact" : "full"];
  return {
    aspectRatio: `var(--hands-aspect, ${box.aspect})`,
    maxHeight: `var(--hands-max-height, ${box.cap})`,
  };
}

// ────────────────────────────────────────────────────────────────────────── leader

/** Height of the strip above the canvas that holds the annotation labels, and the line the leaders run along in it (CSS px). */
const STRIP = 28;
const STRIP_MID = 14.5;
/** Horizontal run of a leader before its label, and the clearance between line and lettering. */
const RUN = 12;
const PAD = 6;
/** Smallest gap between two labels on the strip. */
const LABEL_GAP = 14;
const DRAW_MS = 160;
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

interface Placement {
  /** Left edge of the label. */
  left: number;
  /** Where the leader leaves the label, and its elbow. */
  edge: number;
  elbow: number;
}

/**
 * Places a label of width `lw` on the strip for a key at (kx, ky): the leader rises from the key at a
 * fixed slant to the strip, runs a short way along it and meets the label, which extends towards
 * `dir` (1: right). The label is kept inside 0..width.
 */
function placeLabel(out: Placement, kx: number, ky: number, width: number, lw: number, dir: 1 | -1): Placement {
  let elbow = Math.round(kx + dir * Math.min(140, Math.max(6, (ky - STRIP_MID) * 0.4)));
  const want = dir > 0 ? elbow + RUN + PAD : elbow - RUN - PAD - lw;
  const left = Math.round(Math.min(Math.max(want, 0), Math.max(0, width - lw)));
  const edge = dir > 0 ? left - PAD : left + lw + PAD;
  // a label pushed back by the plate edge: the slant goes straight to its end
  if (dir > 0 ? edge < elbow : edge > elbow) elbow = edge;
  out.left = left;
  out.edge = edge;
  out.elbow = elbow;
  return out;
}

const overlaps = (a: number, aw: number, b: number, bw: number) => a < b + bw + LABEL_GAP && b < a + aw + LABEL_GAP;

function setLine(path: SVGPathElement | null, dot: SVGCircleElement | null, p: Placement | null, kx: number, ky: number): number {
  if (!path || !dot) return 0;
  if (!p) {
    if (path.style.display !== "none") {
      path.style.display = "none";
      dot.style.display = "none";
    }
    return 0;
  }
  const d = `M${p.edge} ${STRIP_MID}H${p.elbow}L${kx} ${ky}`;
  if (path.getAttribute("d") !== d) {
    path.setAttribute("d", d);
    dot.cx.baseVal.value = kx;
    dot.cy.baseVal.value = ky;
  }
  if (path.style.display === "none") {
    path.style.display = "";
    dot.style.display = "";
  }
  return Math.abs(p.elbow - p.edge) + Math.hypot(kx - p.elbow, ky - STRIP_MID);
}

function setLabel(el: HTMLElement, left: number, on: boolean): void {
  const t = `translateX(${Math.round(left)}px)`;
  if (el.style.transform !== t) el.style.transform = t;
  const v = on ? "true" : "false";
  if (el.dataset.on !== v) el.dataset.on = v;
}

/**
 * Responsive box with the 3D keyboard and guide hands. The box has its final size from the first
 * paint (aspect ratio capped by a height clamp) and keeps it through loading, so nothing around it
 * moves when the canvas appears. While the three.js chunk and the hand model load, a slim progress
 * bar sits inside the box; the canvas is revealed only once its first frame (hands at rest, camera
 * fitted) is drawn. Renders nothing when settings.showHands is off or WebGL is unavailable, and
 * hands the job to the 2D keyboard (useGuideView) when the scene fails to load.
 */
export const HandsPanel = memo(function HandsPanel({
  layout: layoutProp,
  nextChar,
  nextAction = null,
  press,
  compact = false,
  camera,
  fill = false,
  size = "default",
  leader = true,
  className,
}: HandsPanelProps) {
  // A settings change re-parses the layout into an equal object: do not rebuild the scene for that.
  const layout = stableLayout(layoutProp);
  // Layouts without finger assignments (odd custom boards): the hands would only hide the keys.
  const hasFingers = useMemo(() => layout.keys.some((k) => k.finger), [layout]);
  const [settings] = useSettings();
  const webgl = useWebGLSupport();
  const [prefs, setPrefs] = useLearnPrefs();
  const cam: HandsPanelCamera = camera ?? prefs.camera;
  const reduceMotion = usePrefersReducedMotion();

  const guide = useMemo(() => guideForTarget(layout, nextChar, nextAction), [layout, nextChar, nextAction]);
  // Every key held while the target is pressed: [layer key?, Shift?]. (Read defensively: older guides only know Shift.)
  const holdSig = (guide?.holdKeys ?? (guide?.shiftKey ? [guide.shiftKey] : [])).map((k) => k.id).join(",");
  const holdKeyIds = useMemo(() => (holdSig ? holdSig.split(",") : []), [holdSig]);
  const scenePress = useMemo(() => (press ? { keyId: press.keyId, nonce: press.nonce } : null), [press]);

  const mounted = settings.showHands && webgl === true;
  const [Scene, setScene] = useState<SceneComponent | null>(null);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const failed = useHandsFailed();

  // Step 1: the three.js chunk. The model download starts right away in parallel (it only needs the rig module).
  useEffect(() => {
    if (!mounted || Scene) return;
    let alive = true;
    import("@/components/hands/HandsScene").then(
      (m) => alive && setScene(() => m.default),
      (e) => {
        console.warn("[hands] scene failed to load", e);
        markHandsFailed();
      },
    );
    if (hasFingers) {
      import("@/lib/hands/rig").then((m) => m.loadHandTemplate()).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [mounted, Scene, hasFingers]);

  useEffect(() => {
    if (status === "error") markHandsFailed();
  }, [status]);

  const ready = mounted && status === "ready";
  const load: "loading" | "ready" | "error" = status === "error" || status === "nowebgl" ? "error" : ready ? "ready" : "loading";
  const { value: progress, indeterminate } = useLoadProgress(Scene != null, hasFingers, ready, reduceMotion);

  // The bar appears after a short delay (fast loads show nothing) and stays mounted for the fade-out.
  const [showLoader, setShowLoader] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);
  useEffect(() => {
    if (ready) {
      const id = window.setTimeout(() => setLoaderGone(true), reduceMotion ? 0 : FADE_MS);
      return () => window.clearTimeout(id);
    }
    setLoaderGone(false);
    const id = window.setTimeout(() => setShowLoader(true), LOADER_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [ready, reduceMotion]);

  // ---- annotation: label(s) on a strip above the canvas, joined to their keys by leader lines.
  // The scene reports where the keys are on the canvas (from its frame loop, only when they move);
  // the lines and label positions are written straight to the DOM, so nothing re-renders per frame.
  const targetId = guide?.key?.id ?? "";
  const holds = useMemo(
    () =>
      (guide?.holdKeys ?? []).map((k) => ({
        id: k.id,
        name: guide?.layerKey === k && guide.layer ? guide.layer.name : "shift",
        finger: k.finger ? fingerName(k.finger) : "",
      })),
    [guide],
  );
  const labelRef = useRef<HTMLDivElement>(null);
  const holdLabelRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const holdLineRef = useRef<SVGPathElement>(null);
  const holdDotRef = useRef<SVGCircleElement>(null);
  const anchorsRef = useRef<Readonly<HandsAnchors> | null>(null);
  const leaderRef = useRef({ targetId: "", holdId: "", holdCount: 0, live: false, reduce: false, drawnFor: "", a: { left: 0, edge: 0, elbow: 0 }, b: { left: 0, edge: 0, elbow: 0 } });
  const ld = leaderRef.current;
  ld.targetId = targetId;
  ld.holdCount = holds.length;
  ld.holdId = holds.length === 1 ? holds[0].id : "";
  ld.live = mounted && status === "ready";
  ld.reduce = reduceMotion;

  const applyLeader = useCallback(() => {
    const st = leaderRef.current;
    const label = labelRef.current;
    const holdLabel = holdLabelRef.current;
    if (!label || !holdLabel) return;
    const a = st.live ? anchorsRef.current : null;
    const width = a && a.width > 0 ? a.width : 0;
    // the scene has not drawn this target yet: its next frame calls back with the right positions
    if (a && width && ((st.targetId && a.target.keyId !== st.targetId) || (st.holdId && a.holds[0].keyId !== st.holdId))) return;

    const onKey = !!a && width > 0 && st.targetId !== "" && a.target.visible;
    const kx = onKey && a ? a.target.x : 0;
    const ky = onKey && a ? a.target.y + STRIP : 0;
    let holdLeader = !!a && width > 0 && st.holdId !== "" && a.holds[0].visible;
    const hx = holdLeader && a ? a.holds[0].x : 0;
    const hy = holdLeader && a ? a.holds[0].y + STRIP : 0;

    const inline = (v: boolean) => {
      const s = v ? "true" : "false";
      if (label.dataset.holdInline !== s) label.dataset.holdInline = s;
    };
    const tight = (v: boolean) => {
      const s = v ? "true" : "false";
      if (holdLabel.dataset.tight !== s) holdLabel.dataset.tight = s;
    };
    // labels extend towards the middle of the plate, where there is always room
    const dir: 1 | -1 = kx < width / 2 ? 1 : -1;
    const hdir: 1 | -1 = hx < width / 2 ? 1 : -1;
    inline(st.holdCount > 0 && !holdLeader);
    let lw = label.offsetWidth;
    const p = st.a;
    if (onKey) placeLabel(p, kx, ky, width, lw, dir);
    else p.left = 0;
    const q = st.b;
    if (holdLeader) {
      // the held key's label: towards the middle, else on the outer side of its key (in full, then
      // without the finger name)
      const out = hdir > 0 ? -1 : 1;
      tight(false);
      let hw = holdLabel.offsetWidth;
      placeLabel(q, hx, hy, width, hw, hdir);
      if (overlaps(p.left, lw, q.left, hw) && overlaps(p.left, lw, placeLabel(q, hx, hy, width, hw, out).left, hw)) {
        tight(true);
        hw = holdLabel.offsetWidth;
        placeLabel(q, hx, hy, width, hw, hdir);
        if (overlaps(p.left, lw, q.left, hw) && overlaps(p.left, lw, placeLabel(q, hx, hy, width, hw, out).left, hw)) {
          // no room for a second label: the held key is named after the first one instead
          holdLeader = false;
          inline(true);
          lw = label.offsetWidth;
          if (onKey) placeLabel(p, kx, ky, width, lw, dir);
        }
      }
    }

    setLabel(label, p.left, true);
    const len = setLine(lineRef.current, dotRef.current, onKey ? p : null, kx, ky);
    setLabel(holdLabel, holdLeader ? q.left : 0, holdLeader);
    setLine(holdLineRef.current, holdDotRef.current, holdLeader ? q : null, hx, hy);

    // a new target: the leader is drawn from the label out to the key (not with reduced motion)
    const drawn = onKey ? st.targetId : "";
    if (drawn && drawn !== st.drawnFor && !st.reduce && len > 0 && lineRef.current?.animate) {
      const dash = `${len} ${len}`;
      lineRef.current.animate(
        [
          { strokeDasharray: dash, strokeDashoffset: len },
          { strokeDasharray: dash, strokeDashoffset: 0 },
        ],
        { duration: DRAW_MS, easing: EASE_OUT },
      );
    }
    st.drawnFor = drawn;
  }, []);

  const onAnchors = useCallback(
    (a: Readonly<HandsAnchors>) => {
      anchorsRef.current = a;
      applyLeader();
    },
    [applyLeader],
  );
  // label text (and with it the label widths) changes with the render: place them again before paint
  useLayoutEffect(() => {
    if (leader) applyLeader();
  });
  useEffect(() => {
    if (!leader || typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    document.fonts.ready.then(() => alive && applyLeader());
    return () => {
      alive = false;
    };
  }, [leader, applyLeader]);

  if (!settings.showHands || webgl === false || failed) return null;
  if (mounted && status === "nowebgl") return null;

  const fade = reduceMotion ? "" : "transition-opacity duration-300";
  const style: CSSProperties = fill ? { height: "100%" } : handsBoxStyle(compact, size);
  // the wrists run out of the frame: fade them instead of cutting them off
  // (and a finger that reaches past the far row dissolves under the label strip the same way)
  const mask = "linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - min(20%, 44px)), transparent)";
  const swatch = guide && guide.fingerIndex >= 0 && settings.fingerColors ? `var(--finger-${guide.fingerIndex})` : "var(--main)";

  return (
    <div
      className={cx("group/hands relative flex w-full flex-col overflow-hidden", !fill && "tt-hands-box", className)}
      style={style}
      data-size={size}
      data-leader={leader ? "true" : "false"}
      data-testid="hands-panel"
      data-compact={compact ? "true" : "false"}
      data-fill={fill ? "true" : "false"}
      data-camera={cam}
      data-status={mounted ? status : "pending"}
      data-hands-load={load}
      data-target-key={guide?.key?.id ?? ""}
      data-modifier-key={guide?.shiftKey?.id ?? ""}
      data-hold-keys={holdSig}
    >
      {leader && <div aria-hidden className="shrink-0" style={{ height: STRIP }} />}
      <div className="relative min-h-0 w-full flex-1" style={{ maskImage: mask, WebkitMaskImage: mask }}>
        {mounted && Scene && (
          <Scene
            layout={layout}
            targetKeyId={guide?.key?.id ?? null}
            holdKeyIds={holdKeyIds}
            press={scenePress}
            pressedOk={press?.ok ?? true}
            camera={cam}
            fingerZones={settings.fingerColors}
            showHands={hasFingers}
            onStatus={setStatus}
            onAnchors={leader ? onAnchors : undefined}
            className={cx(fade, ready ? "opacity-100" : "opacity-0")}
          />
        )}
        {showLoader && !loaderGone && (
          <div
            className={cx("pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5", fade, ready ? "opacity-0" : "opacity-100")}
            data-testid="hands-loader"
            data-indeterminate={indeterminate ? "true" : "false"}
            role="status"
          >
            <div className="w-[min(60%,240px)]">
              <ProgressBar data-testid="hands-progress" size="sm" value={progress * 100} aria-label="Loading 3D hands" />
            </div>
            <span className="ll-lettering-sm text-sub">Drawing 3D hands</span>
          </div>
        )}
      </div>
      {leader && (
        // Decorative for assistive tech: the same words are in KeyboardGuide's hint line, which stays in the accessibility tree.
        <div aria-hidden className="tt-leader pointer-events-none absolute inset-0" data-testid="hands-leader" data-target-key={targetId}>
          <svg className="absolute inset-0 size-full overflow-visible" focusable="false">
            <path ref={holdLineRef} className="tt-leader-line tt-leader-line--hold" style={{ display: "none" }} />
            <circle ref={holdDotRef} className="tt-leader-dot" r="2.5" style={{ display: "none" }} />
            <path ref={lineRef} className="tt-leader-line" style={{ display: "none" }} />
            <circle ref={dotRef} className="tt-leader-dot" r="2.5" style={{ display: "none" }} />
          </svg>
          <div ref={labelRef} className="tt-leader-label" data-testid="hands-leader-label" data-on="true" data-hold-inline="false">
            {guide && guide.key ? (
              <>
                <span className="size-2.5 shrink-0 border border-line" style={{ backgroundColor: swatch }} />
                <span className="ll-lettering text-text">{guide.fingerName || "any finger"}</span>
                <Icon name="arrow-right" size={14} className="shrink-0 text-sub" />
                <Kbd className={guide.keyLabel.length > 1 ? "px-2" : undefined}>{guide.keyLabel}</Kbd>
                {guide.action && (
                  <span className="text-sm text-sub">
                    fix the typo{guide.actionCount && guide.actionCount > 1 ? ` (×${guide.actionCount})` : ""}
                  </span>
                )}
                {holds.length > 0 && (
                  <span className="tt-leader-inline">
                    {holds.map((h) => (
                      <span key={h.id} className="inline-flex items-center gap-1.5">
                        <span className="text-sub">+</span>
                        <Kbd className="px-2">{h.name}</Kbd>
                      </span>
                    ))}
                  </span>
                )}
              </>
            ) : guide ? (
              <span className="text-sm text-text">
                <Kbd>{guide.keyLabel}</Kbd> is not on this layout
              </span>
            ) : null}
          </div>
          <div ref={holdLabelRef} className="tt-leader-label" data-testid="hands-leader-hold" data-on="false" data-tight="false">
            {holds.length === 1 && (
              <>
                <span className="ll-lettering-sm text-sub">hold</span>
                <Kbd className="px-2">{holds[0].name}</Kbd>
                {holds[0].finger && <span className="tt-leader-extra ll-lettering-sm text-text">{holds[0].finger}</span>}
              </>
            )}
          </div>
        </div>
      )}
      {camera == null && (
        <button
          type="button"
          data-testid="hands-camera"
          data-camera={cam}
          aria-label={`Camera: ${cam}. Switch to ${cam === "angled" ? "top" : "angled"} view`}
          title="Switch camera"
          onClick={(e) => {
            setPrefs({ camera: cam === "angled" ? "top" : "angled" });
            e.currentTarget.blur();
          }}
          className="tt-fade ll-lettering-sm absolute right-0 bottom-0 inline-flex h-7 items-center gap-1.5 border border-transparent px-2 text-sub transition-colors duration-150 hover:border-line hover:text-text"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
            <path d="M3 7h4.5l1.5-2.500h6l1.500 2.500H21v12H3z" />
            <circle cx="12" cy="12.500" r="3.200" />
          </svg>
          <span className="ll-trim">View: {cam}</span>
        </button>
      )}
    </div>
  );
});

export default HandsPanel;
