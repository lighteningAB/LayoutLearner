"use client";
// End of a lesson: stars, pass / fail against the goal, what to improve, where to go next.
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { guideForChar } from "@/components/typing/KeyboardGuide";
import { weakCharsOfResult } from "@/components/typing/practice";
import { Badge, Button, Icon, Kbd, cx } from "@/components/ui";
import type { Lesson, LessonGrade } from "@/lib/lessons/curriculum";
import type { TestResult } from "@/lib/typing/engine";
import type { ParsedLayout } from "@/lib/types";
import { KeyChip, Stars, charLabel } from "./bits";
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

/** "met" / "under" with its drawn mark: goal state in text and shape, not only colour. */
function GoalMark({ met, className }: { met: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap", met ? "text-text" : "text-error", className)}>
      <Icon name={met ? "check" : "x"} size={13} strokeWidth={2.2} />
      {met ? "met" : "under"}
    </span>
  );
}

function GoalStat({ label, value, unit, goal, met, testId, i }: { label: string; value: string; unit?: string; goal: string; met: boolean; testId: string; i: number }) {
  return (
    <div className="tt-rise min-w-0 px-3 py-4 first:pl-0 sm:px-5" style={{ "--i": i } as CSSProperties}>
      <div className="ll-lettering text-sub">{label}</div>
      <div className={cx("ll-numeral mt-3 text-5xl sm:text-7xl", met ? "text-text" : "text-error")} data-testid={testId}>
        {value}
        {unit && <span className="ml-1 text-[0.4em] text-sub">{unit}</span>}
      </div>
      <div className="ll-lettering-sm mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sub">
        <span>
          goal <span className="ll-readout text-sm tracking-normal text-text normal-case">{goal}</span>
        </span>
        <GoalMark met={met} />
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

  const nextUp = grade.passed && !outcome.wasPassed && nextLesson;
  const improved = grade.passed && outcome.wasPassed && grade.stars > outcome.previousStars;
  const primaryLabel = canNext ? "next lesson" : grade.passed ? "back to the course" : "retry";
  const goalAcc = lesson.goal.accuracy;
  const goalWpm = lesson.goal.wpm;

  return (
    <section
      className="grid w-full items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_440px]"
      data-testid="lesson-summary"
      data-passed={grade.passed ? "true" : "false"}
      data-stars={grade.stars}
      data-wpm={result.wpm}
      data-accuracy={result.accuracy}
      aria-label="Lesson result"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Stars value={grade.stars} size={44} animate data-testid="lesson-stars" />
          <Badge tone={grade.passed ? "main" : "neutral"} icon={grade.passed ? "check" : "x"} className={grade.passed ? undefined : "border-dashed text-text"}>
            {grade.passed ? `${grade.stars} of 3 stars` : "not passed"}
          </Badge>
        </div>
        <h2 className="tt-rise ll-title mt-5 text-text" style={{ "--i": 1 } as CSSProperties} data-testid="lesson-verdict">
          {title}
        </h2>
        <p className="tt-rise mt-3 max-w-[52ch] text-lg leading-[1.45] text-sub" style={{ "--i": 2 } as CSSProperties}>
          {message}
        </p>

        <div className="mt-6 grid grid-cols-2 divide-x divide-border border-y border-border">
          <GoalStat i={3} label="speed" value={fmt(result.wpm)} unit="wpm" goal={`${goalWpm} wpm`} met={result.wpm >= goalWpm} testId="summary-wpm" />
          <GoalStat i={4} label="accuracy" value={String(Math.floor(result.accuracy))} unit="%" goal={`${goalAcc}%`} met={result.accuracy >= goalAcc} testId="summary-acc" />
        </div>

        {(nextUp || improved || (grade.passed && !nextLesson)) && (
          <p className="tt-rise mt-5 flex items-center gap-2 text-base text-text" style={{ "--i": 6 } as CSSProperties} data-testid="summary-note">
            <Icon name={nextUp ? "arrow-right" : "trophy"} size={15} className="shrink-0 text-main" />
            {nextUp
              ? `Next up: lesson ${nextUp.number}, ${nextUp.lesson.title}`
              : !nextLesson
                ? "That was the last lesson. You know the whole layout."
                : `New best: ${grade.stars} stars (was ${outcome.previousStars})`}
          </p>
        )}

        <div className="tt-rise mt-6 flex flex-wrap items-center gap-2" style={{ "--i": 7 } as CSSProperties}>
          {canNext && (
            <Button ref={primaryRef} variant="primary" size="lg" iconRight="arrow-right" onClick={onNext} data-testid="lesson-next">
              Next lesson
            </Button>
          )}
          <Button
            ref={canNext || grade.passed ? undefined : primaryRef}
            variant={grade.passed ? "subtle" : "primary"}
            size="lg"
            icon="restart"
            onClick={onRetry}
            data-testid="lesson-retry"
          >
            {grade.passed ? "Retry" : "Try again"}
          </Button>
          <Button
            ref={!canNext && grade.passed ? primaryRef : undefined}
            variant={!canNext && grade.passed ? "primary" : "ghost"}
            size="lg"
            icon="graduation"
            onClick={onCourse}
            data-testid="lesson-course"
          >
            Back to course
          </Button>
        </div>
        <p className="tt-rise mt-4 hidden items-center gap-1.5 text-sm text-sub sm:flex" style={{ "--i": 8 } as CSSProperties}>
          <Kbd size="sm">enter</Kbd>
          <span className="mr-3">{primaryLabel}</span>
          <Kbd size="sm">esc</Kbd>
          <span>course</span>
        </p>
      </div>

      <div className="tt-rise min-w-0 border border-line bg-bg-alt" style={{ "--i": 5 } as CSSProperties}>
        <div className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
          <span className="ll-lettering text-text">Run log</span>
          <span className="ll-lettering-sm text-sub">
            goal{" "}
            <span className="ll-readout text-sm tracking-normal text-text normal-case">
              {goalAcc}% · {goalWpm} wpm
            </span>
          </span>
        </div>
        <table className="w-full border-collapse text-left" data-testid="summary-drills">
          <thead>
            <tr className="ll-lettering-sm border-b border-border text-sub">
              <th scope="col" className="px-4 py-2 font-semibold">
                Drill
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Accuracy
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold">
                Speed
              </th>
              <th scope="col" className="px-4 py-2 text-right font-semibold">
                Goal
              </th>
            </tr>
          </thead>
          <tbody className="ll-readout text-base">
            {drills.map((d, i) => (
              <tr key={i} className="border-b border-hairline">
                <th scope="row" className="px-4 py-2 font-medium text-sub">
                  {i + 1}
                </th>
                <td className={cx("px-2 py-2 text-right", d.accuracy >= goalAcc ? "text-text" : "text-error")}>{Math.floor(d.accuracy)}%</td>
                <td className={cx("px-2 py-2 text-right", d.wpm >= goalWpm ? "text-text" : "text-error")}>{fmt(d.wpm)} wpm</td>
                <td className="px-4 py-2">
                  <GoalMark met={d.accuracy >= goalAcc && d.wpm >= goalWpm} className="ll-lettering-sm w-full justify-end" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="ll-readout text-base font-medium text-text">
            <tr className="border-t border-line">
              <th scope="row" className="ll-lettering-sm px-4 py-2.5 text-text">
                All
              </th>
              <td className="px-2 py-2.5 text-right">{Math.floor(result.accuracy)}%</td>
              <td className="px-2 py-2.5 text-right">{fmt(result.wpm)} wpm</td>
              <td className="px-4 py-2.5">
                <GoalMark met={grade.passed} className="ll-lettering-sm w-full justify-end" />
              </td>
            </tr>
          </tfoot>
        </table>

        <div className="border-t border-line p-4" data-testid="summary-weak-keys">
          <div className="ll-lettering-sm text-sub">Keys to work on</div>
          {weak.length === 0 ? (
            <div className="mt-2 text-base text-text">None this time: a clean, even run.</div>
          ) : (
            <ul className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              {weak.map((k) => {
                const g = guideForChar(layout, k.char);
                return (
                  <li
                    key={k.char}
                    data-testid="weak-key"
                    data-char={k.char}
                    title={`${charLabel(k.char)}: ${k.misses} ${k.misses === 1 ? "miss" : "misses"} in ${k.hits + k.misses}${g?.fingerName ? ` (${g.fingerName})` : ""}`}
                    className="flex items-center gap-2"
                  >
                    <KeyChip char={k.char} layout={layout} fingerColors={fingerColors} size="md" />
                    <span className="ll-readout text-sm text-text">
                      {k.misses > 0 ? `${Math.round(k.accuracy)}%` : k.avgMs != null ? `${k.avgMs}ms` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default LessonSummary;
