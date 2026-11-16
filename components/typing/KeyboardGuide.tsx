"use client";
// The learning aid under the text: a 2D keyboard that lights up the next key in its finger colour
// (plus the Shift on the other hand when needed), shows held keys, flashes wrong keys, and names
// the finger in one line. The 3D hands view is mounted through `handsSlot` by its own module.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { FingerId, LayoutKey, ParsedLayout } from "@/lib/types";
import { fingerIndex } from "@/lib/types";
import { keyForChar } from "@/lib/layout/keys";
import { keyAction } from "@/lib/layout/parse";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { useSettings } from "@/lib/settings";
import { Kbd, cx } from "@/components/ui";
import "./typing.css";

export interface KeyGuide {
  char: string;
  /** Key that types the character; null when the layout cannot type it. */
  key: LayoutKey | null;
  /** Shift to hold with the other hand, when the character is on the shifted layer. */
  shiftKey: LayoutKey | null;
  /** Ids to highlight: [key, shift?]. */
  keyIds: string[];
  finger: FingerId | null;
  /** Index into --finger-0…9, or -1. */
  fingerIndex: number;
  /** "left index", "right pinky", "thumb"… ("" when unknown). */
  fingerName: string;
  /** What to print on the hint keycap: "F", ";", "space", "Backspace". */
  keyLabel: string;
  /** Set when the target is an action key (Backspace) rather than a character. */
  action?: GuideAction;
  /** Action guides: how many presses until the typo is gone. */
  actionCount?: number;
}

/** Keys the guide can point at besides characters. */
export type GuideAction = "backspace";

/** The layout's Backspace key; one that has a finger wins (a layout may list several). */
export function findActionKey(layout: ParsedLayout, action: GuideAction): LayoutKey | null {
  const keys = layout.keys.filter((k) => keyAction(k) === action);
  return keys.find((k) => k.finger) ?? keys[0] ?? null;
}

/** Guide for pressing an action key (same shape as `guideForChar`); null when the layout has no such key. */
export function guideForAction(layout: ParsedLayout, action: GuideAction, count = 1): KeyGuide | null {
  const key = findActionKey(layout, action);
  if (!key) return null;
  const finger = key.finger ?? null;
  return {
    char: "",
    key,
    shiftKey: null,
    keyIds: [key.id],
    finger,
    fingerIndex: finger ? fingerIndex(finger) : -1,
    fingerName: fingerName(finger),
    keyLabel: "Backspace",
    action,
    actionCount: count,
  };
}

/** What to point at: the action key when one is wanted and exists, else the key for `char`. */
export function guideForTarget(layout: ParsedLayout, char: string | null | undefined, action?: GuideAction | null, count = 1): KeyGuide | null {
  return (action ? guideForAction(layout, action, count) : null) ?? guideForChar(layout, char);
}

export function fingerName(f: FingerId | null | undefined): string {
  if (!f) return "";
  if (f.finger === "thumb") return "thumb";
  return `${f.hand === "L" ? "left" : "right"} ${f.finger}`;
}

/** Everything a guide (2D keys, hint line, 3D hands) needs to know about typing `char`. */
export function guideForChar(layout: ParsedLayout, char: string | null | undefined): KeyGuide | null {
  if (char == null || char === "") return null;
  const hit = keyForChar(layout, char);
  const keyLabel = char === " " ? "space" : char.length === 1 && char.toLowerCase() !== char.toUpperCase() ? char.toUpperCase() : char;
  if (!hit) return { char, key: null, shiftKey: null, keyIds: [], finger: null, fingerIndex: -1, fingerName: "", keyLabel };
  const finger = hit.key.finger ?? null;
  const shiftKey = hit.needsShift ? hit.shiftKey ?? null : null;
  return {
    char,
    key: hit.key,
    shiftKey,
    keyIds: shiftKey ? [hit.key.id, shiftKey.id] : [hit.key.id],
    finger,
    fingerIndex: finger ? fingerIndex(finger) : -1,
    fingerName: fingerName(finger),
    keyLabel,
  };
}

export interface KeyboardGuideProps {
  layout: ParsedLayout;
  /** Character to type next (`useTypingTest().nextChar`); null = nothing to highlight. */
  nextChar: string | null;
  /** Point at an action key instead of `nextChar` (Backspace while the current word has a typo). */
  nextAction?: GuideAction | null;
  /** With `nextAction`: how many presses are needed. */
  actionCount?: number;
  /** `useKeyboardInput().pressedKeyIds` */
  pressedKeyIds?: string[];
  /** `useKeyboardInput().errorKeyIds` */
  errorKeyIds?: string[];
  /** keyIds to dim (keys a lesson has not introduced yet). */
  dimKeyIds?: string[];
  /** Default: settings.fingerColors. */
  fingerColors?: boolean;
  /** Default: settings.showKeyboard. When false only the hint line and the hands slot render. */
  showKeyboard?: boolean;
  /** The "left index · F" line (default true). */
  showHint?: boolean;
  /** Right-hand side of the hint line (the test page puts the emulation toggle here). */
  hintEnd?: ReactNode;
  /**
   * SLOT FOR THE 3D HANDS VIEW. Rendered between the hint line and the 2D board, full width of
   * the guide. Pass `<Hands … />` here (the lessons / hands agent does; this component never
   * imports components/hands). `children` is an alias.
   */
  handsSlot?: ReactNode;
  children?: ReactNode;
  /**
   * Size of a box to keep free for the 2D board when no hands slot is shown (pass the 3D hands box
   * size, `handsBoxStyle(false)`): switching between hands and keys then does not move the text.
   * The board is centred in it and may be taller than it.
   */
  reserveBox?: CSSProperties;
  /** Largest key unit in px (default 46). */
  maxUnit?: number;
  className?: string;
}

