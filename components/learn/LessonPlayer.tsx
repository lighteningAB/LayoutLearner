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
import { Badge, Button, Card, ConfirmDialog, Icon, IconButton, Kbd, Skeleton, cx } from "@/components/ui";
import type { ActiveLayout } from "@/lib/layout/useActiveLayout";
import { gradeLesson } from "@/lib/lessons/curriculum";
import { useSettings } from "@/lib/settings";
import { recordLessonResult } from "@/lib/lessons/progress";
import type { TestConfig, TestInput, TestResult } from "@/lib/typing/engine";
import { playErrorSound } from "@/lib/typing/sound";
import { useKeyboardInput, type KeyboardAction, type KeyboardActionEvent } from "@/lib/typing/useKeyboardInput";
import { useTypingTest } from "@/lib/typing/useTypingTest";
import { DetailNumber, KeyChip, charLabel } from "./bits";
import { STAGE_NAME, aggregateResults, dimKeyIdsFor, lessonHref, useCourse, type Course, type CourseLesson } from "./course";
import { LearnCommands } from "./LearnCommands";
import { LessonSummary, type LessonOutcome } from "./LessonSummary";
import { useHydrated } from "./useHydrated";
import "./learn.css";

const NO_WORDS: string[] = [];
const WORDS_MODE: TestConfig = { mode: "words" };
type StepKind = "intro" | "drill" | "summary";

// ────────────────────────────────────────────────────────────────────────── small pieces

/** The lesson as a drafted sequence: one numbered box per step, done ones filled, a scale under them. */
function StepProgress({ step, steps, kind, hasIntro, fraction }: { step: number; steps: number; kind: StepKind; hasIntro: boolean; fraction: number }) {
  const done = kind === "summary";
  const label = done ? "complete" : `step ${step + 1} of ${steps}`;
  const overall = done ? steps : step + Math.min(1, Math.max(0, fraction));
  return (
    <div
      className="flex shrink-0 items-center gap-4"
      data-testid="step-progress"
      data-step={done ? steps : step + 1}
      data-steps={steps}
      role="group"
      aria-label={done ? "Lesson complete" : `Step ${step + 1} of ${steps}`}
    >
      <span className="ll-lettering hidden whitespace-nowrap text-text md:inline">
        {label}
        {!done && <span className="text-sub"> · {kind === "intro" ? "new keys" : `drill ${step + 1 - (hasIntro ? 1 : 0)}`}</span>}
      </span>
      <span className="hidden flex-col gap-1.5 sm:flex" aria-hidden>
        <span className="flex items-center">
          {Array.from({ length: steps }, (_, i) => {
            const state = done || i < step ? "done" : i === step ? "current" : "todo";
            return (
              <span key={i} className="flex items-center">
                {i > 0 && <span className={cx("h-px w-3", state === "todo" ? "bg-border" : "bg-line")} />}
                <span
                  data-state={state}
                  className={cx(
                    "ll-readout inline-flex size-7 items-center justify-center border text-sm leading-none font-medium",
                    state === "done" && "border-line bg-text text-bg",
                    state === "current" && "border-main bg-main text-main-fg",
                    state === "todo" && "border-dashed border-border text-sub",
                  )}
                >
                  {state === "done" ? <Icon name="check" size={14} strokeWidth={2.2} /> : i + 1}
                </span>
              </span>
            );
          })}
        </span>
        <span className="relative block h-[3px] border-x border-line">
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
          <span className="absolute inset-y-0 left-0 bg-main transition-[width] duration-200 ease-out" style={{ width: `${(overall / Math.max(1, steps)) * 100}%` }} />
        </span>
      </span>
      <span className="ll-readout text-sm whitespace-nowrap text-text sm:hidden">{done ? "done" : `step ${step + 1}/${steps}`}</span>
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
      className={cx(
        "tt-fade inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 px-1.5 text-sm whitespace-nowrap underline-offset-[5px] transition-colors duration-150 hover:text-text hover:underline",
        on ? "text-text" : "text-sub",
      )}
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
        <h1 className="ll-heading text-text">{title}</h1>
        <p className="text-base leading-relaxed text-sub">{children}</p>
        <div className="mt-2 flex flex-wrap gap-2">{actions}</div>
      </Card>
    </div>
  );
}

