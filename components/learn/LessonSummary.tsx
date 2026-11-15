"use client";
// End of a lesson: stars, pass / fail against the goal, what to improve, where to go next.
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { guideForChar } from "@/components/typing/KeyboardGuide";
import { weakCharsOfResult } from "@/components/typing/practice";
import { Button, Icon, Kbd, cx } from "@/components/ui";
import type { Lesson, LessonGrade } from "@/lib/lessons/curriculum";
import type { TestResult } from "@/lib/typing/engine";
import type { ParsedLayout } from "@/lib/types";
import { Stars, charLabel } from "./bits";
import type { CourseLesson } from "./course";

export interface LessonOutcome {
  /** All drills as one result (what was graded and saved). */
  result: TestResult;
  drills: TestResult[];
  grade: LessonGrade;
  /** Stars held before this run. */
  previousStars: number;
  /** The lesson had been passed before this run. */
  wasPassed: boolean;
}

export interface LessonSummaryProps {
  lesson: Lesson;
  outcome: LessonOutcome;
  layout: ParsedLayout;
  fingerColors: boolean;
  /** Lesson after this one, if any. */
  nextLesson: CourseLesson | null;
  onNext: () => void;
  onRetry: () => void;
  onCourse: () => void;
}

const fmt = (n: number) => String(Math.round(n));

function verdict(lesson: Lesson, o: LessonOutcome): { title: string; message: string } {
  const { goal } = lesson;
  const { wpm, accuracy } = o.result;
  const acc = Math.floor(accuracy);
  if (!o.grade.passed) {
    const accShort = accuracy < goal.accuracy;
    const wpmShort = wpm < goal.wpm;
    if (accShort && wpmShort)
      return { title: "Not yet", message: `The goal is ${goal.accuracy}% accuracy at ${goal.wpm} wpm. Go slower and aim for clean keystrokes first; speed follows.` };
    if (accShort)
      return { title: "Almost there", message: `Fast enough, but ${acc}% accuracy is under the ${goal.accuracy}% goal. Slow down a little and let every key land.` };
    return { title: "Almost there", message: `Accurate enough, but ${fmt(wpm)} wpm is under the ${goal.wpm} wpm goal. Keep a steady rhythm and try again.` };
  }
  if (o.grade.stars === 3) return { title: "Lesson passed", message: "Three stars: clean and quick. Nothing left to prove here." };
  const need = o.grade.stars === 2 ? { acc: 98, wpm: goal.wpm * 1.5, label: "third" } : { acc: 95, wpm: goal.wpm * 1.25, label: "second" };
  const missing: string[] = [];
  if (accuracy < need.acc) missing.push(`${need.acc}% accuracy`);
  if (wpm < need.wpm) missing.push(`${Math.ceil(need.wpm)} wpm`);
  return { title: "Lesson passed", message: `For the ${need.label} star you need ${missing.join(" and ")}.` };
}

function GoalStat({ label, value, unit, goal, met, testId, i }: { label: string; value: string; unit?: string; goal: string; met: boolean; testId: string; i: number }) {
  return (
    <div className="tt-rise" style={{ "--i": i } as CSSProperties}>
      <div className="text-sm text-sub">{label}</div>
      <div className={cx("mt-1 font-mono text-[56px] leading-none font-medium tracking-tight tabular-nums sm:text-[64px]", met ? "text-main" : "text-error")} data-testid={testId}>
        {value}
        {unit && <span className="ml-0.5 text-[0.45em] font-normal text-sub">{unit}</span>}
      </div>
      <div className={cx("mt-2 inline-flex items-center gap-1 text-xs", met ? "text-sub" : "text-error")}>
        <Icon name={met ? "check" : "x"} size={12} strokeWidth={2.2} className={met ? "text-success" : undefined} />
        goal {goal}
      </div>
    </div>
  );
}

