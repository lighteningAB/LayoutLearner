"use client";
// One window-level keyboard listener that turns browser key events into typing-engine inputs
// through the active layout. Shared by the typing test and the lessons.
//
//   const kb = useKeyboardInput({ layout, emulate, expectedChar: test.nextChar, onInput: test.handleInput,
//                                 onAction: (a) => (a === "escape" ? (reset(), true) : false) });
//   <KeyboardGuide pressedKeyIds={kb.pressedKeyIds} errorKeyIds={kb.errorKeyIds} … />
import { useCallback, useEffect, useRef, useState } from "react";
import type { ParsedLayout } from "@/lib/types";
import { resolveKeystroke } from "@/lib/layout/keys";
import type { TestInput } from "./engine";

export type KeyboardAction = "enter" | "tab" | "escape";

export interface KeyboardActionEvent {
  shiftKey: boolean;
  /** Element that had focus when the key went down. */
  target: HTMLElement | null;
  /** True when focus is on a button, link or other control that the key would natively operate. */
  onControl: boolean;
}

export interface UseKeyboardInputOptions {
  layout: ParsedLayout;
  /** true: the OS is on QWERTY, translate by physical position. false: trust the OS layout. */
  emulate: boolean;
  /** Set false to detach entirely (e.g. while results are shown and you handle keys yourself). Default true. */
  enabled?: boolean;
  /** Characters and backspaces, ready for `useTypingTest().handleInput`. */
  onInput: (input: TestInput) => void;
  /**
   * Enter / Tab / Escape without Ctrl/Meta/Alt. Return true when you handled the key: the event is
   * then preventDefault()-ed (so e.g. Escape does not open the command palette). Otherwise the
   * browser default runs.
   */
  onAction?: (action: KeyboardAction, ev: KeyboardActionEvent) => boolean | void;
  /**
   * The character the engine expects next (`useTypingTest().nextChar`). When given, a different
   * character triggers the error flash (`errorKeyIds`) and `onWrongKey`.
   */
  expectedChar?: string | null;
  onWrongKey?: (keyId: string | null, char: string) => void;
  /** How long a wrong key stays in `errorKeyIds`. Default 260 ms. */
  errorFlashMs?: number;
}

export interface UseKeyboardInput {
  /** LayoutKey ids currently held down (includes Shift etc.). Stable array between changes. */
  pressedKeyIds: string[];
  /** The key that was just pressed by mistake (empty again after `errorFlashMs`). Stable array. */
  errorKeyIds: string[];
  /** Same as errorKeyIds[0] ?? null. */
  lastWrongKeyId: string | null;
  /** Caps Lock state as of the latest key event. Only matters when `emulate` is false. */
  capsLock: boolean;
  /** Forget held keys (call when you swap views). */
  clearPressed: () => void;
}

const EMPTY: string[] = [];

/** Focus is somewhere that wants the keystrokes for itself. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function isControl(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest('button, a[href], summary, [role="button"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]');
}

/** A modal, the command palette, a menu or a listbox is open: keys belong to it. */
function overlayOpen(): boolean {
  return !!document.querySelector('[data-ll-modal], [role="dialog"], [role="menu"], [role="listbox"]');
}

