"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { Badge, Button, Card, Icon, SegmentedControl, cx, type IconName } from "@/components/ui";
import { homeRowChars, homeRowKeyIds } from "@/lib/layout/analysis";
import { FINGER_ORDER } from "@/lib/types";
import { FAMILY_LABEL, pct, type LayoutEntry } from "./catalog";
import styles from "./layouts.module.css";

export type DetailView = "fingers" | "home" | "diff";

export interface LayoutDetailProps {
  entry: LayoutEntry;
  /** QWERTY's numbers, shown as a reference next to the bars. */
  baseline?: LayoutEntry;
  active: boolean;
  onUse: (entry: LayoutEntry) => void;
  onPractice: (entry: LayoutEntry, href: string) => void;
  onEdit: (entry: LayoutEntry) => void;
  onDuplicate: (entry: LayoutEntry) => void;
  onDelete: (entry: LayoutEntry) => void;
}

const FINGER_NAME = FINGER_ORDER.map((f) => `${f.hand === "L" ? "Left" : "Right"} ${f.finger}`);
const FINGER_SHORT = FINGER_ORDER.map((f) => f.finger);
const FINGER_ABBR: Record<string, string> = { middle: "mid" };
/** Fingers that type letters (thumbs only press space, which the word list does not count). */
const LEFT_FINGERS = [0, 1, 2, 3];
const RIGHT_FINGERS = [6, 7, 8, 9];

const label = (ch: string) => (ch.length === 1 ? ch.toUpperCase() : ch);

/** Segment label whose icon is dropped on narrow screens so the three views fit on one line. */
const viewLabel = (icon: IconName, text: string) => (
  <>
    <Icon name={icon} size={14} className="hidden sm:block" />
    {text}
  </>
);

function StatCard({
  title,
  explain,
  children,
  testid,
}: {
  title: string;
  explain: ReactNode;
  children: ReactNode;
  testid: string;
}) {
  return (
    <Card as="section" className="flex min-w-0 flex-col" data-testid={testid}>
      <h3 className="text-[15px] font-semibold tracking-tight text-text">{title}</h3>
      <p className="mt-1 text-[13px] leading-snug text-sub">{explain}</p>
      <div className="mt-5 flex flex-1 flex-col justify-end">{children}</div>
    </Card>
  );
}

function RowBar({ name, value, reference, testid, emphasis }: { name: string; value: number; reference?: number; testid: string; emphasis?: boolean }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)_44px] items-center gap-3">
      <span className={cx("text-[13px]", emphasis ? "font-medium text-text" : "text-sub")}>{name}</span>
      <div className="relative h-2.5 rounded-full bg-text/[0.08]">
        <div
          className={cx("h-full rounded-full transition-[width] duration-300 ease-out", emphasis ? "bg-main" : "bg-sub/70")}
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
        {reference !== undefined && (
          <span
            aria-hidden
            title={`QWERTY: ${pct(reference)}`}
            className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-text/60"
            style={{ left: `calc(${Math.min(100, reference * 100)}% - 1px)` }}
          />
        )}
      </div>
      <span className="text-right font-mono text-[13px] text-text tabular-nums" data-testid={testid} data-value={(value * 100).toFixed(1)}>
        {pct(value)}
      </span>
    </div>
  );
}

