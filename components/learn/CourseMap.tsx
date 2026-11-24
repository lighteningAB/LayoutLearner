"use client";
// Route /learn: the course of the active layout as a drawing sheet: ruled lesson cells per section,
// a drafted progress scale, and a DETAIL box for the selected lesson.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { fingerName, guideForChar } from "@/components/typing/KeyboardGuide";
import "@/components/typing/typing.css";
import { Badge, Button, Card, Icon, Kbd, Skeleton, cx } from "@/components/ui";
import { PRESETS } from "@/lib/layout/presets";
import { parsePreset } from "@/lib/layout/layers";
import { buildCurriculum, validateCurriculum } from "@/lib/lessons/curriculum";
import { useSettings } from "@/lib/settings";
import type { ParsedLayout } from "@/lib/types";
import { DetailNumber, KeyChip, KeyChips, ReadoutCell, Stars, charLabel } from "./bits";
import { dimKeyIdsFor, lessonHref, useCourse, type CourseLesson } from "./course";
import { LearnCommands } from "./LearnCommands";
import { useHydrated } from "./useHydrated";
import "./learn.css";

const pad2 = (n: number) => String(n).padStart(2, "0");
const attempted = (item: CourseLesson) => !!item.entry && item.entry.attempts > 0;

/** Shared column grid of the lesson cells (and of their placeholder). */
const CELL_GRID = "grid grid-cols-1 border-t border-l border-border sm:grid-cols-2 xl:grid-cols-3";

// ────────────────────────────────────────────────────────────────────────── cell

/** DONE / NEXT / RETRY: the lettered state of a lesson (never colour alone). */
function StateTag({ item }: { item: CourseLesson }) {
  if (item.state === "completed") return <Badge icon="check">Done</Badge>;
  if (item.state === "current") return <Badge tone="main">Next</Badge>;
  if (attempted(item)) return <Badge className="border-dashed">Retry</Badge>;
  return null;
}

