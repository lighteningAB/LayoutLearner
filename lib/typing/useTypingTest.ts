"use client";
// Thin React wrapper around the pure engine. It attaches NO keyboard listeners: the page resolves
// key events to characters (through the active layout) and calls `handleInput`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendWords,
  applyInput,
  createTest,
  finish as finishTest,
  getCaret,
  getCorrection,
  getLiveStats,
  getNextChar,
  getResult,
  getWords,
  tick,
  type Caret,
  type LiveStats,
  type TestConfig,
  type TestInput,
  type TestResult,
  type TestState,
  type TestStatus,
  type WordView,
} from "./engine";

export interface UseTypingTestOptions {
  /** Words of the first test. Later tests: pass new words to `restart`. */
  words: readonly string[];
  config: TestConfig;
  /** Called once per finished test (not during render; safe to write to storage). */
  onFinish?: (result: TestResult, state: TestState) => void;
  /** Time mode: supplies more words when fewer than `refillBelow` remain. */
  moreWords?: (count: number) => string[];
  /** Default 40. */
  refillBelow?: number;
  /** Clock tick while running, clamped to 100-250 ms. Default 200. */
  tickMs?: number;
}

export interface UseTypingTest {
  state: TestState;
  status: TestStatus;
  words: WordView[];
  caret: Caret;
  /** Character to type next (" " = space), null when finished. */
  nextChar: string | null;
  live: LiveStats;
  /** The current word has a typo: `count` Backspaces fix it (see `getCorrection`). */
  correction: { needed: boolean; count: number };
  /** Set once the test is finished, else null. */
  result: TestResult | null;
  handleInput: (input: TestInput) => void;
  /** Start over. Without arguments: same words and config. */
  restart: (next?: { words?: readonly string[]; config?: TestConfig }) => void;
  /** End a running test now. */
  finish: () => void;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function useTypingTest(options: UseTypingTestOptions): UseTypingTest {
  const { onFinish, moreWords } = options;
  const [state, setState] = useState<TestState>(() => createTest(options.words, options.config));
  const initial = useRef({ words: options.words, config: options.config });
  const tickMs = Math.min(250, Math.max(100, options.tickMs ?? 200));
  const refillBelow = options.refillBelow ?? 40;

  const handleInput = useCallback((input: TestInput) => {
    const t = now();
    setState((s) => applyInput(s, input, t));
  }, []);

  const restart = useCallback((next?: { words?: readonly string[]; config?: TestConfig }) => {
    initial.current = {
      words: next?.words ?? initial.current.words,
      config: next?.config ?? initial.current.config,
    };
    setState(createTest(initial.current.words, initial.current.config));
  }, []);

  const finish = useCallback(() => {
    const t = now();
    setState((s) => finishTest(s, t));
  }, []);

  const status = state.status;

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      const t = now();
      setState((s) => tick(s, t));
    }, tickMs);
    return () => clearInterval(id);
  }, [status, tickMs]);

  const remainingWords = state.words.length - state.wordIndex;
  const isTime = state.config.mode === "time";
  useEffect(() => {
    if (!isTime || status === "finished" || !moreWords || remainingWords >= refillBelow) return;
    const extra = moreWords(Math.max(50, refillBelow));
    if (extra.length > 0) setState((s) => appendWords(s, extra));
  }, [isTime, status, moreWords, remainingWords, refillBelow]);

  const result = useMemo(() => getResult(state), [state]);

  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const reported = useRef<TestState | null>(null);
  useEffect(() => {
    if (!result || reported.current === state) return;
    reported.current = state;
    onFinishRef.current?.(result, state);
  }, [result, state]);

  const words = useMemo(() => getWords(state), [state]);
  const caret = useMemo(() => getCaret(state), [state]);
  const live = useMemo(() => getLiveStats(state), [state]);

  const correction = useMemo(() => getCorrection(state), [state]);

  return { state, status, words, caret, nextChar: getNextChar(state), live, correction, result, handleInput, restart, finish };
}
