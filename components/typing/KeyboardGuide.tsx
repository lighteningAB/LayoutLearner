"use client";
// The learning aid under the text, drawn as a plate on the sheet: an annotation line that names the
// finger and the key ("LEFT INDEX -> T"), the 3D hands (mounted through `handsSlot` by their own
// module) and / or a 2D keyboard that fills the next key in its finger colour, shows held keys and
// flashes wrong ones. `NextKeyDetail` is the same information as a drafted detail box.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { FingerId, LayoutKey, LayoutLayer, ParsedLayout } from "@/lib/types";
import { fingerIndex } from "@/lib/types";
import { keyForChar } from "@/lib/layout/keys";
import { keyAction } from "@/lib/layout/parse";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { useSettings } from "@/lib/settings";
import { Icon, Kbd, cx } from "@/components/ui";
import "./typing.css";

export interface KeyGuide {
  char: string;
  /** Key that types the character; null when the layout cannot type it. */
  key: LayoutKey | null;
  /** Shift to hold with the other hand, when the character is on the shifted layer. */
  shiftKey: LayoutKey | null;
  /** Layer activator to hold, when the character lives on a layer. */
  layerKey: LayoutKey | null;
  /** The layer the character lives on, or null for base / Shift. */
  layer: LayoutLayer | null;
  /** Every key to HOLD while pressing `key`, in order [layerKey?, shiftKey?]. The 3D hands pose these. */
  holdKeys: LayoutKey[];
  /** Ids to highlight: [key, ...holdKeys]. */
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
    layerKey: null,
    layer: null,
    holdKeys: [],
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
  if (!hit) return { char, key: null, shiftKey: null, layerKey: null, layer: null, holdKeys: [], keyIds: [], finger: null, fingerIndex: -1, fingerName: "", keyLabel };
  const finger = hit.key.finger ?? null;
  const shiftKey = hit.needsShift ? hit.shiftKey ?? null : null;
  const layerKey = hit.layer ? hit.layerKey ?? null : null;
  const holdKeys = [layerKey, shiftKey].filter((k): k is LayoutKey => !!k);
  return {
    char,
    key: hit.key,
    shiftKey,
    layerKey,
    layer: layerKey ? hit.layer ?? null : null,
    holdKeys,
    keyIds: [hit.key.id, ...holdKeys.map((k) => k.id)],
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
  /** The "LEFT INDEX -> F" line (default true). */
  showHint?: boolean;
  /** Right-hand side of the hint line (the lessons put the view switch and the emulation toggle here). */
  hintEnd?: ReactNode;
  /** Annotations under the plate (the typing test puts its guide switches here). */
  footer?: ReactNode;
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
   * The board is centred in it and may be taller than it. Ignored with `fill`.
   */
  reserveBox?: CSSProperties;
  /**
   * Fill the parent instead of sizing from the board: from `md` up the guide takes the full height
   * and width it is given and the plate (hands and / or board) shares what the annotation lines
   * leave. The parent must then have a definite height. Below `md` the plate keeps its own aspect.
   * Pass `fill` to the `<HandsPanel>` in the slot as well.
   */
  fill?: boolean;
  /**
   * Largest key unit in px (default 46). The guide is at most as wide as the board at this unit; a
   * stylesheet can lift that with the custom property `--tt-guide-max-width` (no !important needed).
   */
  maxUnit?: number;
  className?: string;
}

const NONE: string[] = [];

const heldFinger = (k: LayoutKey | null | undefined) => (k?.finger ? fingerName(k.finger) : "");

/** Fill and legend colours of the guide's finger cell: the finger colour, or the action colour without finger colours. */
function fingerFill(guide: KeyGuide | null, colors: boolean): { bg: string; fg: string } {
  return guide && guide.fingerIndex >= 0 && colors
    ? { bg: `var(--finger-${guide.fingerIndex})`, fg: "var(--finger-fg)" }
    : { bg: "var(--main)", fg: "var(--main-fg)" };
}

/** Short legend for a key cell: one character as is, long names shortened to fit. */
function cellLegend(label: string): string {
  if (label === "Backspace") return "bksp";
  if (label === "space") return "spc";
  return label;
}

export interface NextKeyDetailProps {
  layout: ParsedLayout;
  nextChar: string | null;
  nextAction?: GuideAction | null;
  actionCount?: number;
  /** Default: settings.fingerColors. */
  fingerColors?: boolean;
  className?: string;
}

/**
 * The next key as a drafted detail box: the key legend in a cell filled with its finger's colour,
 * the finger named in lettering, then hand / finger / hold as a ruled list. Finger identity is
 * always written out; the colour only repeats it.
 */
export function NextKeyDetail({ layout, nextChar, nextAction = null, actionCount = 1, fingerColors, className }: NextKeyDetailProps) {
  const [settings] = useSettings();
  const colors = fingerColors ?? settings.fingerColors;
  const guide = useMemo(() => guideForTarget(layout, nextChar, nextAction, actionCount), [layout, nextChar, nextAction, actionCount]);
  const fill = fingerFill(guide, colors);
  const f = guide?.finger ?? null;
  const hold = guide ? [guide.layer && guide.layerKey ? guide.layer.name : "", guide.shiftKey ? "shift" : ""].filter(Boolean).join(" + ") : "";
  const holdBy = guide ? heldFinger(guide.shiftKey) || heldFinger(guide.layerKey) : "";
  const legend = guide ? cellLegend(guide.keyLabel) : "";
  const rows: [string, string][] = [
    ["Hand", f ? (f.hand === "L" ? "left" : "right") : "any"],
    ["Finger", f ? f.finger : "any"],
    ["Hold", hold ? (holdBy ? `${hold}, ${holdBy}` : hold) : "none"],
  ];
  const sub = !guide
    ? ""
    : guide.action
      ? `fix the typo${guide.actionCount && guide.actionCount > 1 ? ` (×${guide.actionCount})` : ""}`
      : guide.keyLabel.length > 1
        ? `${guide.keyLabel} bar`
        : `key ${guide.keyLabel}`;
  return (
    <section className={cx("border border-line", className)} aria-label="Next key" data-testid="next-key-detail" data-next-key={guide?.key?.id ?? ""}>
      <h2 className="ll-lettering-sm border-b border-border px-3 py-2 text-text">Next key</h2>
      {/* No live region: this changes on every keystroke. */}
      <div className="px-3 py-3" aria-live="off">
        {guide && guide.key ? (
          <>
            <div className="flex items-center gap-3">
              <span
                className={cx(
                  "inline-flex size-12 shrink-0 items-center justify-center border border-line font-mono leading-none font-semibold",
                  legend.length > 1 ? "text-sm" : "text-2xl",
                )}
                style={{ backgroundColor: fill.bg, color: fill.fg }}
              >
                {legend}
              </span>
              <span className="min-w-0">
                {/* two lines reserved: "right middle" wraps, and the box must not change height from key to key */}
                <span className="ll-lettering-lg flex min-h-[2.5em] items-center text-text">{guide.fingerName || "any finger"}</span>
                <span className="mt-1 block truncate text-sm leading-tight text-sub">{sub}</span>
              </span>
            </div>
            <dl className="mt-3 border-t border-hairline text-sm leading-tight">
              {rows.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b border-dashed border-hairline py-1.5 last:border-b-0 last:pb-0">
                  <dt className="text-sub">{k}</dt>
                  <dd className="min-w-0 truncate text-right font-mono text-xs text-text">{v}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : guide ? (
          <p className="text-sm leading-snug text-text">
            <Kbd>{guide.keyLabel}</Kbd> is not on this layout
          </p>
        ) : (
          <p className="text-sm leading-snug text-sub">No key to press.</p>
        )}
      </div>
    </section>
  );
}

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
  footer,
  handsSlot,
  children,
  maxUnit = 46,
  reserveBox,
  fill = false,
  className,
}: KeyboardGuideProps) {
  const [settings] = useSettings();
  const colors = fingerColors ?? settings.fingerColors;
  const show = showKeyboard ?? settings.showKeyboard;
  const guide = useMemo(() => guideForTarget(layout, nextChar, nextAction, actionCount), [layout, nextChar, nextAction, actionCount]);
  const highlight = guide?.keyIds ?? NONE;
  const slot = handsSlot ?? children;
  const hasSlot = slot != null && slot !== false;
  const reserve = !fill && reserveBox && !hasSlot ? reserveBox : undefined;

  const swatch = fingerFill(guide, colors).bg;
  const shiftFinger = heldFinger(guide?.shiftKey);
  const layerFinger = heldFinger(guide?.layerKey);
  const plus = (
    <span aria-hidden className="text-sub">
      +
    </span>
  );

  return (
    <div
      className={cx("tt-guide mx-auto flex w-full flex-col", className)}
      data-finger-colors={colors ? "true" : "false"}
      data-fill={fill ? "true" : "false"}
      style={
        {
          maxWidth: fill ? undefined : `var(--tt-guide-max-width, ${Math.max(640, Math.ceil(layout.width * maxUnit))}px)`,
          "--tt-board-ratio": (layout.width / Math.max(1, layout.height)).toFixed(3),
        } as CSSProperties
      }
      data-testid="keyboard-guide"
      data-next-char={nextChar ?? ""}
      data-next-action={guide?.action ?? ""}
      data-next-key={guide?.key?.id ?? ""}
      data-next-finger={guide?.finger ? `${guide.finger.hand}-${guide.finger.finger}` : ""}
      data-shift-key={guide?.shiftKey?.id ?? ""}
      data-layer={guide?.layer?.id ?? ""}
      data-layer-key={guide?.layerKey?.id ?? ""}
    >
      {(showHint || hintEnd) && (
        <div className="tt-hint-row mb-2 flex min-h-7 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-sub" data-end={hintEnd ? "true" : "false"}>
          <div className="flex min-h-7 min-w-0 items-center gap-2" data-testid="key-hint" aria-live="off">
            {showHint && guide && guide.key && (
              <>
                {guide.layer && guide.layerKey && (
                  <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap" data-testid="key-hint-layer">
                    <span>hold</span>
                    <Kbd className="px-2">{guide.layer.name}</Kbd>
                    {/* A three-key chord (layer + Shift + key) has no room for the finger names of the held keys. */}
                    {layerFinger && !guide.shiftKey && <span className="hidden md:inline">({layerFinger})</span>}
                    {plus}
                  </span>
                )}
                <span aria-hidden className="size-2.5 shrink-0 border border-line" style={{ backgroundColor: swatch }} />
                <span className="ll-lettering whitespace-nowrap text-text">{guide.fingerName || "any finger"}</span>
                <Icon name="arrow-right" size={14} className="shrink-0 text-sub" />
                <Kbd className={guide.keyLabel.length > 1 ? "px-2" : undefined}>{guide.keyLabel}</Kbd>
                {guide.action && (
                  <span className="truncate" data-testid="key-hint-action">
                    fix the typo{guide.actionCount && guide.actionCount > 1 ? ` (×${guide.actionCount})` : ""}
                  </span>
                )}
                {guide.shiftKey && (
                  <span className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap sm:inline-flex">
                    {plus}
                    <Kbd className="px-2">shift</Kbd>
                    {shiftFinger && !guide.layer && <span className="hidden md:inline">{shiftFinger}</span>}
                  </span>
                )}
              </>
            )}
            {showHint && guide && !guide.key && (
              <span className="truncate text-text">
                <Kbd>{guide.keyLabel}</Kbd> is not on this layout
              </span>
            )}
          </div>
          {hintEnd && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{hintEnd}</div>}
        </div>
      )}

      <div className="tt-plate flex w-full flex-col">
        {/* ── hands slot: the 3D hands view mounts here ── */}
        {hasSlot && (
          <div data-slot="hands" data-testid="hands-slot" className={cx("w-full", !fill && "mb-3")}>
            {slot}
          </div>
        )}

        {show && (
          <div
            className={cx("tt-keys", reserve && "mb-3 grid w-full items-center", fill && hasSlot && "mt-2")}
            data-alone={hasSlot ? "false" : "true"}
            data-testid={reserve ? "keys-reserve" : undefined}
          >
            {reserve && <div aria-hidden className="tt-hands-box pointer-events-none invisible" style={{ ...reserve, gridArea: "1 / 1" }} />}
            <div style={reserve ? { gridArea: "1 / 1" } : undefined}>
              <Keyboard2D
                layout={layout}
                highlightKeyIds={highlight}
                pressedKeyIds={pressedKeyIds}
                errorKeyIds={errorKeyIds}
                dimUnused={dimKeyIds}
                layer={guide?.layer ?? null}
                fingerColors={colors}
                maxUnit={maxUnit}
              />
            </div>
          </div>
        )}
      </div>

      {footer && <div className="mt-2 flex min-h-7 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">{footer}</div>}
    </div>
  );
}

export default KeyboardGuide;
