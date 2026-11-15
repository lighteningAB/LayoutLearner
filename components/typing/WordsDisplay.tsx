"use client";
// The text being typed: three visible lines that scroll as the caret passes line two, per-letter
// colouring and a gliding caret. Purely presentational: feed it `useTypingTest()` output.
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Caret, TestStatus, WordView } from "@/lib/typing/engine";
import { useSettings } from "@/lib/settings";
import { cx } from "@/components/ui";
import "./typing.css";

export interface WordsDisplayProps {
  /** `useTypingTest().words` */
  words: readonly WordView[];
  /** `useTypingTest().caret` */
  caret: Caret;
  /** `useTypingTest().status`. The caret hides when finished. */
  status: TestStatus;
  /** Text size in px. Default: settings.fontSize. */
  fontSize?: number;
  /** Glide the caret between letters. Default: settings.smoothCaret. */
  smoothCaret?: boolean;
  /** Visible lines (default 3). The caret is kept on line two once the text is longer. */
  lines?: number;
  /** Override the window-focus detection that drives the "click or press any key" veil. */
  focused?: boolean;
  /** Text of the veil shown while unfocused. */
  focusHint?: string;
  className?: string;
  "aria-label"?: string;
}

/** Words rendered past the caret. Enough for several lines at any sane width / font size. */
const LOOKAHEAD = 90;

const WordItem = memo(
  function WordItem({ word }: { word: WordView }) {
    return (
      <div className="tt-word" data-testid="word" data-state={word.state} data-index={word.index}>
        {word.letters.map((l, i) => (
          <span key={i} className="tt-letter" data-testid="letter" data-state={l.state}>
            {l.char}
          </span>
        ))}
      </div>
    );
  },
  (a, b) => a.word.typed === b.word.typed && a.word.state === b.word.state && a.word.word === b.word.word && a.word.index === b.word.index,
);