function FingerBars({ shares, indices, max }: { shares: number[]; indices: number[]; max: number }) {
  return (
    <div className="flex flex-1 items-end gap-1.5 sm:gap-2">
      {indices.map((i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${FINGER_NAME[i]}: ${pct(shares[i], 1)}`}>
          <span className="font-mono text-[11px] text-text tabular-nums sm:text-xs" data-testid={`analysis-finger-${i}`} data-value={(shares[i] * 100).toFixed(1)}>
            {pct(shares[i])}
          </span>
          <div className="flex h-20 w-full items-end rounded-ui-sm bg-text/[0.06]">
            <div
              className="w-full rounded-ui-sm transition-[height] duration-300 ease-out"
              style={{ height: `${max > 0 ? Math.max(2, (shares[i] / max) * 100) : 0}%`, background: `var(--finger-${i})` }}
            />
          </div>
          <span className="w-full text-center text-[11px] text-sub">
            <span className="sm:hidden">{FINGER_ABBR[FINGER_SHORT[i]] ?? FINGER_SHORT[i]}</span>
            <span className="hidden sm:inline">{FINGER_SHORT[i]}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function FingerLegend() {
  const group = (title: string, indices: number[]) => (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      <span className="w-full text-[11px] font-medium tracking-wide text-sub uppercase sm:w-auto sm:min-w-[72px]">{title}</span>
      {indices.map((i) => (
        <span key={i} className="inline-flex items-center gap-1.5 text-[13px] text-text" data-testid={`finger-legend-${i}`}>
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: `var(--finger-${i})` }} />
          <span className="sr-only">{FINGER_NAME[i]}</span>
          <span aria-hidden>{FINGER_SHORT[i]}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className="flex flex-col gap-x-10 gap-y-2.5 lg:flex-row lg:justify-center" data-testid="finger-legend">
      {group("Left hand", [0, 1, 2, 3, 4])}
      {group("Right hand", [5, 6, 7, 8, 9])}
    </div>
  );
}

export function LayoutDetail({ entry, baseline, active, onUse, onPractice, onEdit, onDuplicate, onDelete }: LayoutDetailProps) {
  const [view, setView] = useState<DetailView>("fingers");
  const { layout, analysis, diff } = entry;

  const homeIds = useMemo(() => (layout ? new Set(homeRowKeyIds(layout)) : new Set<string>()), [layout]);
  const offHomeIds = useMemo(() => (layout ? layout.keys.filter((k) => !homeIds.has(k.id)).map((k) => k.id) : []), [layout, homeIds]);
  const homeChars = useMemo(() => (layout ? homeRowChars(layout) : []), [layout]);

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-xl font-semibold tracking-tight text-text" data-testid="layout-detail-name">
            {entry.name}
          </h2>
          <Badge>{FAMILY_LABEL[entry.family]}</Badge>
          {active && (
            <Badge tone="main" icon="check">
              Active
            </Badge>
          )}
          {!layout && (
            <Badge tone="error" icon="alert">
              Error
            </Badge>
          )}
        </div>
        <p className="mt-1.5 max-w-xl text-sm text-sub">{entry.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {entry.isCustom ? (
          <>
            <Button size="sm" variant="ghost" icon="edit" data-testid="layout-edit" onClick={() => onEdit(entry)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" icon="trash" data-testid="layout-delete" onClick={() => onDelete(entry)}>
              Delete
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" icon="copy" data-testid="layout-duplicate" onClick={() => onDuplicate(entry)}>
            Duplicate
          </Button>
        )}
        {layout && !active && (
          <Button size="sm" variant="primary" data-testid="layout-use" icon="check" onClick={() => onUse(entry)}>
            Use this layout
          </Button>
        )}
      </div>
    </div>
  );

  if (!layout || !analysis || !diff) {
    return (
      <section aria-label={`${entry.name} details`} data-testid="layout-detail" data-layout-id={entry.id} data-broken>
        {header}
        <Card variant="outline" className="mt-6 flex flex-col items-start gap-4 border-error/40 sm:flex-row sm:items-center">
          <Icon name="alert" size={22} className="shrink-0 text-error" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text">This layout's data can't be read any more.</p>
            <p className="mt-1 font-mono text-[13px] break-words text-sub" data-testid="layout-detail-error">
              {entry.error}
            </p>
          </div>
          <Button variant="primary" size="sm" icon="edit" onClick={() => onEdit(entry)}>
            Fix in editor
          </Button>
        </Card>
      </section>
    );
  }

  const movedCount = diff.movedLetters.length;
  const lettersPresent = 26 - diff.missingLetters.length;
  const fingerMax = Math.max(...analysis.fingers, 0.0001);
  // Same letter arrangement as QWERTY: a comparison would only repeat the bars.
  const base = baseline && baseline.id !== entry.id && movedCount > 0 ? baseline.analysis : null;

  let caption: ReactNode;
  if (view === "fingers") {
    caption = analysis.fingerCoverage > 0 || layout.keys.some((k) => k.finger) ? (
      <FingerLegend />
    ) : (
      <p className="text-center text-[13px] text-sub">Finger assignments could not be worked out for this board.</p>
    );
  } else if (view === "home") {
    caption = (
      <p className="text-center text-[13px] text-sub">
        {homeChars.length > 0 ? (
          <>
            Your fingers rest on{" "}
            <span className="font-mono text-text" data-testid="home-row-chars">
              {homeChars.map(label).join(" ")}
            </span>
            {analysis.rows && (
              <>
                {" "}
                and can type <span className="font-mono text-main">{pct(analysis.rows.home)}</span> of English letters without leaving that row.
              </>
            )}
          </>
        ) : (
          "No home row was recognised on this board."
        )}
      </p>
    );
  } else {
    caption = (
      <p className="text-center text-[13px] text-sub">
        {!diff.comparable ? (
          "This board could not be lined up with QWERTY's key positions."
        ) : (
          <>
            <span className="font-mono text-main" data-testid="diff-count" data-moved={movedCount} data-total={26}>
              {movedCount} of 26 letters moved
            </span>
            {movedCount === 0
              ? ". Every letter is where QWERTY has it."
              : movedCount === lettersPresent
                ? ". No letter stays where QWERTY has it."
                : ". Highlighted keys are new to learn; dimmed keys stay where QWERTY has them."}
            {diff.missingLetters.length > 0 && ` ${diff.missingLetters.length} letters are missing from this layout.`}
          </>
        )}
      </p>
    );
  }

  return (
    <section aria-label={`${entry.name} details`} data-testid="layout-detail" data-layout-id={entry.id} data-view={view}>
      {header}

      <Card padding="none" className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
          <SegmentedControl<DetailView>
            aria-label="Keyboard view"
            data-testid="detail-view"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "fingers", label: viewLabel("hand", "Finger map") },
              { value: "home", label: viewLabel("target", "Home row") },
              { value: "diff", label: viewLabel("layers", "vs QWERTY") },
            ]}
          />
          <span className="hidden font-mono text-xs text-sub sm:inline">
            {layout.keys.length} keys · {layout.width}u × {layout.height}u
          </span>
        </div>
        <div className="px-3 pt-6 pb-5 sm:px-6 sm:pt-8">
          <Keyboard2D
            layout={layout}
            fingerColors={view !== "diff"}
            dimUnused={view === "home" ? offHomeIds : view === "diff" && diff.comparable ? diff.sameKeyIds : undefined}
            highlightKeyIds={view === "diff" && diff.comparable ? diff.movedKeyIds : undefined}
            maxUnit={56}
            className={view === "diff" ? styles.diffKb : undefined}
          />
          <div className="mt-6 flex min-h-[44px] items-center justify-center" data-testid="detail-caption">
            {caption}
          </div>
        </div>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2" data-testid="layout-analysis">
        <StatCard
          testid="analysis-rows"
          title="Row usage"
          explain="Where your fingers spend their time. More on the home row means less reaching."
        >
          {analysis.rows ? (
            <div className="flex flex-col gap-3.5">
              <RowBar name="Top row" value={analysis.rows.top} reference={base?.rows?.top} testid="analysis-row-top" />
              <RowBar name="Home row" value={analysis.rows.home} reference={base?.rows?.home} testid="analysis-row-home" emphasis />
              <RowBar name="Bottom row" value={analysis.rows.bottom} reference={base?.rows?.bottom} testid="analysis-row-bottom" />
              {analysis.rows.other > 0.0005 && (
                <RowBar name="Other" value={analysis.rows.other} testid="analysis-row-other" />
              )}
              {base?.rows && (
                <p className="mt-0.5 flex items-center gap-2 text-xs text-sub">
                  <span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-text/60" />
                  QWERTY for comparison ({pct(base.rows.home)} home row)
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-sub">Needs a recognised home row.</p>
          )}
        </StatCard>

        <StatCard
          testid="analysis-fingers"
          title="Finger load"
          explain="Share of letters each finger types. Strong index and middle fingers should carry more than pinkies."
        >
          {analysis.fingerCoverage > 0 ? (
            <div className="flex items-stretch gap-4 sm:gap-6">
              <FingerBars shares={analysis.fingers} indices={LEFT_FINGERS} max={fingerMax} />
              <div aria-hidden className="w-px self-stretch bg-border/70" />
              <FingerBars shares={analysis.fingers} indices={RIGHT_FINGERS} max={fingerMax} />
            </div>
          ) : (
            <p className="text-[13px] text-sub">Needs finger assignments.</p>
          )}
        </StatCard>

        <StatCard
          testid="analysis-hands"
          title="Hand balance"
          explain="How the work splits between your hands. Close to 50/50 keeps either hand from tiring first."
        >
          {analysis.hands ? (
            <div>
              <div className="flex items-baseline justify-between font-mono text-sm tabular-nums">
                <span className="text-text">
                  <span className="mr-2 font-sans text-[13px] text-sub">Left</span>
                  <span data-testid="analysis-hand-left" data-value={(analysis.hands.left * 100).toFixed(1)}>
                    {pct(analysis.hands.left)}
                  </span>
                </span>
                <span className="text-text">
                  <span data-testid="analysis-hand-right" data-value={(analysis.hands.right * 100).toFixed(1)}>
                    {pct(analysis.hands.right)}
                  </span>
                  <span className="ml-2 font-sans text-[13px] text-sub">Right</span>
                </span>
              </div>
              <div className="relative mt-2.5 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                <div className="h-full rounded-l-full bg-finger-3 transition-[width] duration-300 ease-out" style={{ width: `${analysis.hands.left * 100}%` }} />
                <div className="h-full flex-1 rounded-r-full bg-finger-6" />
              </div>
              <div aria-hidden className="relative h-2">
                <span className="absolute top-0.5 left-1/2 h-1.5 w-px -translate-x-1/2 bg-sub" />
              </div>
              {base?.hands && (
                <p className="text-xs text-sub">
                  QWERTY: {pct(base.hands.left)} left, {pct(base.hands.right)} right
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-sub">Needs finger assignments.</p>
          )}
        </StatCard>

        <StatCard
          testid="analysis-sfb-card"
          title="Same-finger pairs"
          explain="Two different letters in a row on one finger. They are the slowest motion in typing, so lower is better."
        >
          {analysis.sfb !== null ? (
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
              <div>
                <div className="font-mono text-3xl leading-none font-medium text-main tabular-nums" data-testid="analysis-sfb" data-value={(analysis.sfb * 100).toFixed(2)}>
                  {pct(analysis.sfb, 1)}
                </div>
                <p className="mt-2 text-xs text-sub">
                  of letter pairs{base?.sfb != null && <> · QWERTY {pct(base.sfb, 1)}</>}
                </p>
              </div>
              {analysis.topSfb.length > 0 && (
                <div className="min-w-0">
                  <p className="mb-1.5 text-right text-[11px] text-sub">most common</p>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {analysis.topSfb.map((s) => (
                      <span
                        key={s.bigram}
                        title={`${pct(s.share, 2)} of letter pairs`}
                        className="rounded-ui-sm bg-text/[0.07] px-2 py-1 font-mono text-xs text-text"
                      >
                        {s.bigram}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-sub">Needs finger assignments.</p>
          )}
        </StatCard>
      </div>

      <p className="mt-3 text-xs text-sub">Measured over the built-in list of 1,000 common English words, weighted by how often each is used.</p>

      <div className="mt-6 flex flex-wrap gap-2.5">
        <Button variant="primary" icon="keyboard" data-testid="layout-practice" onClick={() => onPractice(entry, "/")}>
          Practice this layout
        </Button>
        <Button icon="graduation" data-testid="layout-lessons" onClick={() => onPractice(entry, "/learn")}>
          Start lessons
        </Button>
      </div>
    </section>
  );
}
