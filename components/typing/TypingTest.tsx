"use client";
// The typing test (route "/"): config bar, live counters, words, keyboard guide, results.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, Kbd, SegmentedControl, Tooltip, cx, type IconName } from "@/components/ui";
import { useRegisterCommands, type Command } from "@/components/shell";
import { TIME_AMOUNTS, WORD_AMOUNTS, WORD_LISTS, useSettings } from "@/lib/settings";
import { typableChars } from "@/lib/layout/keys";
import { useActiveLayout } from "@/lib/layout/useActiveLayout";
import type { TestConfig, TestInput } from "@/lib/typing/engine";
import { useTypingTest } from "@/lib/typing/useTypingTest";
import { useKeyboardInput, type KeyboardAction, type KeyboardActionEvent } from "@/lib/typing/useKeyboardInput";
import { playErrorSound } from "@/lib/typing/sound";
import { createWordStream, generateText, type GenerateConfig, type WordListName, type WordStream } from "@/lib/typing/words";
import { GuideViewSwitch, HandsPanel, useGuidePress, useGuideView } from "./HandsPanel";
import { EmulationHint, useEmulationHint } from "./EmulationHint";
import { KeyboardGuide } from "./KeyboardGuide";
import { ResultsView } from "./ResultsView";
import { WordsDisplay } from "./WordsDisplay";
import { generatePracticeWords } from "./practice";
import "./typing.css";

const NO_WORDS: string[] = [];
const PRACTICE_WORDS = 30;
const DEFAULT_AMOUNT = { time: 30, words: 25 } as const;
const LIST_LABEL: Record<WordListName, string> = { english200: "english", english1k: "english 1k", code: "code" };
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

/** A drill built from the keys missed in the test that just finished (never stored). */
interface Practice {
  chars: string[];
}

interface Plan {
  key: string;
  words: string[];
  config: TestConfig;
  /** Generator config for the endless stream (time mode only). */
  stream: GenerateConfig | null;
}

function ConfigToggle({
  active,
  disabled,
  icon,
  label,
  title,
  onClick,
  testId,
}: {
  active: boolean;
  disabled?: boolean;
  icon: IconName;
  label: string;
  title?: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      data-state={active ? "on" : "off"}
      data-testid={testId}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-ui-sm px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-35",
        active ? "text-main" : "text-sub hover:text-text",
      )}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-1.5 hidden h-4 w-px shrink-0 bg-border sm:block" />;