const NONE: string[] = [];

export function KeyboardGuide({
  layout,
  nextChar,
  nextAction = null,
  actionCount = 1,
  pressedKeyIds = NONE,
  errorKeyIds = NONE,
  dimKeyIds,
  fingerColors,
  showKeyboard,
  showHint = true,
  hintEnd,
  handsSlot,
  children,
  maxUnit = 46,
  reserveBox,
  className,
}: KeyboardGuideProps) {
  const [settings] = useSettings();
  const colors = fingerColors ?? settings.fingerColors;
  const show = showKeyboard ?? settings.showKeyboard;
  const guide = useMemo(() => guideForTarget(layout, nextChar, nextAction, actionCount), [layout, nextChar, nextAction, actionCount]);
  const highlight = guide?.keyIds ?? NONE;
  const slot = handsSlot ?? children;

  const color = guide && guide.fingerIndex >= 0 && colors ? `var(--finger-${guide.fingerIndex})` : "var(--main)";
  const shiftFinger = guide?.shiftKey?.finger ? fingerName(guide.shiftKey.finger) : "";

  return (
    <div
      className={cx("tt-guide mx-auto flex w-full flex-col", className)}
      data-finger-colors={colors ? "true" : "false"}
      style={{ maxWidth: Math.max(640, Math.ceil(layout.width * maxUnit)) } as CSSProperties}
      data-testid="keyboard-guide"
      data-next-char={nextChar ?? ""}
      data-next-action={guide?.action ?? ""}
      data-next-key={guide?.key?.id ?? ""}
      data-next-finger={guide?.finger ? `${guide.finger.hand}-${guide.finger.finger}` : ""}
      data-shift-key={guide?.shiftKey?.id ?? ""}
    >
      {(showHint || hintEnd) && (
        <div className="mb-3 flex min-h-7 items-center justify-between gap-3 text-[13px] text-sub">
          <div className="flex min-w-0 items-center gap-2" data-testid="key-hint" aria-live="off">
            {showHint && guide && guide.key && (
              <>
                <span aria-hidden className="size-2 shrink-0 rounded-full transition-colors duration-100" style={{ backgroundColor: color }} />
                <span className="whitespace-nowrap transition-colors duration-100" style={{ color }}>
                  {guide.fingerName || "any finger"}
                </span>
                <span aria-hidden className="text-sub/60">
                  ·
                </span>
                <Kbd className={guide.keyLabel.length > 1 ? "px-2" : undefined}>{guide.keyLabel}</Kbd>
                {guide.action && (
                  <span className="truncate" data-testid="key-hint-action">
                    <span className="text-sub/60">— </span>fix the typo{guide.actionCount && guide.actionCount > 1 ? ` (×${guide.actionCount})` : ""}
                  </span>
                )}
                {guide.shiftKey && (
                  <span className="hidden items-center gap-1.5 truncate sm:inline-flex">
                    <span className="text-sub/60">+</span>
                    <Kbd className="px-2">shift</Kbd>
                    {shiftFinger && <span className="hidden truncate md:inline">{shiftFinger}</span>}
                  </span>
                )}
              </>
            )}
            {showHint && guide && !guide.key && (
              <span className="truncate">
                <Kbd>{guide.keyLabel}</Kbd> is not on this layout
              </span>
            )}
          </div>
          {hintEnd && <div className="flex min-w-0 items-center gap-2">{hintEnd}</div>}
        </div>
      )}

      {/* ── hands slot: the 3D hands view mounts here ── */}
      {slot != null && slot !== false && (
        <div data-slot="hands" data-testid="hands-slot" className="mb-3 w-full">
          {slot}
        </div>
      )}

      {show && (
        <div className={reserveBox && slot == null ? "mb-3 grid w-full items-center" : undefined} data-testid={reserveBox && slot == null ? "keys-reserve" : undefined}>
          {reserveBox && slot == null && <div aria-hidden className="pointer-events-none invisible" style={{ ...reserveBox, gridArea: "1 / 1" }} />}
          <div style={reserveBox && slot == null ? { gridArea: "1 / 1" } : undefined}>
            <Keyboard2D
              layout={layout}
              highlightKeyIds={highlight}
              pressedKeyIds={pressedKeyIds}
              errorKeyIds={errorKeyIds}
              dimUnused={dimKeyIds}
              fingerColors={colors}
              maxUnit={maxUnit}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default KeyboardGuide;
