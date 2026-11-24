"use client";
// The typing test (route "/"), composed as a drawing sheet: settings line, the text, the plate
// (3D hands and / or 2D board) at the centre, notes in the left margin, timer, next-key detail,
// live readouts and a title block in the right margin; then the results sheet.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Icon, Kbd, SegmentedControl, Tooltip, cx, type IconName } from "@/components/ui";
import { useRegisterCommands, type Command } from "@/components/shell";
import { TIME_AMOUNTS, WORD_AMOUNTS, WORD_LISTS, useSettings } from "@/lib/settings";
import { typableChars } from "@/lib/layout/keys";
import { useActiveLayout } from "@/lib/layout/useActiveLayout";
import type { TestConfig, TestInput } from "@/lib/typing/engine";
import { useTypingTest } from "@/lib/typing/useTypingTest";
import { useKeyboardInput, type KeyboardAction, type KeyboardActionEvent } from "@/lib/typing/useKeyboardInput";
import { playErrorSound } from "@/lib/typing/sound";
import { createWordStream, generateText, type GenerateConfig, type WordListName, type WordStream } from "@/lib/typing/words";
import { useLearnPrefs } from "@/components/learn/prefs";
import { GuideViewSwitch, HandsPanel, useGuidePress, useGuideView } from "./HandsPanel";
import { EmulationHint, useEmulationHint } from "./EmulationHint";
import { MobileNotice, WelcomeHint } from "./Hints";
import { KeyboardGuide, NextKeyDetail } from "./KeyboardGuide";
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
        "inline-flex h-7 items-center gap-1.5 px-2.5 text-[14px] font-medium whitespace-nowrap underline-offset-[7px] transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:line-through disabled:decoration-1",
        active ? "text-main underline decoration-2" : "text-sub hover:text-text",
      )}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

const Divider = () => <span aria-hidden className="mx-2 hidden h-4 w-px shrink-0 bg-border sm:block" />;

/** 15 -> "15", 14.25 -> "14.25": board sizes in key units without trailing zeros. */
const LEGEND_ROWS = ["pinky", "ring", "middle", "index", "thumb"] as const;

/** Which colour is which finger: every swatch is named, the colour only repeats it. */
function FingerLegend() {
  return (
    <section className="tt-legend" aria-labelledby="tt-legend-heading" data-testid="finger-legend">
      <h2 id="tt-legend-heading" className="ll-lettering-sm text-text">
        Finger colours
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-x-3 text-[13px] leading-none text-sub">
        {(["Left", "Right"] as const).map((hand, h) => (
          <dl key={hand}>
            <dt className="ll-lettering-sm mb-1.5 border-b border-hairline pb-1.5 text-sub">{hand}</dt>
            {LEGEND_ROWS.map((name, i) => (
              <dd key={name} className="flex items-center gap-2 py-[3px]">
                {/* --finger-0…4 run left pinky to thumb, 5…9 right thumb to pinky */}
                <span aria-hidden className="size-2.5 shrink-0 border border-line" style={{ backgroundColor: `var(--finger-${h === 0 ? i : 9 - i})` }} />
                {name}
              </dd>
            ))}
          </dl>
        ))}
      </div>
    </section>
  );
}