export function LessonSummary({ lesson, outcome, layout, fingerColors, nextLesson, onNext, onRetry, onCourse }: LessonSummaryProps) {
  const { result, grade, drills } = outcome;
  const { title, message } = verdict(lesson, outcome);
  const weak = useMemo(() => weakCharsOfResult(result, 6), [result]);
  const canNext = grade.passed && nextLesson != null;
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Enter = primary action, Tab lands on it, Escape = back to the course.
  const primary = canNext ? onNext : grade.passed ? onCourse : onRetry;
  const primaryFn = useRef(primary);
  primaryFn.current = primary;
  const courseFn = useRef(onCourse);
  courseFn.current = onCourse;
  useEffect(() => {
    const mountedAt = performance.now();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (document.querySelector('[data-ll-modal], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (e.key === "Escape") {
        e.preventDefault();
        courseFn.current();
      } else if (e.key === "Enter") {
        if (t && t.closest("button, a[href], [role='button'], summary")) return;
        if (e.repeat || performance.now() - mountedAt < 450) return; // still mid-flow from the last drill
        e.preventDefault();
        primaryFn.current();
      } else if (e.key === "Tab" && !e.shiftKey && !(t && t.closest("[data-testid=lesson-summary]"))) {
        e.preventDefault();
        primaryRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const unlocked = grade.passed && !outcome.wasPassed && nextLesson;
  const improved = grade.passed && outcome.wasPassed && grade.stars > outcome.previousStars;
  const primaryLabel = canNext ? "next lesson" : grade.passed ? "back to the course" : "retry";

  return (
    <section
      className="mx-auto w-full max-w-[760px] text-center"
      data-testid="lesson-summary"
      data-passed={grade.passed ? "true" : "false"}
      data-stars={grade.stars}
      data-wpm={result.wpm}
      data-accuracy={result.accuracy}
      aria-label="Lesson result"
    >
      <Stars value={grade.stars} size={52} animate className="justify-center" data-testid="lesson-stars" />
      <h2 className="tt-rise mt-5 text-2xl font-semibold tracking-tight text-text" style={{ "--i": 1 } as CSSProperties} data-testid="lesson-verdict">
        {title}
      </h2>
      <p className="tt-rise mx-auto mt-1.5 max-w-md text-[15px] text-sub" style={{ "--i": 2 } as CSSProperties}>
        {message}
      </p>

      <div className="mx-auto mt-7 grid max-w-md grid-cols-2 gap-6">
        <GoalStat i={3} label="wpm" value={fmt(result.wpm)} goal={`${lesson.goal.wpm} wpm`} met={result.wpm >= lesson.goal.wpm} testId="summary-wpm" />
        <GoalStat
          i={4}
          label="accuracy"
          value={String(Math.floor(result.accuracy))}
          unit="%"
          goal={`${lesson.goal.accuracy}%`}
          met={result.accuracy >= lesson.goal.accuracy}
          testId="summary-acc"
        />
      </div>

      <div className="tt-rise mt-7 grid gap-x-8 gap-y-5 border-t border-border pt-5 text-left sm:grid-cols-2" style={{ "--i": 5 } as CSSProperties}>
        <div data-testid="summary-weak-keys">
          <div className="text-xs text-sub">Keys to work on</div>
          {weak.length === 0 ? (
            <div className="mt-2 text-sm text-text">None this time: a clean, even run.</div>
          ) : (
            <ul className="mt-2 flex flex-wrap items-center gap-2">
              {weak.map((k) => {
                const g = guideForChar(layout, k.char);
                const fc = fingerColors && g && g.fingerIndex >= 0 ? `var(--finger-${g.fingerIndex})` : "var(--key-border)";
                return (
                  <li
                    key={k.char}
                    data-testid="weak-key"
                    data-char={k.char}
                    title={`${charLabel(k.char)}: ${k.misses} ${k.misses === 1 ? "miss" : "misses"} in ${k.hits + k.misses}${g?.fingerName ? ` (${g.fingerName})` : ""}`}
                    className="flex items-center gap-1.5 rounded-ui-sm bg-text/[0.05] py-1 pr-2 pl-1"
                  >
                    <span
                      className="inline-flex size-7 items-center justify-center rounded-[6px] border border-b-[3px] border-key-border bg-key-bg font-mono text-sm font-medium text-text"
                      style={{ borderBottomColor: fc }}
                    >
                      {charLabel(k.char)}
                    </span>
                    <span className={cx("font-mono text-xs tabular-nums", k.misses > 0 ? "text-error" : "text-sub")}>
                      {k.misses > 0 ? `${Math.round(k.accuracy)}%` : k.avgMs != null ? `${k.avgMs}ms` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div data-testid="summary-drills">
          <div className="text-xs text-sub">Drills</div>
          <ol className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            {drills.map((d, i) => (
              <li key={i} className="flex items-baseline gap-2 font-mono text-sm tabular-nums">
                <span className="text-xs text-sub">{i + 1}</span>
                <span className={d.accuracy >= lesson.goal.accuracy ? "text-text" : "text-error"}>{Math.floor(d.accuracy)}%</span>
                <span className="text-sub">{fmt(d.wpm)} wpm</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {(unlocked || improved || (grade.passed && !nextLesson)) && (
        <p className="tt-rise mt-5 inline-flex items-center gap-2 rounded-full bg-main/[0.12] px-3.5 py-1.5 text-[13px] text-main" style={{ "--i": 6 } as CSSProperties} data-testid="summary-note">
          <Icon name={unlocked ? "zap" : "trophy"} size={14} />
          {unlocked
            ? `Unlocked lesson ${unlocked.number}: ${unlocked.lesson.title}`
            : !nextLesson
              ? "That was the last lesson. You know the whole layout."
              : `New best: ${grade.stars} stars (was ${outcome.previousStars})`}
        </p>
      )}

      <div className="tt-rise mt-6 flex flex-wrap items-center justify-center gap-2" style={{ "--i": 7 } as CSSProperties}>
        {canNext && (
          <Button ref={primaryRef} variant="primary" iconRight="arrow-right" onClick={onNext} data-testid="lesson-next">
            Next lesson
          </Button>
        )}
        <Button ref={canNext || grade.passed ? undefined : primaryRef} variant={grade.passed ? "ghost" : "primary"} icon="restart" onClick={onRetry} data-testid="lesson-retry">
          {grade.passed ? "Retry" : "Try again"}
        </Button>
        <Button ref={!canNext && grade.passed ? primaryRef : undefined} variant={!canNext && grade.passed ? "primary" : "ghost"} icon="graduation" onClick={onCourse} data-testid="lesson-course">
          Back to course
        </Button>
      </div>
      <p className="tt-rise mt-4 hidden items-center justify-center gap-1.5 text-xs text-sub sm:flex" style={{ "--i": 8 } as CSSProperties}>
        <Kbd size="sm">enter</Kbd>
        <span className="mr-3">{primaryLabel}</span>
        <Kbd size="sm">esc</Kbd>
        <span>course</span>
      </p>
    </section>
  );
}

export default LessonSummary;