export function useKeyboardInput(options: UseKeyboardInputOptions): UseKeyboardInput {
  const { enabled = true } = options;
  const opts = useRef(options);
  opts.current = options;

  const [pressedKeyIds, setPressed] = useState<string[]>(EMPTY);
  const [errorKeyIds, setError] = useState<string[]>(EMPTY);
  const [capsLock, setCapsLock] = useState(false);
  // ev.code -> key id, so keyup releases the same key even if Shift changed in between.
  const held = useRef(new Map<string, string>());
  const errorTimer = useRef<number | null>(null);

  const syncPressed = useCallback(() => {
    const ids = Array.from(new Set(held.current.values()));
    setPressed((prev) => (prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids.length ? ids : EMPTY));
  }, []);

  const clearPressed = useCallback(() => {
    held.current.clear();
    setPressed(EMPTY);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const flashError = (keyId: string | null, char: string) => {
      const o = opts.current;
      o.onWrongKey?.(keyId, char);
      if (errorTimer.current != null) window.clearTimeout(errorTimer.current);
      setError(keyId ? [keyId] : EMPTY);
      errorTimer.current = window.setTimeout(() => {
        errorTimer.current = null;
        setError(EMPTY);
      }, o.errorFlashMs ?? 260);
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      const o = opts.current;
      if (typeof ev.getModifierState === "function") {
        const caps = ev.getModifierState("CapsLock");
        setCapsLock((prev) => (prev === caps ? prev : caps));
      }
      if (ev.defaultPrevented || isEditable(ev.target) || overlayOpen()) return;

      const altGraph = typeof ev.getModifierState === "function" && ev.getModifierState("AltGraph");
      const chord = ev.metaKey || ((ev.ctrlKey || ev.altKey) && !(altGraph && !o.emulate));

      // Ctrl/Alt+Backspace deletes the word; every other chord belongs to the browser / app shortcuts.
      if (chord) {
        if (ev.key === "Backspace" && !ev.metaKey && (ev.ctrlKey || ev.altKey)) {
          ev.preventDefault();
          o.onInput({ type: "backspace", word: true });
        }
        return;
      }

      // IME composition and dead keys never produce a usable character when the OS layout is trusted.
      // With emulation the physical position (ev.code) is all we need, so they still work.
      const composing = ev.isComposing || ev.key === "Dead" || ev.key === "Process" || ev.key === "Unidentified" || ev.keyCode === 229;
      if (composing && (!o.emulate || !ev.code)) return;

      const r = resolveKeystroke(o.layout, ev, { emulate: o.emulate });

      if (r.keyId && ev.code && !ev.repeat) {
        held.current.set(ev.code, r.keyId);
        syncPressed();
      }

      if (r.action === "backspace") {
        ev.preventDefault();
        o.onInput({ type: "backspace" });
        return;
      }

      const target = ev.target instanceof HTMLElement ? ev.target : null;
      const onControl = isControl(target);

      if (r.action === "enter" || r.action === "tab" || r.action === "escape") {
        if (o.onAction?.(r.action, { shiftKey: ev.shiftKey, target, onControl })) ev.preventDefault();
        return;
      }

      if (r.char == null) return; // modifiers, arrows, F-keys: leave them alone

      // Space / letters on a focused button: space would "click" it. Letters take focus back to the
      // text; a space right after belongs to the test, not to the button.
      if (onControl && target) {
        if (r.char === " ") return;
        target.blur();
      }

      // Space scrolls, ' and / open quick-find in Firefox, etc.
      ev.preventDefault();
      if (ev.repeat) return; // a held key is not typing

      if (o.expectedChar != null && r.char !== o.expectedChar) flashError(r.keyId, r.char);
      o.onInput({ type: "char", char: r.char, keyId: r.keyId });
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      if (typeof ev.getModifierState === "function") {
        const caps = ev.getModifierState("CapsLock");
        setCapsLock((prev) => (prev === caps ? prev : caps));
      }
      // macOS swallows keyup for keys released while Cmd is held: drop everything when Cmd goes up.
      if (ev.key === "Meta") held.current.clear();
      else held.current.delete(ev.code);
      syncPressed();
    };

    const reset = () => {
      held.current.clear();
      setPressed(EMPTY);
    };
    const onVisibility = () => {
      if (document.hidden) reset();
    };

    // Capture phase: we must see Escape before the shell's palette shortcut decides what to do.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", onVisibility);
      held.current.clear();
      if (errorTimer.current != null) window.clearTimeout(errorTimer.current);
      errorTimer.current = null;
      setPressed(EMPTY);
      setError(EMPTY);
    };
  }, [enabled, syncPressed]);

  return { pressedKeyIds, errorKeyIds, lastWrongKeyId: errorKeyIds[0] ?? null, capsLock, clearPressed };
}
