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
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ComponentType } from "react";
import type { HandsSceneProps } from "@/components/hands/HandsScene";
import { ProgressBar, SegmentedControl, cx } from "@/components/ui";
import { getHandModelProgress, subscribeHandModelProgress } from "@/lib/hands/progress";
import { useLearnPrefs } from "@/components/learn/prefs";
import { stableLayout } from "@/components/learn/stableLayout";
import { getSettings, useSettings } from "@/lib/settings";
import type { ParsedLayout } from "@/lib/types";
import { guideForTarget, type GuideAction } from "./KeyboardGuide";

export type GuideView = "hands" | "keys" | "both" | "none";
export type HandsPanelCamera = "angled" | "top";

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
    <SegmentedControl
      variant="inline"
      size="sm"
      aria-label="Typing guide"
      data-testid="view-switch"
      className={cx("shrink-0 flex-nowrap !gap-x-0", className)}
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
          icon: "hand",
          label: (
            <>
              <span className="sr-only">3D </span>
              <span className="sr-only md:not-sr-only">hands</span>
            </>
          ),
        },
        {
          value: "keys",
          icon: "keyboard",
          label: (
            <>
              <span className="sr-only">2D </span>
              <span className="sr-only md:not-sr-only">keys</span>
            </>
          ),
        },
        { value: "both", label: "both" },
      ]}
    />
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

/** Size of the hands box (also reserved for the 2D board when the guide is switched to "keys"). */
export function handsBoxStyle(compact: boolean): CSSProperties {
  return {
    aspectRatio: compact ? "5 / 2" : "2 / 1",
    maxHeight: compact ? "clamp(150px, 21.5dvh, 250px)" : "clamp(190px, 33dvh, 380px)",
  };
}

/**
 * Responsive box with the 3D keyboard and guide hands. The box has its final size from the first
 * paint (aspect ratio capped by a height clamp) and keeps it through loading, so nothing around it
 * moves when the canvas appears. While the three.js chunk and the hand model load, a slim progress
 * bar sits inside the box; the canvas is revealed only once its first frame (hands at rest, camera
 * fitted) is drawn. Renders nothing when settings.showHands is off or WebGL is unavailable, and
 * hands the job to the 2D keyboard (useGuideView) when the scene fails to load.
 */
export const HandsPanel = memo(function HandsPanel({ layout: layoutProp, nextChar, nextAction = null, press, compact = false, camera, className }: HandsPanelProps) {
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

  if (!settings.showHands || webgl === false || failed) return null;
  if (mounted && status === "nowebgl") return null;

  const fade = reduceMotion ? "" : "transition-opacity duration-300";
  const style = {
    ...handsBoxStyle(compact),
    // the wrists run out of the frame: fade them instead of cutting them off
    maskImage: "linear-gradient(to bottom, #000 80%, transparent)",
    WebkitMaskImage: "linear-gradient(to bottom, #000 80%, transparent)",
  } as CSSProperties;

  return (
    <div
      className={cx("group/hands relative w-full overflow-hidden rounded-ui-lg", className)}
      style={style}
      data-testid="hands-panel"
      data-compact={compact ? "true" : "false"}
      data-camera={cam}
      data-status={mounted ? status : "pending"}
      data-hands-load={load}
      data-target-key={guide?.key?.id ?? ""}
      data-modifier-key={guide?.shiftKey?.id ?? ""}
      data-hold-keys={holdSig}
    >
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
          <div className="w-[min(60%,220px)]">
            <ProgressBar data-testid="hands-progress" size="sm" value={progress * 100} aria-label="Loading 3D hands" />
          </div>
          <span className="text-xs text-sub">Loading 3D hands…</span>
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
          className="tt-fade absolute top-1 right-1 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-sub transition-colors duration-150 hover:bg-text/[0.07] hover:text-text"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 8.5a2 2 0 0 1 2-2h2.2l1.3-2h7l1.3 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.500z" />
            <circle cx="12" cy="12.500" r="3.200" />
          </svg>
          {cam}
        </button>
      )}
    </div>
  );
});

export default HandsPanel;