/** True while the browser window has focus (true during SSR / first paint). */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    const sync = () => setFocused(document.hasFocus());
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    sync();
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    // Typing or clicking proves we have focus even if a focus event was missed.
    window.addEventListener("keydown", on, true);
    window.addEventListener("pointerdown", on, true);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
      window.removeEventListener("keydown", on, true);
      window.removeEventListener("pointerdown", on, true);
    };
  }, []);
  return focused;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function WordsDisplay({
  words,
  caret,
  status,
  fontSize,
  smoothCaret,
  lines = 3,
  focused,
  focusHint = "Click or press any key to focus",
  className,
  ...rest
}: WordsDisplayProps) {
  const [settings] = useSettings();
  const fs = fontSize ?? settings.fontSize;
  const smooth = smoothCaret ?? settings.smoothCaret;
  const windowFocused = useWindowFocused();
  const isFocused = focused ?? windowFocused;

  // Index of the first word kept in the DOM, and how many DOM lines sit above the visible box.
  const [first, setFirst] = useState(0);
  const [hidden, setHidden] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const snapNext = useRef(true);
  const blinkTimer = useRef<number | null>(null);
  const lastCaret = useRef("");
  const lastPos = useRef({ x: 0, y: 0 });
  /** Height removed above the caret by the latest trim, to re-base the caret before it glides on. */
  const trimmedPx = useRef(0);

  // Re-measure when the box resizes or the web font arrives.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let width = el.clientWidth;
    const bump = () => {
      snapNext.current = true;
      setLayoutTick((t) => t + 1);
    };
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (el.clientWidth !== width) {
              width = el.clientWidth;
              bump();
            }
          });
    ro?.observe(el);
    let alive = true;
    document.fonts?.ready.then(() => alive && bump());
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, []);

  useEffect(
    () => () => {
      if (blinkTimer.current != null) window.clearTimeout(blinkTimer.current);
    },
    [],
  );

  const wordIndex = caret.wordIndex;
  const letterIndex = caret.letterIndex;

  useLayoutEffect(() => {
    const inner = innerRef.current;
    const caretEl = caretRef.current;
    if (!inner || !caretEl) return;

    // Restarted, or stepped back into a word we already dropped: rebuild from further up.
    if (wordIndex < first) {
      snapNext.current = true;
      setFirst(Math.max(0, wordIndex - 30));
      setHidden(0);
      return;
    }
    const wordEl = inner.children[wordIndex - first] as HTMLElement | undefined;
    if (!wordEl || wordEl === caretEl) return;

    const innerRect = inner.getBoundingClientRect();
    const wr = wordEl.getBoundingClientRect();
    const lh = wr.height || 1;
    const top = wr.top - innerRect.top;
    const line = Math.round(top / lh);
    const visual = line - hidden;

    // Keep the caret on line two (index 1) once the text is longer, with one line of typed text
    // kept above the box. Lines further up leave the DOM, so a long test stays light.
    const maxVisual = lines >= 3 ? 1 : 0;
    if (visual > maxVisual || visual < 0) {
      const target = Math.max(0, visual < 0 ? line : line - maxVisual);
      const shift = target - hidden; // lines the text moves up
      const animate = !snapNext.current && lastCaret.current !== "" && !(wordIndex === 0 && letterIndex === 0);
      let nextHidden = target;
      if (target > 1) {
        const cut = (target - 1) * lh - 1;
        let i = 0;
        while (i < wordIndex - first && (inner.children[i] as HTMLElement).getBoundingClientRect().top - innerRect.top < cut) i++;
        if (i > 0) {
          trimmedPx.current += (target - 1) * lh; // the caret's own coordinates jump with the trim
          setFirst(first + i);
          nextHidden = 1;
        }
      }
      setHidden(nextHidden);
      const slide = slideRef.current;
      if (slide && animate && shift !== 0 && typeof slide.animate === "function" && !prefersReducedMotion()) {
        slide.animate([{ transform: `translateY(${shift * lh}px)` }, { transform: "translateY(0)" }], {
          duration: 200,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
      }
      return; // state changed: this effect runs again with the new layout
    }

    const letters = wordEl.children;
    let x: number;
    if (letterIndex < letters.length) x = (letters[letterIndex] as HTMLElement).getBoundingClientRect().left - innerRect.left;
    else if (letters.length > 0) x = (letters[letters.length - 1] as HTMLElement).getBoundingClientRect().right - innerRect.left;
    else x = wr.left - innerRect.left;

    const key = `${Math.round(x * 100) / 100},${Math.round(top * 100) / 100}`;
    const atStart = wordIndex === 0 && letterIndex === 0;
    const moved = key !== lastCaret.current;
    const snap = snapNext.current || atStart || lastCaret.current === "";
    if (trimmedPx.current !== 0 && !snap) {
      // Same spot on screen, new coordinates: jump there silently, then glide to the real target.
      caretEl.style.transition = "none";
      caretEl.style.transform = `translate3d(${lastPos.current.x}px, ${lastPos.current.y - trimmedPx.current}px, 0)`;
      void caretEl.offsetWidth;
      caretEl.style.transition = "";
    }
    trimmedPx.current = 0;
    if (moved) {
      const px = Math.round(x * 100) / 100;
      const py = Math.round(top * 100) / 100;
      if (snap) caretEl.style.transition = "none";
      caretEl.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      if (snap) {
        void caretEl.offsetWidth; // commit the jump before transitions come back
        caretEl.style.transition = "";
      }
      lastCaret.current = key;
      lastPos.current = { x: px, y: py };
    }
    snapNext.current = false;
  }, [wordIndex, letterIndex, first, hidden, layoutTick, fs, lines, words]);

  // Blink only while idle: every keystroke restarts a short quiet period.
  useLayoutEffect(() => {
    const caretEl = caretRef.current;
    if (!caretEl) return;
    if (blinkTimer.current != null) window.clearTimeout(blinkTimer.current);
    if (status !== "running") {
      caretEl.dataset.blink = "true";
      return;
    }
    caretEl.dataset.blink = "false";
    blinkTimer.current = window.setTimeout(() => {
      caretEl.dataset.blink = "true";
    }, 900);
  }, [wordIndex, letterIndex, status]);

  const end = Math.min(words.length, Math.max(wordIndex + LOOKAHEAD, first + LOOKAHEAD));
  const visible = words.slice(first, end);

  const style = { "--tt-fs": `${fs}px`, "--tt-lines": lines } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={cx("tt-words", className)}
      style={style}
      data-testid="words"
      data-status={status}
      data-focused={isFocused ? "true" : "false"}
      data-first-word={first}
      data-hidden-lines={hidden}
      role="textbox"
      aria-readonly="true"
      aria-label={rest["aria-label"] ?? "Text to type"}
    >
      <div ref={slideRef} className="tt-slide">
        <div ref={innerRef} className="tt-inner" style={{ "--tt-hidden": hidden } as CSSProperties}>
          {visible.map((w) => (
            <WordItem key={w.index} word={w} />
          ))}
          <div
            ref={caretRef}
            className="tt-caret"
            data-testid="caret"
            data-smooth={smooth ? "true" : "false"}
            data-hidden={status === "finished" || words.length === 0 ? "true" : "false"}
            aria-hidden
          />
        </div>
      </div>
      <div className="tt-focus-hint" data-testid="focus-hint" aria-hidden={isFocused}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
        {focusHint}
      </div>
    </div>
  );
}

export default WordsDisplay;
