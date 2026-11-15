"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { PageHeader } from "@/components/shell";
import { Button, Card, CardDescription, CardTitle, ConfirmDialog, Icon, IconButton, Menu, ProgressBar, SegmentedControl, Select, Skeleton, Stat, cx, toast } from "@/components/ui";
import { keyForChar } from "@/lib/layout/keys";
import { getPreset } from "@/lib/layout/presets";
import { resolveLayout, useActiveLayout } from "@/lib/layout/useActiveLayout";
import { buildCurriculum } from "@/lib/lessons/curriculum";
import { DATA_CLEARED_EVENT, getSettings, useSettings } from "@/lib/settings";
import { clearDemoData, hasDemoData, seedDemoData } from "@/lib/stats/demo";
import {
  MIN_KEY_ATTEMPTS,
  aggregateByFinger,
  aggregateByKey,
  applyImport,
  buildActivity,
  buildExport,
  computeHeadline,
  durationParts,
  formatDuration,
  readLayoutIdsWithData,
  readPracticedDays,
  runningBestIds,
  splitByRange,
  summarizeLessons,
  topMixups,
  validateImport,
  type ExportFile,
  type ImportSummary,
  type RangeId,
} from "@/lib/stats/selectors";
import { useKeyStats, useLessonProgress, usePersonalBests, useResults, useStreak, useWeakestKeys } from "@/lib/stats/store";
import { ActivityCalendar } from "./ActivityCalendar";
import { FingerBreakdown } from "./FingerBreakdown";
import { HistoryTable } from "./HistoryTable";
import { KeyHeatmap } from "./KeyHeatmap";
import { ProgressChart } from "./ProgressChart";
import { WeakKeys } from "./WeakKeys";

const RANGES: { value: RangeId; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "all" },
];
const RANGE_TEXT: Record<RangeId, string> = { "7d": "in the last 7 days", "30d": "in the last 30 days", all: "in total" };
const PREV_TEXT: Record<RangeId, string> = { "7d": "vs prior 7d", "30d": "vs prior 30d", all: "" };

const noopSubscribe = () => () => {};
/** False on the server and during hydration, true afterwards (storage-backed data is client only). */
const useMounted = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

function Delta({ value, digits = 1, unit = "", suffix }: { value: number | null; digits?: number; unit?: string; suffix: string }) {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(digits));
  const tone = rounded > 0 ? "text-success" : rounded < 0 ? "text-error" : "text-sub";
  return (
    <span data-testid="delta" data-value={rounded}>
      <span className={cx("font-mono tabular-nums", tone)}>
        {rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}
        {Math.abs(rounded).toFixed(digits)}
        {unit}
      </span>{" "}
      {suffix}
    </span>
  );
}

function StatCell({ testId, value, children }: { testId: string; value: number | string | null; children: ReactNode }) {
  return (
    <div data-testid={testId} data-value={value ?? ""} className="min-w-0">
      {children}
    </div>
  );
}

function LoadingState() {
  return (
    <div aria-busy="true" className="space-y-4">
      <Skeleton animate className="h-[104px] w-full rounded-ui-lg" />
      <Skeleton animate className="h-[360px] w-full rounded-ui-lg" />
      <Skeleton animate className="h-[380px] w-full rounded-ui-lg" />
    </div>
  );
}

function layoutName(id: string, custom: { id: string; name: string }[]): string {
  return getPreset(id)?.name ?? custom.find((c) => c.id === id)?.name ?? `${id} (removed layout)`;
}

