"use client";
// Route /learn/<lessonId>: one lesson as a stepped session.
//   intro (meet each new key, press it a few times)  →  one typing run per drill  →  summary.
// Keyboard: Enter continues / skips the intro, Tab then Enter restarts the drill, Escape leaves.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { GuideViewSwitch, HandsPanel, useGuidePress, useGuideView } from "@/components/typing/HandsPanel";
import { MobileNotice } from "@/components/typing/Hints";
import { EmulationHint, useEmulationHint } from "@/components/typing/EmulationHint";
import { KeyboardGuide, guideForChar, type KeyGuide } from "@/components/typing/KeyboardGuide";
import { WordsDisplay } from "@/components/typing/WordsDisplay";
import "@/components/typing/typing.css";
import { Button, Card, ConfirmDialog, Icon, Kbd, Skeleton, cx } from "@/components/ui";
import type { ActiveLayout } from "@/lib/layout/useActiveLayout";
import { gradeLesson } from "@/lib/lessons/curriculum";
import { useSettings } from "@/lib/settings";
import { recordLessonResult } from "@/lib/lessons/progress";
import type { TestConfig, TestInput, TestResult } from "@/lib/typing/engine";
import { playErrorSound } from "@/lib/typing/sound";
import { useKeyboardInput, type KeyboardAction, type KeyboardActionEvent } from "@/lib/typing/useKeyboardInput";
import { useTypingTest } from "@/lib/typing/useTypingTest";
import { KeyChip, charLabel } from "./bits";
import { STAGE_NAME, aggregateResults, dimKeyIdsFor, lessonHref, useCourse, type Course, type CourseLesson } from "./course";
import { LearnCommands } from "./LearnCommands";
import { LessonSummary, type LessonOutcome } from "./LessonSummary";
import { useHydrated } from "./useHydrated";
import "./learn.css";

const NO_WORDS: string[] = [];
const WORDS_MODE: TestConfig = { mode: "words" };
type StepKind = "intro" | "drill" | "summary";

// ────────────────────────────────────────────────────────────────────────── small pieces

function StepProgress({ step, steps, kind, hasIntro, fraction }: { step: number; steps: number; kind: StepKind; hasIntro: boolean; fraction: number }) {
  const done = kind === "summary";
  const label = done ? "complete" : `step ${step + 1} of ${steps}`;
  return (
    <div
      className="flex shrink-0 items-center gap-3"
      data-testid="step-progress"
      data-step={done ? steps : step + 1}
      data-steps={steps}
      role="group"
      aria-label={done ? "Lesson complete" : `Step ${step + 1} of ${steps}`}
    >
      <span className="hidden font-mono text-xs whitespace-nowrap text-sub tabular-nums sm:inline">
        {label}
        {!done && <span className="text-sub/60"> · {kind === "intro" ? "new keys" : `drill ${step + 1 - (hasIntro ? 1 : 0)}`}</span>}
      </span>
      <span className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: steps }, (_, i) => {
          const state = done || i < step ? "done" : i === step ? "current" : "todo";
          return (
            <span key={i} data-state={state} className="relative h-1.5 w-5 overflow-hidden rounded-full bg-text/[0.12] sm:w-7">
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-main transition-[width] duration-200 ease-out"
                style={{ width: state === "done" ? "100%" : state === "current" ? `${Math.max(12, Math.round(fraction * 100))}%` : "0%" }}
              />
            </span>
          );
        })}
      </span>
      <span className="font-mono text-xs whitespace-nowrap text-sub tabular-nums sm:hidden">{done ? "done" : `${step + 1}/${steps}`}</span>
    </div>
  );
}

function EmulationToggle({ layoutName }: { layoutName: string }) {
  const [settings, update] = useSettings();
  const on = settings.emulateLayout;
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid="emulation-toggle"
      data-state={on ? "on" : "off"}
      title={
        on
          ? `Your keys are remapped to ${layoutName} by position. Turn this off if your system is already set to ${layoutName}.`
          : `Using the characters your system sends. If your OS is still on QWERTY, turn emulation on to practise ${layoutName} without changing system settings.`
      }
      onClick={(e) => {
        update({ emulateLayout: !on });
        e.currentTarget.blur();
      }}
      className="tt-fade inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs whitespace-nowrap text-sub transition-colors duration-150 hover:bg-text/[0.06] hover:text-text"
    >
      <Icon name="layers" size={13} className={cx("shrink-0", on && "text-main")} />
      <span className="truncate">{on ? `emulating ${layoutName}` : "using OS layout"}</span>
    </button>
  );
}

