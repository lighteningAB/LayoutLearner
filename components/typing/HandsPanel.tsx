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
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import HandsScene from "@/components/hands";
import { SegmentedControl, Skeleton, cx } from "@/components/ui";
import { useLearnPrefs } from "@/components/learn/prefs";
import { stableLayout } from "@/components/learn/stableLayout";
import { useSettings } from "@/lib/settings";
import type { ParsedLayout } from "@/lib/types";
import { guideForChar } from "./KeyboardGuide";

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
  /** false once we know WebGL is unavailable (the view switch hides itself). */
  handsSupported: boolean;
}

/** Which guides to show: settings.showHands / settings.showKeyboard (+ the "both" opt-in), corrected for missing WebGL. */
export function useGuideView(): GuideViewState {
  const [settings, update] = useSettings();
  const [prefs, setPrefs] = useLearnPrefs();
  const webgl = useWebGLSupport();
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
  const showHands = settings.showHands && webgl !== false;
  const showKeyboard = view === "both" || view === "keys" || (settings.showHands && webgl === false);
  return { view, setView, showHands, showKeyboard, keyboardUnit: showHands && showKeyboard ? 30 : 46, handsSupported: webgl !== false };
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
  /** Character to type next: its finger reaches for the key (and the other hand holds Shift when needed). */
  nextChar: string | null;
  /** Latest keystroke (`useGuidePress`): taps the key, in the accent or the error colour. */
  press?: GuidePress | null;
  /** Shorter panel, for when the 2D board is shown underneath. */
  compact?: boolean;
  /** Fixed camera; hides the camera toggle. Default: the persisted choice (angled / top). */
  camera?: HandsPanelCamera;
  className?: string;
}

type SceneStatus = "loading" | "ready" | "error" | "nowebgl";

/**
 * Responsive, fixed-height box with the 3D keyboard and guide hands. Renders nothing when
 * settings.showHands is off or WebGL is unavailable (so no canvas, and no three.js download).
 */
export const HandsPanel = memo(function HandsPanel({ layout: layoutProp, nextChar, press, compact = false, camera, className }: HandsPanelProps) {
  // A settings change re-parses the layout into an equal object: do not rebuild the scene for that.
  const layout = stableLayout(layoutProp);
  // Layouts without finger assignments (odd custom boards): the hands would only hide the keys.
  const hasFingers = useMemo(() => layout.keys.some((k) => k.finger), [layout]);
  const [settings] = useSettings();
  const webgl = useWebGLSupport();
  const [prefs, setPrefs] = useLearnPrefs();
  const cam: HandsPanelCamera = camera ?? prefs.camera;

  const guide = useMemo(() => guideForChar(layout, nextChar), [layout, nextChar]);
  const scenePress = useMemo(() => (press ? { keyId: press.keyId, nonce: press.nonce } : null), [press]);

  // The scene reports its state through [data-hands-status]; mirror it to fade the skeleton out.
  const boxRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const mounted = settings.showHands && webgl === true;
  useEffect(() => {
    const box = boxRef.current;
    if (!mounted || !box) return;
    const read = () => {
      const s = box.querySelector("[data-hands-status]")?.getAttribute("data-hands-status") as SceneStatus | null;
      if (s) setStatus((prev) => (prev === s ? prev : s));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-hands-status"] });
    return () => mo.disconnect();
  }, [mounted]);

  if (!settings.showHands || webgl === false) return null;
  if (mounted && status === "nowebgl") return null;

  const busy = !mounted || status === "loading";
  const style = {
    aspectRatio: compact ? "5 / 2" : "2 / 1",
    maxHeight: compact ? "clamp(150px, 21.5dvh, 250px)" : "clamp(190px, 33dvh, 380px)",
    // the wrists run out of the frame: fade them instead of cutting them off
    maskImage: "linear-gradient(to bottom, #000 80%, transparent)",
    WebkitMaskImage: "linear-gradient(to bottom, #000 80%, transparent)",
  } as CSSProperties;

  return (
    <div
      ref={boxRef}
      className={cx("group/hands relative w-full overflow-hidden rounded-ui-lg", className)}
      style={style}
      data-testid="hands-panel"
      data-compact={compact ? "true" : "false"}
      data-camera={cam}
      data-status={mounted ? status : "pending"}
      data-target-key={guide?.key?.id ?? ""}
      data-modifier-key={guide?.shiftKey?.id ?? ""}
    >
      {mounted && (
        <HandsScene
          layout={layout}
          targetKeyId={guide?.key?.id ?? null}
          modifierKeyId={guide?.shiftKey?.id ?? null}
          press={scenePress}
          pressedOk={press?.ok ?? true}
          camera={cam}
          fingerZones={settings.fingerColors}
          showHands={hasFingers}
          className={cx("transition-opacity duration-300", busy ? "opacity-0" : "opacity-100")}
        />
      )}
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" data-testid="hands-skeleton" aria-hidden>
          <Skeleton animate className="h-[58%] w-[min(78%,560px)] rounded-ui-lg" />
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