const trimUnits = (n: number) => String(Math.round(n * 100) / 100);

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
  const [{ camera }] = useLearnPrefs();
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

  const testLabel = practice ? "weak keys" : `${mode} ${amount}`;
  const testDetail = practice
    ? practice.chars.join(" ")
    : [LIST_LABEL[wordList], punctuation ? "punctuation" : "", numbers ? "numbers" : ""].filter(Boolean).join(" · ");

  let bar: ReactNode;
  if (emulationHint.visible) {
    // The nudge takes the settings line's place (which is hidden while typing anyway): nothing is covered, nothing moves.
    bar = <EmulationHint hint={emulationHint} layoutName={active.name} inline />;
  } else if (practice) {
    bar = (
      <div className="tt-fade flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px] text-sub" data-testid="practice-badge" data-chars={practice.chars.join("")}>
        <span className="ll-lettering inline-flex items-center gap-2 text-text">
          <Icon name="target" size={15} className="text-main" />
          Drilling the keys you missed
        </span>
        <span className="inline-flex flex-wrap items-center gap-1">
          {practice.chars.map((c) => (
            <Kbd key={c}>{c}</Kbd>
          ))}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon="x"
          onClick={exitPractice}
          data-testid="practice-dismiss"
          aria-label="Stop drilling and go back to the normal test"
          title="Back to the normal test"
          className="ml-auto"
        >
          Normal test
        </Button>
      </div>
    );
  } else {
    bar = (
      <div className="tt-fade flex min-h-9 flex-wrap items-center gap-y-0.5 max-md:justify-center" data-testid="config-bar" role="group" aria-label="Test settings">
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
            { value: "time", label: "time" },
            { value: "words", label: "words" },
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
        className="tt-fade ll-lettering-sm group/emu inline-flex h-7 max-w-full min-w-0 items-center gap-2 whitespace-nowrap text-sub transition-colors duration-150 hover:text-text"
      >
        <span aria-hidden className={cx("size-2.5 shrink-0 border border-line", settings.emulateLayout && "bg-main")} />
        <span className="truncate underline-offset-[5px] group-hover/emu:underline">{settings.emulateLayout ? `Emulating ${active.name}` : "Using OS layout"}</span>
      </button>
    </Tooltip>
  );

  const nextChar = plan ? test.nextChar : null;
  const boardSize = `${layout.keys.length} keys, ${trimUnits(layout.width)} × ${trimUnits(layout.height)} u`;
  const viewNote = guideView.showHands ? `${guideView.showKeyboard ? "hands and keys" : "hands"}, ${camera}` : guideView.showKeyboard ? "keys, flat" : "text only";
  const titleRows: [string, string][] = [
    ["Layout", active.name],
    ["Board", boardSize],
    ["View", viewNote],
    ["Mode", practice ? `weak keys, ${practice.chars.length} ${practice.chars.length === 1 ? "key" : "keys"}` : `${mode} ${amount}, ${LIST_LABEL[wordList]}`],
  ];
  const readouts: [string, string, string][] = [
    ["WPM", String(Math.round(test.live.wpm)), "live-wpm"],
    ["RAW", String(Math.round(test.live.raw)), "live-raw"],
    ["ACC", `${Math.floor(test.live.accuracy)}%`, "live-acc"],
    ["ERR", String(test.state.keystrokes.incorrect), "live-err"],
  ];

  return (
    <div className="tt-stage" data-testid="typing-test" data-status={status} data-layout={active.id} data-finished={status === "finished" ? "true" : "false"}>
      <h1 className="sr-only">Typing test</h1>
      <MobileNotice />
      <span className="sr-only" data-testid="test-status" aria-live="polite">
        {status}
      </span>

      {status === "finished" && test.result ? (
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
      ) : (
        <>
          <div className="tt-bar border-b border-hairline pb-2">{bar}</div>

          <div className="tt-sheet">
            <div className="tt-text">
              <WordsDisplay words={test.words} caret={test.caret} status={status} />
            </div>

            <div className="tt-plate-cell">
              <KeyboardGuide
                fill
                layout={layout}
                nextChar={nextChar}
                nextAction={nextAction}
                actionCount={test.correction.count}
                pressedKeyIds={kb.pressedKeyIds}
                errorKeyIds={kb.errorKeyIds}
                showKeyboard={guideView.showKeyboard}
                maxUnit={guideView.showHands ? guideView.keyboardUnit : 56}
                footer={
                  <>
                    <GuideViewSwitch className="tt-fade" />
                    {emulationToggle}
                  </>
                }
                handsSlot={
                  guideView.showHands ? <HandsPanel fill layout={layout} nextChar={nextChar} nextAction={nextAction} press={press} compact={guideView.showKeyboard} /> : null
                }
              />
            </div>

            <div className="tt-rail">
              <div className="tt-timer">
                <div className="flex min-h-7 items-center md:justify-end">
                  {showCaps ? (
                    <span role="alert" data-testid="caps-warning" className="ll-lettering-sm inline-flex h-7 items-center gap-1.5 bg-error px-2 text-bg">
                      <Icon name="alert" size={14} />
                      Caps Lock is on
                    </span>
                  ) : (
                    <span className="ll-lettering-sm text-sub">{isTime ? "Seconds left" : "Words done"}</span>
                  )}
                </div>
                <div
                  className={cx("ll-numeral text-text md:text-right", isTime ? "text-[56px] md:text-[96px]" : "text-[40px] md:text-[60px]")}
                  data-testid="counter"
                  aria-label={isTime ? "Seconds left" : "Words done"}
                >
                  {plan ? counter : " "}
                </div>
              </div>

              <NextKeyDetail className="tt-detail" layout={layout} nextChar={nextChar} nextAction={nextAction} actionCount={test.correction.count} />

              <dl className="tt-stats" aria-label="Live results">
                {readouts.map(([label, value, id]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1.5" data-optional={id === "live-raw" ? "true" : undefined}>
                    <dt className="ll-lettering-sm text-sub">{label}</dt>
                    <dd className="ll-readout text-[17px] leading-none font-medium text-text" data-testid={id}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <dl className="tt-title border border-line" data-testid="title-block">
                {titleRows.map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[76px_minmax(0,1fr)] border-b border-border last:border-b-0">
                    <dt className="ll-lettering-sm border-r border-border px-2 py-1.5 text-sub">{label}</dt>
                    <dd className="truncate px-2 py-1.5 text-[13px] leading-tight text-text" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="tt-notes">
              {/* fades with the other notes while typing (it keeps its place, so nothing below it moves) */}
              <div className="tt-fade empty:hidden">
                <WelcomeHint suppressed={emulationHint.visible} />
              </div>
              <section className="tt-notes-list tt-fade" aria-labelledby="tt-notes-heading">
                <h2 id="tt-notes-heading" className="ll-lettering-sm text-text">
                  Notes
                </h2>
                <ol className="mt-2 space-y-2 text-[13px] leading-snug text-sub">
                  <li>{settings.fingerColors ? "The filled key is next. Its colour and the label name the finger that owns it." : "The filled key is next. The label names the finger that owns it."}</li>
                  <li>{settings.emulateLayout ? `Keys are read by position, as ${active.name}.` : "Characters come from your system layout."}</li>
                </ol>
              </section>
              {settings.fingerColors && <FingerLegend />}
              <div className="tt-notes-end">
                <div className="border-t border-hairline pt-3">
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
                    className="group/restart -mx-1 inline-flex min-h-8 items-center gap-1.5 px-1 text-[13px] text-sub transition-colors duration-150 hover:text-text"
                  >
                    <Kbd>tab</Kbd>
                    <span aria-hidden>+</span>
                    <Kbd>enter</Kbd>
                    <span className="ml-1 underline-offset-4 group-hover/restart:underline">restart test</span>
                  </button>
                  <p className="tt-fade mt-1.5 flex items-center gap-1.5 text-[13px] text-sub">
                    <Kbd>esc</Kbd>
                    <span className="ml-1">{status === "running" ? "new text" : "command palette"}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default TypingTest;