function LessonTile({
  item,
  layout,
  fingerColors,
  selected,
  onSelect,
}: {
  item: CourseLesson;
  layout: ParsedLayout;
  fingerColors: boolean;
  selected: boolean;
  onSelect: (item: CourseLesson) => void;
}) {
  const { lesson, state, entry } = item;
  const review = lesson.kind === "review";
  return (
    <button
      type="button"
      data-testid="lesson-tile"
      data-lesson-id={lesson.id}
      data-state={state}
      data-stars={item.stars}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      aria-label={`Lesson ${item.number}: ${lesson.title} (${state}${item.passed ? `, ${item.stars} of 3 stars` : ""})`}
      onClick={() => onSelect(item)}
      className="learn-cell relative grid min-h-[136px] min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 border-r border-b border-border p-4 text-left"
    >
      <span className="flex flex-col items-center">
        <DetailNumber n={item.number} tone={state === "current" ? "main" : state === "completed" ? "line" : "quiet"} dashed={review && state !== "completed"} />
        <span aria-hidden className={cx("mt-1.5 w-px flex-1", state === "current" ? "bg-main" : "bg-border")} />
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="flex min-h-9 items-center justify-between gap-2">
          <span className="truncate text-[18px] leading-tight font-semibold text-text">{item.shortTitle}</span>
          <StateTag item={item} />
        </span>

        <span className="mt-1.5 flex h-[22px] items-center gap-1.5">
          {lesson.stage === "layer" && <Icon name="layers" size={14} className="shrink-0 text-sub" />}
          {lesson.newChars.length > 0 ? (
            <KeyChips chars={lesson.newChars} layout={layout} fingerColors={fingerColors} max={7} />
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[14px] text-sub">
              <Icon name="restart" size={13} />
              {lesson.chars.length} keys so far
            </span>
          )}
        </span>

        <span className="mt-auto flex items-end justify-between gap-2 pt-3">
          <Stars value={item.stars} size={15} />
          {entry && entry.attempts > 0 && (
            <span className="ll-readout truncate text-[12px] text-sub" title="Best speed and accuracy">
              {Math.round(entry.bestWpm)} wpm · {Math.floor(entry.bestAccuracy)}%
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────── detail box

function LessonPreview({
  item,
  layout,
  fingerColors,
  onStart,
}: {
  item: CourseLesson;
  layout: ParsedLayout;
  fingerColors: boolean;
  onStart: () => void;
}) {
  const { lesson, entry } = item;
  const dim = useMemo(() => dimKeyIdsFor(layout, lesson), [layout, lesson]);
  const highlight = lesson.kind === "new" ? lesson.focusKeyIds : NONE;
  const newKeys = useMemo(
    () =>
      lesson.newChars.map((c) => {
        const g = guideForChar(layout, c);
        return { char: c, finger: g?.finger ? fingerName(g.finger) : "", layer: g?.layer?.name ?? "", shift: !!g?.shiftKey };
      }),
    [layout, lesson],
  );
  const tried = attempted(item);

  return (
    <section
      className="border border-line bg-bg-alt"
      data-testid="lesson-preview"
      data-lesson-id={lesson.id}
      data-state={item.state}
      aria-label={`Lesson ${item.number}: ${lesson.title}`}
    >
      <div className="flex h-10 items-center justify-between gap-3 border-b border-line px-4">
        <span className="ll-lettering min-w-0 truncate text-text">
          Lesson <span className="ll-readout ml-1 text-[13px] tracking-normal">{pad2(item.number)}</span>
        </span>
        <span className="ll-lettering-sm truncate text-sub">{lesson.kind === "new" ? "new keys" : "review"}</span>
      </div>

      <div className="tt-guide learn-minikb ll-grid border-b border-line bg-bg px-3 py-5" data-finger-colors={fingerColors ? "true" : "false"}>
        <Keyboard2D layout={layout} highlightKeyIds={highlight} dimUnused={dim} fingerColors={fingerColors} maxUnit={30} />
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[22px] leading-[1.15] font-semibold tracking-[0.1em] text-balance text-text uppercase">{lesson.title}</h2>
          <span className="flex h-[26px] shrink-0 items-center">
            {item.state === "completed" ? (
              <Stars value={item.stars} size={16} />
            ) : item.state === "current" ? (
              <Badge tone="main">next up</Badge>
            ) : tried ? (
              <Badge className="border-dashed">Retry</Badge>
            ) : null}
          </span>
        </div>
        <p className="mt-2.5 text-[15px] leading-normal text-sub">{lesson.description}</p>

        {newKeys.length > 0 && (
          <div className="mt-5">
            <div className="ll-lettering-sm text-sub">New keys</div>
            {newKeys.length <= 4 ? (
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                {newKeys.map((k) => (
                  <li key={k.char} className="flex min-w-0 items-center gap-2.5">
                    <KeyChip char={k.char} layout={layout} fingerColors={fingerColors} size="md" />
                    <span className="min-w-0 truncate text-[14px] leading-tight text-text" title={k.finger || undefined}>
                      {k.finger || "any finger"}
                      {k.layer ? `, ${k.layer}` : k.shift ? ", shift" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {newKeys.map((k) => (
                  <span key={k.char} className="inline-flex" title={k.finger ? `${charLabel(k.char)}: ${k.finger}` : undefined}>
                    <KeyChip char={k.char} layout={layout} fingerColors={fingerColors} size="md" />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <dl className="mt-5 grid grid-cols-3 divide-x divide-border border border-border">
          <ReadoutCell label="goal" data-testid="lesson-goal">
            {lesson.goal.accuracy}%<span className="text-sub"> · </span>
            {lesson.goal.wpm}
            <span className="text-sub"> wpm</span>
          </ReadoutCell>
          <ReadoutCell label="best">
            {tried && entry ? (
              <>
                {Math.floor(entry.bestAccuracy)}%<span className="text-sub"> · </span>
                {Math.round(entry.bestWpm)}
                <span className="text-sub"> wpm</span>
              </>
            ) : (
              <span className="text-sub">not yet</span>
            )}
          </ReadoutCell>
          <ReadoutCell label="length">
            {lesson.drills.length}
            <span className="text-sub"> drills</span>
          </ReadoutCell>
        </dl>

        <div className="mt-5">
          <Button variant="primary" size="lg" fullWidth onClick={onStart} data-testid="lesson-start" data-lesson-id={lesson.id} className="justify-between px-5">
            <span className="ll-trim">{item.passed ? "Practise again" : tried ? "Try again" : "Start lesson"}</span>
            <span className="flex items-center gap-2.5">
              <Kbd
                size="sm"
                title="Enter starts the selected lesson"
                className="hidden border-main-fg bg-main-fg text-main group-hover/btn:border-bg group-hover/btn:bg-bg group-hover/btn:text-text lg:inline-flex"
              >
                enter
              </Kbd>
              <Icon name="arrow-right" size={20} />
            </span>
          </Button>
        </div>
      </div>
    </section>
  );
}

const NONE: string[] = [];

// ────────────────────────────────────────────────────────────────────────── progress scale

/**
 * The course as one dimension line: a ticked scale with one tick per lesson (passed ones drawn
 * heavy in the action colour), the lesson and star counts set as annotations at its ends.
 */
function ProgressScale({ completed, total, stars, maxStars }: { completed: number; total: number; stars: number; maxStars: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 whitespace-nowrap">
        <span className="ll-lettering-sm text-sub">
          lessons <span className="ll-readout text-[15px] tracking-normal text-text">{completed}/{total}</span>
        </span>
        <span className="ll-lettering-sm text-sub">
          stars <span className="ll-readout text-[15px] tracking-normal text-text">{stars}/{maxStars}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Course progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={completed}
        aria-valuetext={`${completed} of ${total} lessons passed`}
        className="relative mt-2 flex h-4 items-end border-x border-line"
      >
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-line" />
        {Array.from({ length: total }, (_, i) => (
          <span key={i} aria-hidden className={cx("relative flex-1 border-l", i === 0 && "border-l-0", i < completed ? "h-4 border-main" : "h-2 border-border")} />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────── page

/**
 * Placeholder shown until storage-backed state is read. It mirrors the real page (progress scale,
 * one block per stage, same cell grid and heights, the detail box) using the stage sizes of the
 * course known at that point (the default layout's), so the page is already close to its final
 * height and the footer does not jump when the real list replaces it.
 */
function CourseSkeleton({ stages }: { stages: { stage: string; items: unknown[] }[] }) {
  return (
    <>
      <div aria-hidden data-testid="course-skeleton" className="lg:col-start-1 lg:row-start-2">
        <div className="space-y-10">
          {stages.map((stage, si) => (
            <div key={`${stage.stage}-${si}`}>
              <Skeleton animate className="mb-4 h-[23px] w-48" />
              <div className={CELL_GRID}>
                {stage.items.map((_, i) => (
                  <div key={i} className="h-[136px] border-r border-b border-border p-4">
                    <Skeleton animate className="size-9 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Skeleton aria-hidden animate className="h-[560px] lg:col-start-2 lg:row-span-2 lg:row-start-1" />
    </>
  );
}

/** Dev-only: `window.__learnCheck()` runs validateCurriculum over every preset. */
function useDevCurriculumCheck() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __learnCheck?: () => unknown };
    w.__learnCheck = () =>
      PRESETS.map((p) => {
        const layout = parsePreset(p);
        const lessons = buildCurriculum(layout);
        return {
          preset: p.id,
          lessons: lessons.length,
          drills: lessons.reduce((n, l) => n + l.drills.length, 0),
          stages: Array.from(new Set(lessons.map((l) => l.stage))).join(","),
          problems: validateCurriculum(layout, lessons),
        };
      });
    return () => {
      delete w.__learnCheck;
    };
  }, []);
}

export function CourseMap() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [settings] = useSettings();
  const { active, course } = useCourse();
  const layout = active.layout;
  const fingerColors = settings.fingerColors;
  useDevCurriculumCheck();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Forget the selection when the layout changes: ids belong to one curriculum.
  const layoutId = active.id;
  useEffect(() => setSelectedId(null), [layoutId]);
  const selected = (selectedId ? course.byId.get(selectedId) : null) ?? course.next ?? course.lessons[course.lessons.length - 1] ?? null;

  const previewRef = useRef<HTMLDivElement>(null);
  const start = useCallback(
    (item: CourseLesson | null) => {
      if (item) router.push(lessonHref(item.lesson.id));
    },
    [router],
  );
  const onSelect = useCallback(
    (item: CourseLesson) => {
      if (selected && item.lesson.id === selected.lesson.id && selectedId != null) {
        start(item); // second click on the selected cell starts it
        return;
      }
      setSelectedId(item.lesson.id);
      // Stacked layout: the detail box sits above the list, bring it into view.
      if (window.matchMedia("(max-width: 1023px)").matches) {
        window.requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    },
    [selected, selectedId, start],
  );

  // Enter starts the selected lesson (unless a control has focus and handles it itself).
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (document.querySelector('[data-ll-modal], [role="dialog"], [role="menu"], [role="listbox"]')) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && t.closest("button, a[href], input, textarea, select, [role='button'], [role='switch'], [role='radio'], summary")) return;
      e.preventDefault();
      start(selectedRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [start]);

  const next = course.next;
  const ready = hydrated && course.total > 0;

  return (
    <div
      className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_400px]"
      data-testid="course"
      data-layout={active.id}
      data-ready={hydrated ? "true" : "false"}
      data-total={course.total}
      data-completed={course.completed}
    >
      <LearnCommands />

      {/* ── heading line, description, primary action; the progress scale beside them ── */}
      <header className="grid min-w-0 items-end gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <h1 className="ll-title text-text">Learn</h1>
            <div className="ll-lettering min-h-[15px] min-w-0 pb-1.5 text-sub sm:pb-2.5">{hydrated ? active.name : " "}</div>
          </div>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.45] text-sub">
            A few keys at a time, from the home row out. Start anywhere; the highlighted lesson is the suggested next step.
          </p>
          <div className="mt-6 flex min-h-12 items-center">
            {ready &&
              (next ? (
                <Button variant="primary" size="lg" href={lessonHref(next.lesson.id)} data-testid="course-continue" className="max-w-full gap-3 max-sm:w-full max-sm:px-4">
                  <span className="ll-trim">
                    {course.completed === 0 ? "Start" : "Continue"} lesson {next.number}
                  </span>
                  <span className="ll-readout min-w-0 truncate bg-main-fg px-2 py-1 text-[13px] leading-none font-medium tracking-normal text-main normal-case group-hover/btn:bg-bg group-hover/btn:text-text">
                    {next.shortTitle}
                  </span>
                  <Icon name="arrow-right" size={20} className="shrink-0" />
                </Button>
              ) : (
                <Button variant="subtle" size="lg" icon="trophy" href="/" data-testid="course-continue">
                  Course complete: take a test
                </Button>
              ))}
          </div>
        </div>

        {ready ? (
          <div
            className="min-w-0"
            data-testid="course-progress"
            data-completed={course.completed}
            data-total={course.total}
            data-stars={course.stars}
            data-max-stars={course.maxStars}
          >
            <ProgressScale completed={course.completed} total={course.total} stars={course.stars} maxStars={course.maxStars} />
            <p className="mt-3 truncate text-[14px] text-sub">
              {next ? (
                <>
                  <span className="ll-lettering-sm mr-2">Next</span>
                  <span className="text-text">
                    {next.number}. {next.lesson.title}
                  </span>
                </>
              ) : (
                "Every lesson passed."
              )}
            </p>
          </div>
        ) : (
          !hydrated && <Skeleton aria-hidden animate className="h-[84px] w-full" />
        )}
      </header>

      {!hydrated ? (
        <CourseSkeleton stages={course.stages} />
      ) : course.total === 0 ? (
        <Card className="flex flex-col items-start gap-3" data-testid="course-empty">
          <h2 className="ll-lettering-lg text-text">No lessons for {active.name}</h2>
          <p className="max-w-lg text-[15px] text-sub">
            This layout has no letter keys a course could be built from. Pick another layout, or edit this one so its keys carry letters.
          </p>
          <Button href="/layouts" icon="layers">
            Choose a layout
          </Button>
        </Card>
      ) : (
        <>
          <div ref={previewRef} className="min-w-0 scroll-mt-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            {selected && <LessonPreview item={selected} layout={layout} fingerColors={fingerColors} onStart={() => start(selected)} />}
          </div>

          <div className="min-w-0 space-y-10 lg:col-start-1 lg:row-start-2" data-testid="course-stages">
            {course.stages.map((stage, si) => {
              const complete = stage.completed === stage.items.length;
              return (
                <section key={`${stage.stage}-${si}`} data-testid="course-stage" data-stage={stage.stage} aria-label={stage.name}>
                  <div className="mb-4 flex items-center gap-4">
                    <h2 className="ll-heading shrink-0 text-text">{stage.name}</h2>
                    <span aria-hidden className="h-px min-w-6 flex-1 bg-border" />
                    <span className="ll-lettering-sm inline-flex shrink-0 items-center gap-1.5 text-sub">
                      {complete && <Icon name="check" size={13} className="text-text" />}
                      <span className="ll-readout text-[12px] tracking-normal text-text">
                        {stage.completed}/{stage.items.length}
                      </span>
                      {complete ? "complete" : "passed"}
                    </span>
                  </div>
                  <div className={CELL_GRID}>
                    {stage.items.map((item) => (
                      <LessonTile
                        key={item.lesson.id}
                        item={item}
                        layout={layout}
                        fingerColors={fingerColors}
                        selected={selected?.lesson.id === item.lesson.id}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default CourseMap;