export function StatsView() {
  const mounted = useMounted();
  const [settings] = useSettings();
  const active = useActiveLayout();
  const [, refresh] = useState(0);
  const [range, setRange] = useState<RangeId>("30d");
  const [viewId, setViewId] = useState<string | null>(null);
  const [pinnedKeyId, setPinnedKeyId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ file: ExportFile; summary: ImportSummary } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const heatRef = useRef<HTMLDivElement>(null);

  const allResults = useResults();

  // Settings → "clear all data" wipes storage without telling the stats store: re-render so
  // every useSyncExternalStore hook below re-reads (now empty) storage.
  useEffect(() => {
    const onCleared = () => {
      setViewId(null);
      setPinnedKeyId(null);
      refresh((n) => n + 1);
    };
    window.addEventListener(DATA_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(DATA_CLEARED_EVENT, onCleared);
  }, []);

  // Read on every render (two small JSON parses) so it can never go stale; keyed for memo deps.
  const idsKey = mounted ? readLayoutIdsWithData(allResults).join("\n") : "";
  const idsWithData = useMemo(() => (idsKey ? idsKey.split("\n") : []), [idsKey]);
  const layoutId = viewId != null && (idsWithData.includes(viewId) || viewId === active.id) ? viewId : active.id;
  const view = useMemo(
    () => (layoutId === active.id ? active : resolveLayout(layoutId, settings.customLayouts)),
    [layoutId, active, settings.customLayouts],
  );
  const layout = view.layout;

  const results = useMemo(() => allResults.filter((r) => r.layoutId === layoutId), [allResults, layoutId]);
  const keyStats = useKeyStats(layoutId);
  const lessonProgress = useLessonProgress(layoutId);
  const bests = usePersonalBests(layoutId);
  const streak = useStreak();
  const weakestAll = useWeakestKeys(layoutId, 16, MIN_KEY_ATTEMPTS);

  // /stats?demo=1 loads the sample data once for the active layout (explicit opt-in via the URL).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("demo") !== "1") return;
    const current = resolveLayout(getSettings().layoutId, getSettings().customLayouts);
    if (!hasDemoData(current.id)) seedDemoData(current.id, { layout: current.layout });
    url.searchParams.delete("demo");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    refresh((n) => n + 1);
  }, []);

  useEffect(() => setPinnedKeyId(null), [layoutId]);

  const split = useMemo(() => splitByRange(results, range), [results, range]);
  const head = useMemo(() => computeHeadline(split.current), [split]);
  const prev = useMemo(() => computeHeadline(split.previous), [split]);
  const allTime = useMemo(() => computeHeadline(results), [results]);
  const chartBestIds = useMemo(() => runningBestIds(results), [results]);
  const pbIds = useMemo(() => new Set(Object.values(bests).map((b) => b.resultId)), [bests]);
  const fingers = useMemo(() => aggregateByFinger(aggregateByKey(layout, keyStats)), [layout, keyStats]);
  const overallMs = useMemo(() => {
    let total = 0;
    let samples = 0;
    for (const s of Object.values(keyStats)) {
      total += s.totalMs || 0;
      samples += s.samples || 0;
    }
    return samples > 0 ? total / samples : null;
  }, [keyStats]);
  // Characters recorded under this layout id that the layout cannot type are not practicable here.
  const weakest = useMemo(() => weakestAll.filter((k) => keyForChar(layout, k.char)).slice(0, 6), [weakestAll, layout]);
  const mixups = useMemo(() => topMixups(keyStats, 6), [keyStats]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- streak changes exactly when the practised days do.
  const activity = useMemo(() => buildActivity(results, mounted ? readPracticedDays() : [], 12), [results, streak, mounted]);
  const lessons = useMemo(() => summarizeLessons(lessonProgress, buildCurriculum(layout).map((l) => l.id)), [lessonProgress, layout]);

  const hasKeyStats = Object.keys(keyStats).length > 0;
  const hasLessons = Object.keys(lessonProgress).length > 0;
  const isEmpty = results.length === 0 && !hasKeyStats && !hasLessons;
  const demoLoaded = mounted && hasDemoData(layoutId);

  const loadDemo = useCallback(() => {
    const n = seedDemoData(layoutId, { layout });
    refresh((v) => v + 1);
    toast("Sample data loaded", { variant: "success", description: `${n} made-up tests for ${view.name}. Remove them from the menu at any time.` });
  }, [layoutId, layout, view.name]);

  const removeDemo = useCallback(() => {
    clearDemoData(layoutId);
    refresh((v) => v + 1);
    toast("Sample data removed", { variant: "success" });
  }, [layoutId]);

  const exportData = useCallback(() => {
    const file = buildExport();
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `layoutlearner-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Data exported", { variant: "success", description: `${Object.keys(file.data).length} sections saved as JSON.` });
  }, []);

  const onImportFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    let text = "";
    try {
      text = await file.text();
    } catch {
      toast("Could not read that file", { variant: "error" });
      return;
    }
    const check = validateImport(text);
    if (check.ok === false) {
      toast("Import failed", { variant: "error", description: check.error, duration: 6000 });
      return;
    }
    setPendingImport({ file: check.file, summary: check.summary });
  }, []);

  const inspectChar = useCallback(
    (ch: string) => {
      const hit = keyForChar(layout, ch);
      if (!hit) return;
      setPinnedKeyId(hit.key.id);
      heatRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [layout],
  );

  const layoutOptions = useMemo(() => {
    const ids = Array.from(new Set([active.id, ...idsWithData]));
    return ids.map((id) => ({
      value: id,
      label: layoutName(id, settings.customLayouts),
      hint: id === active.id ? "active" : undefined,
    }));
  }, [active.id, idsWithData, settings.customLayouts]);

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {mounted && layoutOptions.length > 1 && (
        <Select data-testid="stats-layout" aria-label="Layout" size="sm" align="end" value={layoutId} onChange={(id) => setViewId(id)} options={layoutOptions} />
      )}
      {!isEmpty && <SegmentedControl data-testid="stats-range" aria-label="Time range" size="sm" value={range} onChange={setRange} options={RANGES} />}
      <Menu
        align="end"
        aria-label="Data"
        trigger={(p) => <IconButton icon="more" size="sm" variant="subtle" label="Data options" data-testid="stats-menu" {...p} />}
        items={[
          { id: "export", label: "Export data (JSON)", icon: "download", onSelect: exportData },
          { id: "import", label: "Import data…", icon: "upload", onSelect: () => fileRef.current?.click() },
          demoLoaded
            ? { id: "demo-clear", label: "Remove sample data", icon: "trash", separator: true, onSelect: removeDemo }
            : { id: "demo-load", label: "Load sample data", icon: "zap", separator: true, onSelect: loadDemo },
        ]}
      />
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="import-input"
        onChange={(e) => {
          void onImportFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );

  const importDialog = (
    <ConfirmDialog
      open={pendingImport != null}
      onClose={() => setPendingImport(null)}
      onConfirm={() => {
        if (!pendingImport) return;
        applyImport(pendingImport.file);
        setViewId(null);
        refresh((v) => v + 1);
        toast("Data imported", { variant: "success", description: `${pendingImport.summary.results} tests restored.` });
      }}
      title="Replace your data with this file?"
      description={
        pendingImport
          ? `The file holds ${pendingImport.summary.results} test${pendingImport.summary.results === 1 ? "" : "s"} across ${pendingImport.summary.layouts.length} layout${
              pendingImport.summary.layouts.length === 1 ? "" : "s"
            }${pendingImport.summary.hasSettings ? ", plus settings and custom layouts" : ""}. Everything currently stored in this browser (history, key stats, lesson progress${
              pendingImport.summary.hasSettings ? ", settings" : ""
            }) will be overwritten.`
          : undefined
      }
      confirmLabel="Replace data"
      tone="danger"
      data-testid="import-confirm"
    />
  );

  const header = (
    <PageHeader
      title="Stats"
      eyebrow={mounted ? view.name.toLowerCase() : undefined}
      description="Your speed and accuracy over time, and the keys and fingers that still need work."
      actions={actions}
    />
  );

  if (!mounted) {
    return (
      <>
        {header}
        <LoadingState />
      </>
    );
  }

  if (isEmpty) {
    return (
      <div data-testid="stats-view" data-layout={layoutId} data-state="empty">
        {header}
        <Card padding="lg" data-testid="stats-empty" className="flex flex-col items-center py-14 text-center sm:py-20">
          <span className="flex size-12 items-center justify-center rounded-full bg-main/[0.12] text-main">
            <Icon name="chart" size={22} />
          </span>
          <h2 className="mt-5 text-lg font-semibold tracking-tight text-text">No stats for {view.name} yet</h2>
          <p className="mt-2 max-w-md text-[15px] text-sub">
            Finish a typing test or a lesson on this layout and your speed, accuracy and a heatmap of the keys you miss will show up here. Everything stays in this browser.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
            <Button href="/" variant="primary" icon="keyboard" data-testid="empty-cta">
              Take a test
            </Button>
            <Button variant="subtle" icon="zap" onClick={loadDemo} data-testid="seed-demo">
              Load sample data
            </Button>
          </div>
          <p className="mt-4 text-xs text-sub">Sample data is made up, clearly removable, and only there to preview this page.</p>
        </Card>
        {importDialog}
      </div>
    );
  }

  const allTimeBest = allTime.bestWpm;
  const showPrev = range !== "all" && prev.tests > 0;
  const diff = (a: number | null, b: number | null) => (showPrev && a != null && b != null ? a - b : null);

  return (
    <div data-testid="stats-view" data-layout={layoutId} data-range={range} data-state="ready">
      {header}

      {demoLoaded && (
        <div data-testid="demo-banner" className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-ui border border-border px-4 py-2.5 text-[13px] text-sub">
          <span className="flex items-center gap-2">
            <Icon name="info" size={15} className="text-main" />
            You are looking at sample data for {view.name}, not your own typing.
          </span>
          <Button size="sm" variant="ghost" onClick={removeDemo} data-testid="clear-demo">
            Remove sample data
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {/* ── headline ── */}
        <Card data-testid="headline" className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
          <StatCell testId="stat-best-wpm" value={head.bestWpm}>
            <Stat
              label="best wpm"
              value={head.bestWpm != null ? Math.round(head.bestWpm) : "–"}
              hint={range === "all" || allTimeBest == null ? (head.bestWpm != null ? "all-time best" : undefined) : head.bestWpm === allTimeBest ? "your all-time best" : `all-time ${Math.round(allTimeBest)}`}
            />
          </StatCell>
          <StatCell testId="stat-avg-wpm" value={head.avgWpm != null ? Number(head.avgWpm.toFixed(2)) : null}>
            <Stat label="average wpm" tone="text" value={head.avgWpm != null ? head.avgWpm.toFixed(1) : "–"} hint={<Delta value={diff(head.avgWpm, prev.avgWpm)} suffix={PREV_TEXT[range]} />} />
          </StatCell>
          <StatCell testId="stat-avg-acc" value={head.avgAccuracy != null ? Number(head.avgAccuracy.toFixed(2)) : null}>
            <Stat
              label="average accuracy"
              tone="text"
              value={head.avgAccuracy != null ? head.avgAccuracy.toFixed(1) : "–"}
              unit={head.avgAccuracy != null ? "%" : undefined}
              hint={<Delta value={diff(head.avgAccuracy, prev.avgAccuracy)} unit=" pt" suffix={PREV_TEXT[range]} />}
            />
          </StatCell>
          <StatCell testId="stat-tests" value={head.tests}>
            <Stat label="tests completed" tone="text" value={head.tests} hint={showPrev ? <Delta value={head.tests - prev.tests} digits={0} suffix={PREV_TEXT[range]} /> : RANGE_TEXT[range]} />
          </StatCell>
          <StatCell testId="stat-time" value={head.timeMs}>
            <Stat label="time typing" tone="text" value={<span title={formatDuration(head.timeMs)}>{durationParts(head.timeMs).value}</span>} unit={durationParts(head.timeMs).unit} hint={RANGE_TEXT[range]} />
          </StatCell>
          <StatCell testId="stat-streak" value={streak.current}>
            <Stat
              label="day streak"
              tone="text"
              value={streak.current}
              unit={
                <span className="inline-flex items-center gap-1">
                  {streak.current === 1 ? "day" : "days"}
                  {streak.current > 0 && <Icon name="flame" size={15} className="text-main" />}
                </span>
              }
              hint={<span data-testid="stat-streak-longest" data-value={streak.longest}>longest {streak.longest} · all layouts</span>}
            />
          </StatCell>
        </Card>

        {/* ── progress ── */}
        <Card>
          <div className="mb-4">
            <CardTitle>Progress</CardTitle>
            <CardDescription>
              {results.length === 0 ? "Typing tests you finish on this layout are plotted here." : `Every test ${RANGE_TEXT[range]}, oldest to newest.`}
            </CardDescription>
          </div>
          {results.length === 0 ? (
            <div data-testid="progress-chart" data-points={0} className="flex h-40 flex-col items-center justify-center gap-3 rounded-ui border border-dashed border-border text-sm text-sub">
              No tests yet on this layout, only lesson practice.
              <Button href="/" size="sm" variant="subtle" icon="keyboard">
                Take a test
              </Button>
            </div>
          ) : (
            <ProgressChart results={split.current} bestIds={chartBestIds} />
          )}
        </Card>

        {/* ── heatmap ── */}
        <div ref={heatRef} className="scroll-mt-24">
          <Card>
            <KeyHeatmap layout={layout} keyStats={keyStats} pinnedKeyId={pinnedKeyId} onPinKey={setPinnedKeyId} />
          </Card>
        </div>

        {/* ── fingers + weak keys ── */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <FingerBreakdown breakdown={fingers} />
          </Card>
          <Card>
            <WeakKeys weakest={weakest} mixups={mixups} overallMs={overallMs} onInspect={inspectChar} />
          </Card>
        </div>

        {/* ── activity + lessons ── */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <ActivityCalendar grid={activity} streak={streak} />
          </Card>
          <Card data-testid="lesson-summary" data-stars={lessons.stars} data-completed={lessons.completed} data-total={lessons.total} className="flex flex-col">
            <CardTitle>Lessons</CardTitle>
            <CardDescription>Guided course for {view.name}.</CardDescription>
            <div className="mt-5 grid grid-cols-2 gap-x-6">
              <Stat size="sm" tone="text" label="lessons completed" value={lessons.completed} unit={`/ ${lessons.total}`} />
              <Stat
                size="sm"
                tone="text"
                label="stars earned"
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {lessons.stars}
                    <Icon name="star" size={16} className="text-main" fill="currentColor" />
                  </span>
                }
                unit={`/ ${lessons.maxStars}`}
              />
            </div>
            <ProgressBar className="mt-5" size="md" value={lessons.completed} max={Math.max(1, lessons.total)} aria-label="Lessons completed" />
            <div className="mt-auto pt-5">
              <Button href="/learn" variant="subtle" size="sm" iconRight="arrow-right" data-testid="lessons-link">
                {lessons.started === 0 ? "Start the course" : lessons.completed >= lessons.total && lessons.total > 0 ? "Review lessons" : "Continue learning"}
              </Button>
            </div>
          </Card>
        </div>

        {/* ── history ── */}
        <Card>
          <HistoryTable results={split.current} bestIds={pbIds} rangeLabel={RANGE_TEXT[range]} />
        </Card>
      </div>
      {importDialog}
    </div>
  );
}