function Notice({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-15.5rem)] items-center justify-center" data-testid="lesson-notice">
      <Card className="flex max-w-md flex-col items-start gap-3" padding="lg">
        <h1 className="text-lg font-semibold tracking-tight text-text">{title}</h1>
        <p className="text-sm leading-relaxed text-sub">{children}</p>
        <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────── intro step

function IntroStep({
  guide,
  index,
  count,
  presses,
  needed,
  fingerColors,
  layout,
  onSkip,
}: {
  guide: KeyGuide;
  index: number;
  count: number;
  presses: number;
  needed: number;
  fingerColors: boolean;
  layout: ActiveLayout["layout"];
  onSkip: () => void;
}) {
  const color = fingerColors && guide.fingerIndex >= 0 ? `var(--finger-${guide.fingerIndex})` : "var(--main)";
  const shiftFinger = guide.shiftKey?.finger ? `${guide.shiftKey.finger.hand === "L" ? "left" : "right"} ${guide.shiftKey.finger.finger}` : "";
  const isHome = !!guide.key?.isHome && !guide.shiftKey;
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="flex flex-col items-center"
        data-testid="intro-key"
        data-char={guide.char}
        data-key-id={guide.key?.id ?? ""}
        data-finger={guide.finger ? `${guide.finger.hand}-${guide.finger.finger}` : ""}
        data-index={index + 1}
        data-count={count}
        data-presses={presses}
        data-needed={needed}
      >
        <div className="font-mono text-xs text-sub">
          new key {index + 1} of {count}
        </div>
        <div className="mt-4 flex items-center gap-5 text-left">
          <KeyChip key={guide.char} char={guide.char} layout={layout} fingerColors={fingerColors} size="xl" className="learn-key-in" />
          <div className="min-w-0">
            <div className="text-2xl font-semibold tracking-tight text-text">
              This is {guide.shiftKey && guide.char.toLowerCase() !== guide.char ? "capital " : ""}
              <span style={{ color }}>{charLabel(guide.char)}</span>
            </div>
            <div className="mt-1 text-[15px] leading-snug text-sub">
              {guide.shiftKey ? (
                <>
                  Hold <Kbd className="px-1.5">shift</Kbd>
                  {shiftFinger ? ` with your ${shiftFinger}` : ""}, then press it with your <span style={{ color }}>{guide.fingerName || "other hand"}</span>
                  {guide.fingerName && guide.fingerName !== "thumb" ? " finger" : ""}.
                </>
              ) : guide.fingerName ? (
                <>
                  Press it with your <span style={{ color }}>{guide.fingerName}</span>
                  {guide.fingerName !== "thumb" ? " finger" : ""}
                  {isHome ? ". That finger rests on it." : ", then come back to the home row."}
                </>
              ) : (
                "Find it on the keyboard below and press it."
              )}
            </div>
          </div>
        </div>
        <div className="mt-6 flex items-center gap-3 text-sm text-sub" aria-live="polite">
          <span className="flex items-center gap-1.5" aria-hidden>
            {Array.from({ length: needed }, (_, i) => (
              <span
                key={`${guide.char}-${i}`}
                data-on={i < presses ? "true" : "false"}
                className="learn-dot size-2.5 rounded-full transition-colors duration-150"
                style={{ backgroundColor: i < presses ? color : "color-mix(in srgb, var(--text) 14%, transparent)" }}
              />
            ))}
          </span>
          <span>
            {presses >= needed ? "Got it" : `Press it ${needed - presses === 1 ? (needed === 1 ? "once" : "once more") : `${needed - presses} times`}`}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSkip}
        data-testid="intro-skip"
        className="mt-5 inline-flex h-8 items-center gap-2 rounded-ui px-3 text-[13px] text-sub transition-colors duration-150 hover:bg-text/[0.07] hover:text-text"
      >
        Skip intro
        <Kbd size="sm">enter</Kbd>
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────── session

