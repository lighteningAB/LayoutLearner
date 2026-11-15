"use client";
// Route /learn: the course of the active layout as a path of lesson tiles, with a preview panel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { PageHeader } from "@/components/shell";
import { fingerName, guideForChar } from "@/components/typing/KeyboardGuide";
import "@/components/typing/typing.css";
import { Badge, Button, Card, Icon, ProgressBar, Skeleton, Toggle, cx } from "@/components/ui";
import { PRESETS } from "@/lib/layout/presets";
import { parseLayout } from "@/lib/layout/parse";
import { buildCurriculum, validateCurriculum } from "@/lib/lessons/curriculum";
import { useSettings } from "@/lib/settings";
import type { ParsedLayout } from "@/lib/types";
import { KeyChip, KeyChips, LockIcon, Stars } from "./bits";
import { dimKeyIdsFor, lessonHref, useCourse, type CourseLesson } from "./course";
import { LearnCommands } from "./LearnCommands";
import { useHydrated } from "./useHydrated";
import "./learn.css";

const pad2 = (n: number) => String(n).padStart(2, "0");

// ────────────────────────────────────────────────────────────────────────── tile

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
  const locked = state === "locked";
  return (
    <button
      type="button"
      data-testid="lesson-tile"
      data-lesson-id={lesson.id}
      data-state={state}
      data-stars={item.stars}
      data-unlocked={item.unlocked ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      aria-pressed={selected}
      aria-label={`Lesson ${item.number}: ${lesson.title} (${state}${item.passed ? `, ${item.stars} of 3 stars` : ""})`}
      onClick={() => onSelect(item)}
      className={cx(
        "learn-tile relative flex min-h-[112px] min-w-0 flex-col rounded-ui-lg border p-3 text-left",
        locked ? "border-dashed border-border bg-transparent" : "bg-bg-alt",
        !locked && (state === "current" ? "border-main/70" : "border-transparent"),
        selected && "outline-2 outline-offset-2 outline-main",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={cx("font-mono text-[11px] tabular-nums", state === "current" ? "text-main" : "text-sub")}>{pad2(item.number)}</span>
        {state === "completed" && (
          <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-success/[0.16] text-success">
            <Icon name="check" size={12} strokeWidth={2.4} />
          </span>
        )}
        {state === "current" && (
          <span className="inline-flex h-[18px] items-center gap-1 rounded-full bg-main/[0.14] px-1.5 text-[10px] font-semibold tracking-wide text-main uppercase">
            next
          </span>
        )}
        {locked && <LockIcon size={13} className="text-sub/70" />}
      </span>

      <span className={cx("mt-1.5 truncate text-sm font-medium", locked ? "text-sub" : "text-text")}>{item.shortTitle}</span>

      <span className="mt-2 flex h-[22px] items-center">
        {lesson.newChars.length > 0 ? (
          <KeyChips chars={lesson.newChars} layout={layout} fingerColors={fingerColors} max={6} muted={locked} />
        ) : (
          <span className={cx("inline-flex items-center gap-1 text-xs text-sub", locked && "opacity-60")}>
            <Icon name="restart" size={12} />
            review
          </span>
        )}
      </span>

      <span className="mt-auto flex items-end justify-between gap-2 pt-2.5">
        <Stars value={item.stars} size={13} className={locked ? "opacity-40" : undefined} />
        {entry && entry.attempts > 0 && (
          <span className="truncate font-mono text-[11px] text-sub tabular-nums" title="Best speed and accuracy">
            {Math.round(entry.bestWpm)}
            <span className="opacity-60"> wpm · </span>
            {Math.floor(entry.bestAccuracy)}%
          </span>
        )}
      </span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────── preview

function LessonPreview({
  item,
  previous,
  layout,
  fingerColors,
  onStart,
}: {
  item: CourseLesson;
  previous: CourseLesson | null;
  layout: ParsedLayout;
  fingerColors: boolean;
  onStart: () => void;
}) {
  const { lesson, entry } = item;
  const dim = useMemo(() => dimKeyIdsFor(layout, lesson), [layout, lesson]);
  const highlight = lesson.kind === "new" ? lesson.focusKeyIds : NONE;
  const fingers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of lesson.newChars) {
      const g = guideForChar(layout, c);
      if (g?.finger) seen.set(fingerName(g.finger), `var(--finger-${g.fingerIndex})`);
    }
    return Array.from(seen.entries());
  }, [layout, lesson]);

  return (
    <Card
      as="section"
      padding="none"
      className="p-5"
      data-testid="lesson-preview"
      data-lesson-id={lesson.id}
      data-state={item.state}
      aria-label={`Lesson ${item.number}: ${lesson.title}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-main">
          lesson {item.number} · {lesson.kind === "new" ? "new keys" : "review"}
        </span>
        {item.state === "completed" && <Stars value={item.stars} size={15} />}
        {item.state === "locked" && (
          <Badge>
            <LockIcon size={11} />
            locked
          </Badge>
        )}
        {item.state === "current" && <Badge tone="main">next up</Badge>}
      </div>
      <h2 className="mt-2 text-lg leading-snug font-semibold tracking-tight text-text">{lesson.title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-sub">{lesson.description}</p>

      <div className="tt-guide mt-4 rounded-ui bg-bg p-3" data-finger-colors={fingerColors ? "true" : "false"}>
        <Keyboard2D layout={layout} highlightKeyIds={highlight} dimUnused={dim} fingerColors={fingerColors} maxUnit={26} />
      </div>

      {lesson.newChars.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-sub">New keys</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {lesson.newChars.map((c) => (
              <KeyChip key={c} char={c} layout={layout} fingerColors={fingerColors} size="md" />
            ))}
          </div>
          {fingers.length > 0 && fingers.length <= 4 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sub">
              {fingers.map(([name, color]) => (
                <span key={name} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: fingerColors ? color : "var(--sub)" }} />
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
        <div>
          <dt className="text-xs text-sub">goal</dt>
          <dd className="mt-1 font-mono text-sm text-text tabular-nums" data-testid="lesson-goal">
            {lesson.goal.accuracy}%<span className="text-sub"> · </span>
            {lesson.goal.wpm}
            <span className="text-sub"> wpm</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-sub">best</dt>
          <dd className="mt-1 font-mono text-sm text-text tabular-nums">
            {entry && entry.attempts > 0 ? (
              <>
                {Math.floor(entry.bestAccuracy)}%<span className="text-sub"> · </span>
                {Math.round(entry.bestWpm)}
                <span className="text-sub"> wpm</span>
              </>
            ) : (
              <span className="text-sub">not yet</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-sub">length</dt>
          <dd className="mt-1 font-mono text-sm text-text tabular-nums">
            {lesson.drills.length}
            <span className="text-sub"> drills</span>
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        {item.unlocked ? (
          <Button variant="primary" fullWidth iconRight="arrow-right" onClick={onStart} data-testid="lesson-start" data-lesson-id={lesson.id}>
            {item.passed ? "Practise again" : entry && entry.attempts > 0 ? "Try again" : "Start lesson"}
          </Button>
        ) : (
          <>
            <Button variant="subtle" fullWidth disabled data-testid="lesson-start" data-lesson-id={lesson.id}>
              <LockIcon size={15} />
              Locked
            </Button>
            <p className="mt-2 text-center text-xs text-sub">
              {previous ? `Pass lesson ${previous.number} (${previous.shortTitle}) to unlock it.` : "Pass the previous lesson to unlock it."}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

const NONE: string[] = [];

// ────────────────────────────────────────────────────────────────────────── page

function CourseSkeleton() {
  return (
    <div aria-hidden data-testid="course-skeleton">
      <Skeleton animate className="h-[76px] w-full rounded-ui-lg" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} animate className="h-[112px] rounded-ui-lg" />
          ))}
        </div>
        <Skeleton animate className="h-[420px] rounded-ui-lg" />
      </div>
    </div>
  );
}

/** Dev-only: `window.__learnCheck()` runs validateCurriculum over every preset. */
function useDevCurriculumCheck() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __learnCheck?: () => unknown };
    w.__learnCheck = () =>
      PRESETS.map((p) => {
        const layout = parseLayout(p.source, p.name);
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
  const { active, course, unlockAll, setUnlockAll } = useCourse();
  const layout = active.layout;
  const fingerColors = settings.fingerColors;
  useDevCurriculumCheck();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Forget the selection when the layout changes: ids belong to one curriculum.
  const layoutId = active.id;
  useEffect(() => setSelectedId(null), [layoutId]);
  const selected = (selectedId ? course.byId.get(selectedId) : null) ?? course.next ?? course.lessons[course.lessons.length - 1] ?? null;
  const previous = selected && selected.number > 1 ? course.lessons[selected.number - 2] : null;

  const previewRef = useRef<HTMLDivElement>(null);
  const start = useCallback(
    (item: CourseLesson | null) => {
      if (item?.unlocked) router.push(lessonHref(item.lesson.id));
    },
    [router],
  );
  const onSelect = useCallback(
    (item: CourseLesson) => {
      if (selected && item.lesson.id === selected.lesson.id && selectedId != null) {
        start(item); // second click on the selected tile starts it
        return;
      }
      setSelectedId(item.lesson.id);
      // Stacked layout: the preview sits above the list, bring it into view.
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
  const pct = course.total > 0 ? Math.round((course.completed / course.total) * 100) : 0;

  return (
    <div data-testid="course" data-layout={active.id} data-ready={hydrated ? "true" : "false"} data-total={course.total} data-completed={course.completed}>
      <LearnCommands />
      <PageHeader
        eyebrow={hydrated ? active.name : " "}
        title="Learn"
        description="A few keys at a time, from the home row out. Pass a lesson to unlock the next one."
        actions={
          hydrated && course.total > 0 ? (
            next ? (
              <Button variant="primary" size="lg" iconRight="arrow-right" href={lessonHref(next.lesson.id)} data-testid="course-continue">
                {course.completed === 0 ? "Start" : "Continue"}
                <span className="font-normal opacity-75">
                  lesson {next.number} · {next.shortTitle}
                </span>
              </Button>
            ) : (
              <Button variant="subtle" size="lg" icon="trophy" href="/" data-testid="course-continue">
                Course complete: take a test
              </Button>
            )
          ) : undefined
        }
      />

      {!hydrated ? (
        <CourseSkeleton />
      ) : course.total === 0 ? (
        <Card className="flex flex-col items-start gap-3" data-testid="course-empty">
          <div className="text-[15px] font-semibold text-text">No lessons for {active.name}</div>
          <p className="max-w-lg text-sm text-sub">
            This layout has no letter keys a course could be built from. Pick another layout, or edit this one so its keys carry letters.
          </p>
          <Button href="/layouts" icon="layers">
            Choose a layout
          </Button>
        </Card>
      ) : (
        <>
          <Card
            padding="none"
            className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4"
            data-testid="course-progress"
            data-completed={course.completed}
            data-total={course.total}
            data-stars={course.stars}
            data-max-stars={course.maxStars}
          >
            <div>
              <div className="text-xs text-sub">lessons</div>
              <div className="mt-1 font-mono text-xl leading-none font-medium text-text tabular-nums">
                <span className="text-main">{course.completed}</span>
                <span className="text-sub">/{course.total}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-sub">stars</div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-xl leading-none font-medium text-text tabular-nums">
                <span>
                  <span className="text-main">{course.stars}</span>
                  <span className="text-sub">/{course.maxStars}</span>
                </span>
              </div>
            </div>
            <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
              <div className="flex items-baseline justify-between text-xs text-sub">
                <span>
                  {next ? (
                    <>
                      next: <span className="text-text">{next.lesson.title}</span>
                    </>
                  ) : (
                    "every lesson passed"
                  )}
                </span>
                <span className="font-mono tabular-nums">{pct}%</span>
              </div>
              <ProgressBar className="mt-2" size="md" value={course.completed} max={course.total} aria-label="Course progress" />
            </div>
            <Toggle
              size="sm"
              checked={unlockAll}
              onChange={setUnlockAll}
              data-testid="unlock-all"
              label={<span className="text-[13px] text-sub">unlock all lessons</span>}
            />
          </Card>

          <div className="mt-8 grid items-start gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-8" data-testid="course-stages">
              {course.stages.map((stage, si) => (
                <section key={`${stage.stage}-${si}`} data-testid="course-stage" data-stage={stage.stage} aria-label={stage.name}>
                  <div className="mb-3 flex items-center gap-3">
                    <h2 className="text-[15px] font-semibold tracking-tight text-text">{stage.name}</h2>
                    <span className="font-mono text-xs text-sub tabular-nums">
                      {stage.completed}/{stage.items.length}
                    </span>
                    <ProgressBar
                      className="max-w-24"
                      size="xs"
                      tone={stage.completed === stage.items.length ? "success" : "main"}
                      value={stage.completed}
                      max={stage.items.length}
                      aria-label={`${stage.name} progress`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
              ))}
            </div>

            <div ref={previewRef} className="order-first min-w-0 scroll-mt-4 lg:sticky lg:top-6 lg:order-none">
              {selected && (
                <>
                  <LessonPreview item={selected} previous={previous} layout={layout} fingerColors={fingerColors} onStart={() => start(selected)} />
                  <p className="mt-3 hidden items-center justify-center gap-1.5 text-xs text-sub lg:flex">
                    <kbd className="inline-flex h-[18px] items-center rounded-[5px] border border-b-2 border-key-border bg-key-bg px-1 font-mono text-[10px] font-medium text-key-text">
                      enter
                    </kbd>
                    start the selected lesson
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default CourseMap;