export function TypingTest() {
  const [settings, update] = useSettings();
  const active = useActiveLayout();
  const layout = active.layout;

  const allowed = useMemo(() => typableChars(layout), [layout]);
  const canNumbers = useMemo(() => "0123456789".split("").every((d) => allowed.includes(d)), [allowed]);
  const canPunctuation = useMemo(() => allowed.includes(".") && allowed.includes(","), [allowed]);

  const mode = settings.testMode;
  const amounts: readonly number[] = mode === "time" ? TIME_AMOUNTS : WORD_AMOUNTS;
  const amount = amounts.includes(settings.testAmount) ? settings.testAmount : DEFAULT_AMOUNT[mode];
  const wordList: WordListName = settings.wordList === "english1k" || settings.wordList === "code" ? settings.wordList : "english200";
  const punctuation = settings.punctuation && canPunctuation && wordList !== "code";
  const numbers = settings.numbers && canNumbers;

  // null until we are on the client: random text must never be part of the server render.
  const [seed, setSeed] = useState<number | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);

  const plan = useMemo<Plan | null>(() => {
    if (seed == null) return null;
    if (practice) {
      const words = generatePracticeWords({
        chars: practice.chars,
        count: PRACTICE_WORDS,
        allowedChars: allowed,
        seed,
      });
      return { key: `practice:${practice.chars.join("")}:${seed}`, words, config: { mode: "words" }, stream: null };
    }
    const cfg: GenerateConfig = { wordList, punctuation, numbers, allowedChars: allowed, seed };
    if (mode === "time") {
      return { key: `time:${amount}:${seed}`, words: generateText({ mode: "time", seconds: amount }, cfg), config: { mode: "time", seconds: amount }, stream: cfg };
    }
    return { key: `words:${amount}:${seed}`, words: generateText({ mode: "words", count: amount }, cfg), config: { mode: "words" }, stream: null };
  }, [seed, practice, mode, amount, wordList, punctuation, numbers, allowed]);

  const streamRef = useRef<WordStream | null>(null);
  const moreWords = useCallback((count: number) => streamRef.current?.next(count) ?? [], []);

  // Results live only on screen: nothing about a finished test is stored.
  const test = useTypingTest({ words: NO_WORDS, config: { mode: "words" }, moreWords });
  const { restart, status } = test;

  /** (Re)start the given plan from its first word, including the endless stream behind time mode. */
  const arm = useCallback(
    (p: Plan) => {
      if (p.stream) {
        const stream = createWordStream(p.stream);
        stream.next(p.words.length); // the stream starts with the words generateText returned
        streamRef.current = stream;
      } else {
        streamRef.current = null;
      }
      restart({ words: p.words, config: p.config });
    },
    [restart],
  );

  useEffect(() => {
    if (plan) arm(plan);
  }, [plan, arm]);

  const newTest = useCallback(() => setSeed(newSeed()), []);
  const repeatTest = useCallback(() => {
    if (plan) arm(plan);
  }, [plan, arm]);

  const startPractice = useCallback((chars: string[]) => {
    setPractice({ chars });
    setSeed(newSeed());
  }, []);
  const exitPractice = useCallback(() => {
    setPractice(null);
    setSeed(newSeed());
  }, []);

  // First client render: pick the text.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const params = new URLSearchParams(window.location.search);
    // ?seed=<n> pins the first text (handy for automated checks and for sharing a text).
    const fixed = params.has("seed") ? Number(params.get("seed")) : NaN;
    setSeed(Number.isFinite(fixed) ? Math.abs(Math.floor(fixed)) : newSeed());
  }, []);

  // Focus mode: the shell dims itself through <html data-typing>.
  useEffect(() => {
    const el = document.documentElement;
    if (status === "running") el.dataset.typing = "true";
    else delete el.dataset.typing;
    return () => {
      delete el.dataset.typing;
    };
  }, [status]);

  const restartRef = useRef<HTMLButtonElement>(null);
  const onAction = useCallback(
    (action: KeyboardAction, ev: KeyboardActionEvent) => {
      if (action === "tab") {
        // Tab jumps to the restart button, so Tab then Enter restarts from anywhere.
        if (ev.shiftKey || ev.target === restartRef.current) return false;
        restartRef.current?.focus();
        return true;
      }
      if (action === "escape" && status === "running") {
        newTest();
        return true;
      }
      return false;
    },
    [status, newTest],
  );

  // 3D guide hands: every character keystroke taps its key (same render as the engine update).
  const guideView = useGuideView();
  const [press, notePress] = useGuidePress();
  const expectedRef = useRef(test.nextChar);
  expectedRef.current = test.nextChar;
  const handleInput = test.handleInput;
  const onInput = useCallback(
    (input: TestInput) => {
      if (input.type === "char") notePress(input.keyId, input.char === expectedRef.current);
      else if (input.keyId) notePress(input.keyId, true); // Backspace is never a mistake
      handleInput(input);
    },
    [handleInput, notePress],
  );

  // The current word has a typo: point at Backspace until the typed part is a correct prefix again.
  const nextAction = plan && status === "running" && test.correction.needed ? ("backspace" as const) : null;
  const emulationHint = useEmulationHint({ layout, emulate: settings.emulateLayout });
  const kb = useKeyboardInput({
    layout,
    emulate: settings.emulateLayout,
    onKeystroke: emulationHint.note,
    enabled: plan != null && status !== "finished",
    expectedChar: test.nextChar,
    onInput,
    onAction,
    onWrongKey: settings.soundOnError ? () => playErrorSound() : undefined,
  });

  // ── command palette ──
  const commands = useMemo<Command[]>(() => {
    const onOff = (v: boolean) => (v ? "on" : "off");
    const list: Command[] = [
      { id: "test-restart", group: "Test", label: "Restart test", icon: "restart", keywords: "new words again reset", hint: "tab → enter", run: newTest },
      {
        id: "test-mode-time",
        group: "Test",
        label: "Mode: time",
        icon: "clock",
        keywords: "test mode timed seconds",
        hint: mode === "time" ? "current" : undefined,
        run: () => update({ testMode: "time", testAmount: DEFAULT_AMOUNT.time }),
      },
      {
        id: "test-mode-words",
        group: "Test",
        label: "Mode: words",
        icon: "type",
        keywords: "test mode word count",
        hint: mode === "words" ? "current" : undefined,
        run: () => update({ testMode: "words", testAmount: DEFAULT_AMOUNT.words }),
      },
      ...TIME_AMOUNTS.map(
        (n): Command => ({
          id: `test-time-${n}`,
          group: "Test",
          label: `Time: ${n} seconds`,
          icon: "clock",
          keywords: `duration length ${n}s`,
          hint: mode === "time" && amount === n ? "current" : undefined,
          run: () => update({ testMode: "time", testAmount: n }),
        }),
      ),
      ...WORD_AMOUNTS.map(
        (n): Command => ({
          id: `test-words-${n}`,
          group: "Test",
          label: `Words: ${n}`,
          icon: "type",
          keywords: `length count ${n} words`,
          hint: mode === "words" && amount === n ? "current" : undefined,
          run: () => update({ testMode: "words", testAmount: n }),
        }),
      ),
      ...WORD_LISTS.map(
        (l): Command => ({
          id: `test-list-${l.id}`,
          group: "Test",
          label: `Word list: ${l.name}`,
          icon: "book",
          keywords: "words language source",
          hint: wordList === l.id ? "current" : undefined,
          run: () => update({ wordList: l.id }),
        }),
      ),
      {
        id: "test-toggle-punctuation",
        group: "Test",
        label: "Toggle punctuation",
        icon: "at",
        keywords: "capitals commas periods symbols",
        hint: onOff(punctuation),
        keepOpen: true,
        run: () => update((s) => ({ punctuation: !s.punctuation })),
      },
      {
        id: "test-toggle-numbers",
        group: "Test",
        label: "Toggle numbers",
        icon: "hash",
        keywords: "digits",
        hint: canNumbers ? onOff(numbers) : "not on this layout",
        keepOpen: true,
        run: () => update((s) => ({ numbers: !s.numbers })),
      },
      {
        id: "test-toggle-keyboard",
        group: "Test",
        label: "Toggle keyboard guide",
        icon: "keyboard",
        keywords: "show hide 2d keys finger hint",
        hint: onOff(settings.showKeyboard),
        keepOpen: true,
        run: () => update((s) => ({ showKeyboard: !s.showKeyboard })),
      },
      {
        id: "test-toggle-emulation",
        group: "Test",
        label: "Toggle layout emulation",
        icon: "layers",
        keywords: "emulate remap os qwerty system layout",
        hint: onOff(settings.emulateLayout),
        keepOpen: true,
        run: () => update((s) => ({ emulateLayout: !s.emulateLayout })),
      },
    ];
    // The weak-keys drill starts from a results screen; while it runs, offer the way out.
    if (practice) {
      list.push({
        id: "test-practice-stop",
        group: "Test",
        label: "Stop practising weak keys",
        icon: "target",
        keywords: "drill exit normal test",
        run: exitPractice,
      });
    }
    return list;
  }, [newTest, update, mode, amount, wordList, punctuation, numbers, canNumbers, settings.showKeyboard, settings.emulateLayout, practice, exitPractice]);
  useRegisterCommands(commands);

  // ── derived display values ──
  const total = test.state.words.length;
  const isTime = test.state.config.mode === "time";
  const counter = isTime
    ? String(Math.ceil((test.live.remainingMs ?? amount * 1000) / 1000))
    : `${Math.min(test.state.wordIndex, total)}/${total}`;
  const showCaps = kb.capsLock && !settings.emulateLayout && status !== "finished";

  // Spacing around the guide: the same with the hands and with their reserved box, so switching views does not move the text.
  const tight = guideView.showHands || !!guideView.reserveBox;

  const testLabel = practice ? "weak keys" : `${mode} ${amount}`;
  const testDetail = practice
    ? practice.chars.join(" ")
    : [LIST_LABEL[wordList], punctuation ? "punctuation" : "", numbers ? "numbers" : ""].filter(Boolean).join(" · ");

  let bar: ReactNode;
  if (practice) {
    bar = (
      <div
        className="tt-fade mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-ui bg-bg-alt py-1.5 pr-1.5 pl-3.5 text-[13px] text-sub"
        data-testid="practice-badge"
        data-chars={practice.chars.join("")}
      >
        <span className="inline-flex items-center gap-2 font-medium text-main">
          <Icon name="target" size={14} />
          Drilling the keys you missed
        </span>
        <span className="inline-flex flex-wrap items-center gap-1">
          {practice.chars.map((c) => (
            <Kbd key={c}>{c}</Kbd>
          ))}
        </span>
        <button
          type="button"
          onClick={exitPractice}
          data-testid="practice-dismiss"
          aria-label="Stop drilling and go back to the normal test"
          title="Back to the normal test"
          className="inline-flex size-7 items-center justify-center rounded-ui-sm text-sub transition-colors duration-150 hover:bg-text/[0.07] hover:text-text"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    );
  } else {
    bar = (
      <div
        className="tt-fade mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-y-0.5 rounded-ui bg-bg-alt px-2 py-1.5"
        data-testid="config-bar"
        role="group"
        aria-label="Test settings"
      >
        <ConfigToggle
          testId="config-punctuation"
          icon="at"
          label="punctuation"
          active={punctuation}
          disabled={!canPunctuation || wordList === "code"}
          title={wordList === "code" ? "The code list brings its own symbols" : !canPunctuation ? "This layout has no . and , keys" : undefined}
          onClick={() => update({ punctuation: !settings.punctuation })}
        />
        <ConfigToggle
          testId="config-numbers"
          icon="hash"
          label="numbers"
          active={numbers}
          disabled={!canNumbers}
          title={!canNumbers ? `${active.name} has no number keys` : undefined}
          onClick={() => update({ numbers: !settings.numbers })}
        />
        <Divider />
        <SegmentedControl
          variant="inline"
          size="sm"
          aria-label="Mode"
          data-testid="config-mode"
          value={mode}
          onChange={(m) => m !== mode && update({ testMode: m, testAmount: DEFAULT_AMOUNT[m] })}
          options={[
            { value: "time", label: "time", icon: "clock" },
            { value: "words", label: "words", icon: "type" },
          ]}
        />
        <Divider />
        <SegmentedControl
          variant="inline"
          size="sm"
          aria-label={mode === "time" ? "Seconds" : "Words"}
          data-testid="config-amount"
          className="font-mono"
          value={amount}
          onChange={(n) => update({ testAmount: n })}
          options={amounts}
        />
        <Divider />
        <SegmentedControl
          variant="inline"
          size="sm"
          aria-label="Word list"
          data-testid="config-wordlist"
          value={wordList}
          onChange={(l) => update({ wordList: l })}
          options={(Object.keys(LIST_LABEL) as WordListName[]).map((id) => ({ value: id, label: LIST_LABEL[id] }))}
        />
      </div>
    );
  }

  const emulationToggle = (
    <Tooltip
      side="top"
      align="end"
      className="min-w-0"
      content={
        <span className="block w-60 text-left leading-snug font-normal whitespace-normal">
          {settings.emulateLayout
            ? `Your keys are remapped to ${active.name} by position, so you can practise without changing the system layout. Turn this off if your OS is already set to ${active.name}.`
            : `Using the characters your system sends. If your OS is still on QWERTY, turn emulation on to practise ${active.name} without changing system settings.`}
        </span>
      }
    >
      <button
        type="button"
        aria-pressed={settings.emulateLayout}
        data-testid="emulation-toggle"
        data-state={settings.emulateLayout ? "on" : "off"}
        onClick={(e) => {
          update({ emulateLayout: !settings.emulateLayout });
          e.currentTarget.blur();
        }}
        className="tt-fade inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs whitespace-nowrap text-sub transition-colors duration-150 hover:bg-text/[0.06] hover:text-text"
      >
        <Icon name="layers" size={13} className={cx("shrink-0", settings.emulateLayout && "text-main")} />
        {settings.emulateLayout ? (
          <span className="truncate">
            emulating {active.name}
            {/* the view switch shares this line: keep the label short when it is shown */}
            <span className={guideView.handsSupported ? "hidden" : "hidden md:inline"}> on a QWERTY OS</span>
          </span>
        ) : (
          <span>using OS layout</span>
        )}
      </button>
    </Tooltip>
  );

  return (
    <div className="flex min-h-[calc(100dvh-15.5rem)] flex-col" data-testid="typing-test" data-status={status} data-layout={active.id}>
      <h1 className="sr-only">Typing test</h1>
      <EmulationHint hint={emulationHint} layoutName={active.name} />
      <span className="sr-only" data-testid="test-status" aria-live="polite">
        {status}
      </span>

      {status === "finished" && test.result ? (
        <div className="flex flex-1 flex-col justify-center py-2 sm:py-6">
          <ResultsView
            result={test.result}
            layout={layout}
            layoutName={active.name}
            testLabel={testLabel}
            testDetail={testDetail}
            onNext={newTest}
            onRepeat={repeatTest}
            onPracticeKeys={startPractice}
          />
        </div>
      ) : (
        <>
          {bar}
          <div className={cx("flex flex-1 flex-col justify-center pb-2", tight ? "pt-6 sm:pt-7" : "pt-8 sm:pt-10")}>
            <div className="mb-2 flex h-9 items-end justify-between gap-4">
              <div className="flex items-baseline gap-5 font-mono tabular-nums">
                <span className="text-2xl leading-none font-medium text-main" data-testid="counter" aria-label={isTime ? "Seconds left" : "Words done"}>
                  {plan ? counter : ""}
                </span>
                <span className="tt-live text-sm text-sub">
                  <span className="text-base text-text" data-testid="live-wpm">
                    {Math.round(test.live.wpm)}
                  </span>{" "}
                  wpm
                </span>
                <span className="tt-live text-sm text-sub">
                  <span className="text-base text-text" data-testid="live-acc">
                    {Math.floor(test.live.accuracy)}%
                  </span>{" "}
                  acc
                </span>
              </div>
              {showCaps && (
                <span
                  role="alert"
                  data-testid="caps-warning"
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-error/[0.14] px-3 text-xs font-medium text-error"
                >
                  <Icon name="alert" size={13} />
                  Caps Lock is on
                </span>
              )}
            </div>

            <WordsDisplay words={test.words} caret={test.caret} status={status} />

            <div className="mt-5 flex justify-center">
              <button
                ref={restartRef}
                type="button"
                data-testid="restart"
                aria-label="Restart test with new words"
                title="Restart (tab, then enter)"
                onClick={(e) => {
                  newTest();
                  e.currentTarget.blur();
                }}
                className="inline-flex h-9 w-14 items-center justify-center rounded-ui text-sub transition-colors duration-150 hover:text-text focus-visible:bg-text/[0.07] focus-visible:text-text"
              >
                <Icon name="restart" size={18} />
              </button>
            </div>

            <KeyboardGuide
              className={tight ? "mt-4 sm:mt-5" : "mt-6 sm:mt-8"}
              layout={layout}
              nextChar={plan ? test.nextChar : null}
              nextAction={nextAction}
              actionCount={test.correction.count}
              pressedKeyIds={kb.pressedKeyIds}
              errorKeyIds={kb.errorKeyIds}
              showKeyboard={guideView.showKeyboard}
              maxUnit={guideView.keyboardUnit}
              reserveBox={guideView.reserveBox}
              hintEnd={
                <>
                  <GuideViewSwitch className="tt-fade" />
                  {emulationToggle}
                </>
              }
              handsSlot={
                guideView.showHands ? (
                  <HandsPanel layout={layout} nextChar={plan ? test.nextChar : null} nextAction={nextAction} press={press} compact={guideView.showKeyboard} />
                ) : null
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

export default TypingTest;