interface SessionProps {
  item: CourseLesson;
  course: Course;
  active: ActiveLayout;
  onRetry: () => void;
}

function LessonSession({ item, course, active, onRetry }: SessionProps) {
  const router = useRouter();
  const [settings] = useSettings();
  const { lesson } = item;
  const layout = active.layout;
  const fingerColors = settings.fingerColors;
  const guideView = useGuideView();
  const [press, notePress] = useGuidePress();

  // What this run started from (the live `item` changes once the result is saved).
  const startedFrom = useRef({ stars: item.stars, passed: item.passed });

  const introKeys = useMemo(
    () => (lesson.kind === "new" ? lesson.newChars.map((c) => guideForChar(layout, c)).filter((g): g is KeyGuide => !!g && !!g.key) : []),
    [lesson, layout],
  );
  const hasIntro = introKeys.length > 0;
  const needed = introKeys.length <= 4 ? 3 : introKeys.length <= 8 ? 2 : 1;
  const drillCount = lesson.drills.length;
  const steps = (hasIntro ? 1 : 0) + drillCount;

  const [step, setStep] = useState(0);
  const kind: StepKind = step >= steps ? "summary" : hasIntro && step === 0 ? "intro" : "drill";
  const drillIndex = kind === "drill" ? step - (hasIntro ? 1 : 0) : -1;

  const [intro, setIntroState] = useState({ index: 0, presses: 0, done: false });
  const introRef = useRef(intro);
  const setIntro = (next: typeof intro) => {
    introRef.current = next;
    setIntroState(next);
  };
  const introTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (introTimer.current != null) window.clearTimeout(introTimer.current);
    },
    [],
  );

  const [drillDone, setDrillDone] = useState(false);
  const [outcome, setOutcome] = useState<LessonOutcome | null>(null);
  const results = useRef<TestResult[]>([]);
  const drillIndexRef = useRef(drillIndex);
  drillIndexRef.current = drillIndex;

  const onFinish = useCallback(
    (result: TestResult) => {
      const i = drillIndexRef.current;
      if (i < 0) return;
      results.current[i] = result;
      if (i < drillCount - 1) {
        setDrillDone(true);
        return;
      }
      // Lesson complete: grade the drills as one run and save it (the only write of a session).
      const drills = results.current.slice(0, drillCount);
      const total = aggregateResults(drills);
      const { grade } = recordLessonResult(active.id, lesson, total);
      setOutcome({ result: total, drills, grade, previousStars: startedFrom.current.stars, wasPassed: startedFrom.current.passed });
      setStep(steps);
    },
    [drillCount, steps, active.id, lesson],
  );

  const test = useTypingTest({ words: hasIntro ? NO_WORDS : (lesson.drills[0] ?? NO_WORDS), config: WORDS_MODE, onFinish });
  const { restart, status, handleInput } = test;

  // Entering a drill step arms the engine with that drill's words.
  const drillsRef = useRef(lesson.drills);
  drillsRef.current = lesson.drills;
  useEffect(() => {
    if (drillIndex < 0) return;
    restart({ words: drillsRef.current[drillIndex], config: WORDS_MODE });
    setDrillDone(false);
  }, [drillIndex, restart]);

  const goStep = useCallback((n: number) => {
    if (introTimer.current != null) window.clearTimeout(introTimer.current);
    introTimer.current = null;
    setStep(n);
  }, []);
  const nextStep = useCallback(() => setStep((s) => s + 1), []);
  const restartDrill = useCallback(() => {
    restart();
    setDrillDone(false);
  }, [restart]);

  // ── leaving ──
  const [confirmLeave, setConfirmLeave] = useState(false);
  const dirty = kind !== "summary" && (step > 0 || intro.index > 0 || intro.presses > 0 || status === "running");
  const toCourse = useCallback(() => router.push("/learn"), [router]);
  const requestLeave = useCallback(() => {
    if (dirty) setConfirmLeave(true);
    else toCourse();
  }, [dirty, toCourse]);

  // ── input ──
  const introGuide = kind === "intro" ? (introKeys[Math.min(intro.index, introKeys.length - 1)] ?? null) : null;
  const nextChar = kind === "intro" ? (intro.done ? null : (introGuide?.char ?? null)) : kind === "drill" && !drillDone ? test.nextChar : null;
  // Typo in the current word: point at Backspace (drills only, never in the intro).
  const nextAction = kind === "drill" && !drillDone && test.correction.needed ? ("backspace" as const) : null;
  const live = useRef({ kind, drillDone, expected: nextChar });
  live.current = { kind, drillDone, expected: nextChar };

  const onInput = useCallback(
    (input: TestInput) => {
      const s = live.current;
      if (s.kind === "intro") {
        const st = introRef.current;
        if (input.type !== "char" || st.done || s.expected == null) return;
        const ok = input.char === s.expected;
        notePress(input.keyId, ok);
        if (!ok) return;
        const presses = st.presses + 1;
        if (presses < needed) setIntro({ ...st, presses });
        else if (st.index + 1 < introKeys.length) setIntro({ index: st.index + 1, presses: 0, done: false });
        else {
          // Last key learned: let the final tap land, then move on to the first drill.
          setIntro({ ...st, presses, done: true });
          introTimer.current = window.setTimeout(() => goStep(1), 550);
        }
        return;
      }
      if (s.kind !== "drill" || s.drillDone) return; // between drills only Enter continues
      if (input.type === "char") notePress(input.keyId, input.char === s.expected);
      else if (input.keyId) notePress(input.keyId, true); // Backspace is never a mistake
      handleInput(input);
    },
    [notePress, handleInput, needed, introKeys.length, goStep],
  );

  const restartRef = useRef<HTMLButtonElement>(null);
  const onAction = useCallback(
    (action: KeyboardAction, ev: KeyboardActionEvent) => {
      if (action === "escape") {
        requestLeave();
        return true;
      }
      if (action === "enter") {
        if (ev.onControl) return false; // the focused button handles it
        if (kind === "intro") {
          goStep(1);
          return true;
        }
        if (kind === "drill" && drillDone) {
          nextStep();
          return true;
        }
        return false;
      }
      // Tab jumps to the restart button, so Tab then Enter restarts the drill from anywhere.
      if (kind !== "drill" || ev.shiftKey || ev.target === restartRef.current) return false;
      restartRef.current?.focus();
      return true;
    },
    [kind, drillDone, requestLeave, goStep, nextStep],
  );

  const emulationHint = useEmulationHint({ layout, emulate: settings.emulateLayout });
  const kb = useKeyboardInput({
    layout,
    emulate: settings.emulateLayout,
    onKeystroke: emulationHint.note,
    enabled: kind !== "summary",
    expectedChar: nextChar,
    onInput,
    onAction,
    onWrongKey: settings.soundOnError ? () => playErrorSound() : undefined,
  });

  // Focus mode while a drill is being typed (same convention as the test).
  const typing = kind === "drill" && status === "running";
  useEffect(() => {
    const el = document.documentElement;
    if (typing) el.dataset.typing = "true";
    else delete el.dataset.typing;
    return () => {
      delete el.dataset.typing;
    };
  }, [typing]);

  const dimKeyIds = useMemo(() => dimKeyIdsFor(layout, lesson), [layout, lesson]);
  // Drills are short: two lines of text on wide screens, three where a line holds only a few words.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const nextLesson = course.lessons[item.number] ?? null;

  // ── derived display values ──
  const totalWords = test.state.words.length;
  const wordsDone = Math.min(test.state.wordIndex, totalWords);
  const fraction = kind === "intro" ? (intro.index + intro.presses / needed) / Math.max(1, introKeys.length) : kind === "drill" && totalWords > 0 ? (drillDone ? 1 : wordsDone / totalWords) : 0;
  const lastResult = drillDone && drillIndex >= 0 ? results.current[drillIndex] : null;
  const lastGrade = lastResult ? gradeLesson(lastResult, lesson) : null;
  const showCaps = kb.capsLock && !settings.emulateLayout && kind !== "summary";

  const guide =
    kind === "summary" ? null : (
      <KeyboardGuide
        className={kind === "intro" ? "mt-6" : "mt-5 sm:mt-6"}
        layout={layout}
        nextChar={nextChar}
        nextAction={nextAction}
        actionCount={test.correction.count}
        pressedKeyIds={kb.pressedKeyIds}
        errorKeyIds={kb.errorKeyIds}
        dimKeyIds={dimKeyIds}
        showKeyboard={guideView.showKeyboard}
        maxUnit={guideView.keyboardUnit}
        reserveBox={guideView.reserveBox}
        hintEnd={
          <>
            <GuideViewSwitch className="tt-fade" />
            <EmulationToggle layoutName={active.name} />
          </>
        }
        handsSlot={
          guideView.showHands ? (
            <HandsPanel
              layout={layout}
              nextChar={nextChar}
              nextAction={nextAction}
              press={press}
              compact={guideView.showKeyboard}
              camera={kind === "intro" ? "angled" : undefined}
            />
          ) : null
        }
      />
    );

  return (
    <div
      className="flex min-h-[calc(100dvh-15.5rem)] flex-col"
      data-testid="lesson-player"
      data-lesson-id={lesson.id}
      data-layout={active.id}
      data-step={Math.min(step, steps) + 1}
      data-steps={steps}
      data-step-kind={kind}
      data-drill={drillIndex >= 0 ? drillIndex + 1 : ""}
      data-drill-state={kind === "drill" ? (drillDone ? "done" : status) : ""}
    >
      <LearnCommands />
      <MobileNotice />
      <EmulationHint hint={emulationHint} layoutName={active.name} />
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={requestLeave}
            data-testid="lesson-leave"
            aria-label="Back to the course"
            title="Back to the course (esc)"
            className="-ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-ui text-sub transition-colors duration-150 hover:bg-text/[0.07] hover:text-text"
          >
            <Icon name="arrow-left" size={18} />
          </button>
          <div className="min-w-0">
            <div className="font-mono text-[11px] leading-tight text-main">
              lesson {item.number} · {STAGE_NAME[lesson.stage].toLowerCase()}
            </div>
            <h1 className="truncate text-[15px] leading-snug font-semibold tracking-tight text-text" data-testid="lesson-title">
              {lesson.title}
            </h1>
          </div>
        </div>
        <StepProgress step={Math.min(step, steps)} steps={steps} kind={kind} hasIntro={hasIntro} fraction={fraction} />
      </header>

      {kind === "summary" && outcome ? (
        <div className="flex flex-1 flex-col justify-center py-6">
          <LessonSummary
            lesson={lesson}
            outcome={outcome}
            layout={layout}
            fingerColors={fingerColors}
            nextLesson={nextLesson}
            onNext={() => nextLesson && router.push(lessonHref(nextLesson.lesson.id))}
            onRetry={onRetry}
            onCourse={toCourse}
          />
        </div>
      ) : kind === "intro" && introGuide ? (
        <div className="flex flex-1 flex-col justify-center pt-6 pb-2">
          <IntroStep
            guide={introGuide}
            index={Math.min(intro.index, introKeys.length - 1)}
            count={introKeys.length}
            presses={intro.presses}
            needed={needed}
            fingerColors={fingerColors}
            layout={layout}
            onSkip={() => goStep(1)}
          />
          {guide}
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center pt-6 pb-2">
          <div className="mb-2 flex h-9 items-end justify-between gap-4">
            <div className="flex items-baseline gap-5 font-mono tabular-nums">
              <span className="text-2xl leading-none font-medium text-main" data-testid="counter" aria-label="Words done">
                {wordsDone}/{totalWords}
              </span>
              <span className="text-sm whitespace-nowrap text-sub">
                <span className={cx("text-base", test.live.accuracy < lesson.goal.accuracy ? "text-error" : "text-text")} data-testid="live-acc">
                  {Math.floor(test.live.accuracy)}%
                </span>{" "}
                acc
              </span>
              <span className="tt-live text-sm whitespace-nowrap text-sub">
                <span className="text-base text-text" data-testid="live-wpm">
                  {Math.round(test.live.wpm)}
                </span>{" "}
                wpm
              </span>
            </div>
            {showCaps ? (
              <span role="alert" data-testid="caps-warning" className="inline-flex h-7 items-center gap-1.5 rounded-full bg-error/[0.14] px-3 text-xs font-medium text-error">
                <Icon name="alert" size={13} />
                Caps Lock is on
              </span>
            ) : (
              <span className="tt-fade font-mono text-xs whitespace-nowrap text-sub" data-testid="lesson-goal">
                goal {lesson.goal.accuracy}% · {lesson.goal.wpm} wpm
              </span>
            )}
          </div>

          <WordsDisplay words={test.words} caret={test.caret} status={status} lines={narrow ? 3 : 2} aria-label={`Drill ${drillIndex + 1} of ${drillCount}`} />

          <div className="mt-4 flex h-10 items-center justify-center gap-2">
            {drillDone && lastResult ? (
              <div className="animate-rise-in flex flex-wrap items-center justify-center gap-x-4 gap-y-2" data-testid="drill-done" data-accuracy={lastResult.accuracy} data-wpm={lastResult.wpm}>
                <span className="inline-flex items-center gap-2 font-mono text-sm tabular-nums">
                  <Icon name="check" size={15} strokeWidth={2.2} className={lastGrade?.passed ? "text-success" : "text-sub"} />
                  <span className={lastResult.accuracy >= lesson.goal.accuracy ? "text-text" : "text-error"}>{Math.floor(lastResult.accuracy)}%</span>
                  <span className="text-sub">{Math.round(lastResult.wpm)} wpm</span>
                </span>
                <Button variant="primary" size="sm" onClick={nextStep} data-testid="drill-next">
                  Next drill
                  <Kbd size="sm" className="border-main-fg/30 bg-transparent text-main-fg">
                    enter
                  </Kbd>
                </Button>
                <button
                  ref={restartRef}
                  type="button"
                  data-testid="restart"
                  aria-label="Redo this drill"
                  title="Redo this drill (tab, then enter)"
                  onClick={(e) => {
                    restartDrill();
                    e.currentTarget.blur();
                  }}
                  className="inline-flex size-8 items-center justify-center rounded-ui text-sub transition-colors duration-150 hover:text-text focus-visible:bg-text/[0.07] focus-visible:text-text"
                >
                  <Icon name="restart" size={16} />
                </button>
              </div>
            ) : (
              <button
                ref={restartRef}
                type="button"
                data-testid="restart"
                aria-label="Restart this drill"
                title="Restart drill (tab, then enter)"
                onClick={(e) => {
                  restartDrill();
                  e.currentTarget.blur();
                }}
                className="inline-flex h-9 w-14 items-center justify-center rounded-ui text-sub transition-colors duration-150 hover:text-text focus-visible:bg-text/[0.07] focus-visible:text-text"
              >
                <Icon name="restart" size={18} />
              </button>
            )}
          </div>

          {guide}
        </div>
      )}

      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={toCourse}
        title="Leave this lesson?"
        description="Progress is only saved when you finish the last drill. This run will be lost."
        confirmLabel="Leave"
        cancelLabel="Keep going"
        tone="danger"
        data-testid="leave-confirm"
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────── entry

function PlayerSkeleton() {
  return (
    <div className="flex min-h-[calc(100dvh-15.5rem)] flex-col" aria-hidden data-testid="lesson-skeleton">
      <Skeleton animate className="h-9 w-64" />
      <div className="flex flex-1 flex-col justify-center gap-3">
        <Skeleton animate className="h-8 w-full" />
        <Skeleton animate className="h-8 w-11/12" />
        <Skeleton animate className="h-8 w-4/5" />
        <Skeleton animate className="mx-auto mt-10 h-56 w-full max-w-[640px] rounded-ui-lg" />
      </div>
    </div>
  );
}

export function LessonPlayer({ lessonId }: { lessonId: string }) {
  const hydrated = useHydrated();
  const { active, course } = useCourse();
  const [run, setRun] = useState(0);

  if (!hydrated) return <PlayerSkeleton />;

  const item = course.byId.get(lessonId);
  if (!item) {
    return (
      <Notice
        title="Lesson not found"
        actions={
          <>
            <Button variant="primary" href="/learn" icon="graduation">
              Open the course
            </Button>
            {course.next && <Button href={lessonHref(course.next.lesson.id)}>Continue with lesson {course.next.number}</Button>}
          </>
        }
      >
        There is no lesson “{lessonId}” in the {active.name} course. Lessons are generated per layout, so a link from another layout does not carry over.
      </Notice>
    );
  }
  return <LessonSession key={`${active.id}:${lessonId}:${run}`} item={item} course={course} active={active} onRetry={() => setRun((r) => r + 1)} />;
}

export default LessonPlayer;