/** A finger named in running text: a swatch of its colour plus the name, so colour never stands alone. */
function FingerText({ name, index, colors }: { name: string; index: number; colors: boolean }) {
  return (
    <span className="font-semibold whitespace-nowrap text-text">
      {colors && index >= 0 && <span aria-hidden className="mr-1.5 inline-block size-2.5 border border-line align-baseline" style={{ backgroundColor: `var(--finger-${index})` }} />}
      {name}
    </span>
  );
}

/** One cell of the drill readout strip. */
function Readout({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col justify-center px-4 py-2 first:pl-0", className)}>
      <div className="ll-lettering-sm whitespace-nowrap text-sub">{label}</div>
      <div className="ll-readout mt-1 text-xl leading-none whitespace-nowrap text-text">{children}</div>
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
  miss,
  fingerColors,
  layout,
  onSkip,
}: {
  guide: KeyGuide;
  index: number;
  count: number;
  presses: number;
  needed: number;
  /** The wrong character that was just pressed, until the right key lands. */
  miss: string | null;
  fingerColors: boolean;
  layout: ActiveLayout["layout"];
  onSkip: () => void;
}) {
  const shiftFinger = guide.shiftKey?.finger ? `${guide.shiftKey.finger.hand === "L" ? "left" : "right"} ${guide.shiftKey.finger.finger}` : "";
  const layerFinger = guide.layerKey?.finger ? `${guide.layerKey.finger.hand === "L" ? "left" : "right"} ${guide.layerKey.finger.finger}` : "";
  const isHome = !!guide.key?.isHome && !guide.shiftKey && !guide.layerKey;
  const got = presses >= needed;
  const finger = <FingerText name={guide.fingerName || "other hand"} index={guide.fingerIndex} colors={fingerColors} />;
  return (
    <div className="flex flex-col border border-line bg-bg-alt">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
        <span className="ll-lettering text-text">
          new key {index + 1} of {count}
        </span>
        <span className="ll-lettering-sm text-sub">
          pressed{" "}
          <span className="ll-readout text-sm tracking-normal text-text">
            {Math.min(presses, needed)}/{needed}
          </span>
        </span>
      </div>
      <div
        className="p-5"
        data-testid="intro-key"
        data-char={guide.char}
        data-key-id={guide.key?.id ?? ""}
        data-finger={guide.finger ? `${guide.finger.hand}-${guide.finger.finger}` : ""}
        data-index={index + 1}
        data-count={count}
        data-presses={presses}
        data-needed={needed}
        data-miss={miss ?? ""}
      >
        <div className="flex items-center gap-5">
          <KeyChip
            key={guide.char}
            char={guide.char}
            layout={layout}
            fingerColors={fingerColors}
            size="xl"
            className="learn-key-in max-sm:h-[84px] max-sm:min-w-[84px] max-sm:text-4xl"
          />
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-[1.1] font-light tracking-[0.08em] text-text uppercase">
              This is {guide.shiftKey && guide.char.toLowerCase() !== guide.char ? "capital " : ""}
              <span className="font-semibold">{charLabel(guide.char)}</span>
            </h2>
            {guide.fingerName && (
              <div className="ll-lettering-lg mt-3 flex items-center gap-2 text-text" data-testid="intro-finger">
                <Icon name="hand" size={16} className="shrink-0" />
                {guide.fingerName}
              </div>
            )}
          </div>
        </div>

        <p className="mt-5 max-w-[46ch] text-lg leading-[1.45] text-sub">
          {guide.shiftKey || guide.layerKey ? (
            <>
              {guide.layerKey && guide.layer && (
                <>
                  Hold <Kbd className="px-1.5">{guide.layer.name}</Kbd>
                  {layerFinger ? ` with your ${layerFinger}` : ""}
                  {guide.shiftKey ? " and " : ", "}
                </>
              )}
              {guide.shiftKey && (
                <>
                  {guide.layerKey ? "" : "Hold "}
                  <Kbd className="px-1.5">shift</Kbd>
                  {shiftFinger ? ` with your ${shiftFinger}` : ""}
                  {", "}
                </>
              )}
              then press it with your {finger}
              {guide.fingerName && guide.fingerName !== "thumb" ? " finger" : ""}.
            </>
          ) : guide.fingerName ? (
            <>
              Press it with your {finger}
              {guide.fingerName !== "thumb" ? " finger" : ""}
              {isHome ? ". That finger rests on it." : ", then come back to the home row."}
            </>
          ) : (
            "Find it on the keyboard and press it."
          )}
        </p>

        <div className="mt-6 border-t border-border pt-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5" aria-hidden>
              {Array.from({ length: needed }, (_, i) => {
                const on = i < presses;
                return (
                  <span
                    key={`${guide.char}-${i}`}
                    data-on={on ? "true" : "false"}
                    className={cx(
                      "learn-press ll-readout inline-flex size-8 items-center justify-center border text-sm leading-none font-medium",
                      on ? "border-line bg-text text-bg" : "border-dashed border-border text-sub",
                    )}
                  >
                    {on ? <Icon name="check" size={16} strokeWidth={2.2} /> : i + 1}
                  </span>
                );
              })}
            </span>
            <span className={cx("text-lg text-text", got && "font-semibold")}>
              {got ? "Got it" : `Press it ${needed - presses === 1 ? (needed === 1 ? "once" : "once more") : `${needed - presses} times`}`}
            </span>
          </div>
          <div className="mt-3 flex min-h-[26px] items-center">
            {miss != null && !got && (
              <span key={miss} className="learn-miss inline-flex items-center gap-2 text-base text-error" data-testid="intro-miss">
                <span className="inline-flex size-[22px] shrink-0 items-center justify-center border border-dashed border-error">
                  <Icon name="x" size={14} strokeWidth={2.2} />
                </span>
                <span>
                  That was <span className="font-mono font-medium">{charLabel(miss)}</span>. Look for <span className="font-mono font-medium">{charLabel(guide.char)}</span>.
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end border-t border-border px-4 py-2">
        <button
          type="button"
          onClick={onSkip}
          data-testid="intro-skip"
          className="ll-lettering inline-flex h-8 items-center gap-2 px-1 text-sub underline-offset-[5px] transition-colors duration-150 hover:text-text hover:underline"
        >
          Skip intro
          <Kbd size="sm">enter</Kbd>
        </button>
      </div>
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
  // Intro only: the wrong character just pressed, shown as a text note until the right key lands.
  const [miss, setMiss] = useState<string | null>(null);
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
        setMiss(ok ? null : input.char);
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
  const lowAcc = test.live.accuracy < lesson.goal.accuracy;

  const guide =
    kind === "summary" ? null : (
      <KeyboardGuide
        className={kind === "intro" ? undefined : "mt-3 sm:mt-4"}
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
      <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton
            icon="arrow-left"
            label="Back to the course"
            title="Back to the course (esc)"
            onClick={requestLeave}
            data-testid="lesson-leave"
            className="-ml-1 tt-fade"
          />
          <DetailNumber n={item.number} size="lg" className="max-sm:hidden" />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="ll-heading min-w-0 truncate text-text max-sm:text-base" data-testid="lesson-title">
              {lesson.title}
            </h1>
            <span className="ll-lettering-sm whitespace-nowrap text-sub max-md:hidden">
              lesson {item.number} · {STAGE_NAME[lesson.stage].toLowerCase()}
            </span>
          </div>
        </div>
        <StepProgress step={Math.min(step, steps)} steps={steps} kind={kind} hasIntro={hasIntro} fraction={fraction} />
      </header>

      {kind === "summary" && outcome ? (
        <div className="flex flex-1 flex-col justify-center py-8">
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
        <div className="grid flex-1 items-center gap-x-10 gap-y-6 pt-6 pb-2 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <IntroStep
            guide={introGuide}
            index={Math.min(intro.index, introKeys.length - 1)}
            count={introKeys.length}
            presses={intro.presses}
            needed={needed}
            miss={miss}
            fingerColors={fingerColors}
            layout={layout}
            onSkip={() => goStep(1)}
          />
          <div className="learn-plate learn-plate--side min-w-0">{guide}</div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-center pt-5 pb-2">
          <div className="mb-3 flex min-h-[52px] flex-wrap items-stretch justify-between gap-x-4 gap-y-2">
            <div className="flex items-stretch divide-x divide-border">
              <Readout label="words">
                <span data-testid="counter" aria-label="Words done">
                  {wordsDone}/{totalWords}
                </span>
              </Readout>
              <Readout label="accuracy">
                <span className={cx("inline-flex items-center gap-1.5", lowAcc && "text-error")} title={lowAcc ? `Under the ${lesson.goal.accuracy}% goal` : undefined}>
                  <span data-testid="live-acc">{Math.floor(test.live.accuracy)}%</span>
                  {lowAcc && (
                    <>
                      <Icon name="arrow-down" size={14} strokeWidth={2.2} />
                      <span className="sr-only">under the goal</span>
                    </>
                  )}
                </span>
              </Readout>
              <Readout label="speed" className="tt-live">
                <span data-testid="live-wpm">{Math.round(test.live.wpm)}</span>
                <span className="text-sm text-sub"> wpm</span>
              </Readout>
            </div>
            <div className="flex items-center gap-3">
              {drillDone && lastResult ? (
                <div
                  className="animate-rise-in flex flex-wrap items-stretch justify-center border border-line bg-bg-alt"
                  data-testid="drill-done"
                  data-accuracy={lastResult.accuracy}
                  data-wpm={lastResult.wpm}
                >
                  <span className="ll-lettering inline-flex items-center gap-2 border-r border-border px-3 text-text">
                    <Icon name={lastGrade?.passed ? "check" : "x"} size={15} strokeWidth={2.2} />
                    drill {drillIndex + 1} {lastGrade?.passed ? "on goal" : "under goal"}
                  </span>
                  <span className="ll-readout inline-flex items-center gap-3 border-r border-border px-3 text-base">
                    <span className={lastResult.accuracy >= lesson.goal.accuracy ? "text-text" : "text-error"}>{Math.floor(lastResult.accuracy)}%</span>
                    <span className={lastResult.wpm >= lesson.goal.wpm ? "text-text" : "text-error"}>{Math.round(lastResult.wpm)} wpm</span>
                  </span>
                  <span className="inline-flex items-center gap-1 p-1.5">
                    <Button variant="primary" size="sm" onClick={nextStep} data-testid="drill-next">
                      <span className="ll-trim">Next drill</span>
                      <Kbd size="sm" className="border-main-fg bg-main-fg text-main group-hover/btn:border-bg group-hover/btn:bg-bg group-hover/btn:text-text">
                        enter
                      </Kbd>
                    </Button>
                    <IconButton
                      ref={restartRef}
                      icon="restart"
                      size="sm"
                      label="Redo this drill"
                      title="Redo this drill (tab, then enter)"
                      data-testid="restart"
                      onClick={(e) => {
                        restartDrill();
                        e.currentTarget.blur();
                      }}
                    />
                  </span>
                </div>
              ) : (
                <>
                  {showCaps ? (
                    <Badge tone="error" icon="alert" role="alert" data-testid="caps-warning">
                      Caps Lock is on
                    </Badge>
                  ) : (
                    <span className="tt-fade ll-lettering-sm whitespace-nowrap text-sub" data-testid="lesson-goal">
                      goal{" "}
                      <span className="ll-readout text-sm tracking-normal text-text normal-case">
                        {lesson.goal.accuracy}% · {lesson.goal.wpm} wpm
                      </span>
                    </span>
                  )}
                  <IconButton
                    ref={restartRef}
                    icon="restart"
                    size="sm"
                    label="Restart this drill"
                    title="Restart drill (tab, then enter)"
                    data-testid="restart"
                    onClick={(e) => {
                      restartDrill();
                      e.currentTarget.blur();
                    }}
                  />
                </>
              )}
            </div>
          </div>

          <WordsDisplay words={test.words} caret={test.caret} status={status} lines={narrow ? 3 : 2} aria-label={`Drill ${drillIndex + 1} of ${drillCount}`} />

          <div className="learn-plate min-w-0">{guide}</div>
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
      <div className="border-b border-border pb-4">
        <Skeleton animate className="h-11 w-72" />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3">
        <Skeleton animate className="h-8 w-full" />
        <Skeleton animate className="h-8 w-4/5" />
        <Skeleton animate className="mx-auto mt-10 h-72 w-full max-w-[860px]" />
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
