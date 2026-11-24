"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { Badge, Button, Icon, SegmentedControl, cx, type IconName } from "@/components/ui";
import { homeRowChars, homeRowKeyIds } from "@/lib/layout/analysis";
import { displayLegends } from "@/lib/layout/parse";
import { FINGER_ORDER, type LayoutKey, type ParsedLayout } from "@/lib/types";
import { FAMILY_LABEL, pct, type LayoutEntry } from "./catalog";
import { FingerSwatch, Note } from "./drafting";
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
  /** Copy a preset into a custom layout and open its Fingers view. */
  onCustomise?: (entry: LayoutEntry) => void;
  /** Copy a preset into a custom layout and open its Layers view. */
  onCustomiseLayers?: (entry: LayoutEntry) => void;
  onDelete: (entry: LayoutEntry) => void;
}

const FINGER_NAME = FINGER_ORDER.map((f) => `${f.hand === "L" ? "Left" : "Right"} ${f.finger}`);
const FINGER_SHORT = FINGER_ORDER.map((f) => f.finger);
const FINGER_ABBR: Record<string, string> = { middle: "mid" };
/** Fingers that type letters (thumbs only press space, which the word list does not count). */
const LEFT_FINGERS = [0, 1, 2, 3];
const RIGHT_FINGERS = [6, 7, 8, 9];
const ALPHABET = Array.from("abcdefghijklmnopqrstuvwxyz");

const label = (ch: string) => (ch.length === 1 ? ch.toUpperCase() : ch);

/** Drafted section hatching in line colour: the "other" fill beside a solid one. */
const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--line) 0 1px, transparent 1px 5px)",
};

/** Segment label whose icon is dropped on narrow screens so the three views fit on one line. */
const viewLabel = (icon: IconName, text: string) => (
  <>
    <Icon name={icon} size={14} className="hidden sm:block" />
    {text}
  </>
);

/** One drafted chart: lettered heading, a one-line reading aid, the figure. A ruled cell of the analysis grid. */
function Chart({
  title,
  explain,
  children,
  testid,
  className,
}: {
  title: string;
  explain: ReactNode;
  children: ReactNode;
  testid: string;
  className?: string;
}) {
  return (
    <section className={cx("flex min-w-0 flex-col border-r border-b border-border p-4 sm:p-5", className)} data-testid={testid}>
      <h3 className="ll-lettering-lg text-text">{title}</h3>
      <p className="mt-1.5 max-w-[60ch] text-md leading-snug text-sub">{explain}</p>
      <div className="mt-6 flex flex-1 flex-col justify-center">{children}</div>
    </section>
  );
}

function RowBar({ name, value, reference, testid, emphasis }: { name: string; value: number; reference?: number; testid: string; emphasis?: boolean }) {
  return (
    <div className="grid grid-cols-[100px_minmax(0,1fr)_44px] items-center gap-3">
      <span className={cx("ll-lettering-sm whitespace-nowrap", emphasis ? "text-text" : "text-sub")}>{name}</span>
      <div className="relative h-4 border border-border">
        <div
          className={cx("h-full border-r border-line transition-[width] duration-300 ease-out", emphasis && "bg-main")}
          style={{ width: `${Math.min(100, value * 100)}%`, ...(emphasis ? null : HATCH) }}
        />
        {reference !== undefined && (
          <span
            aria-hidden
            title={`QWERTY: ${pct(reference)}`}
            className="absolute -top-1.5 -bottom-1.5 w-0.5 bg-line"
            style={{ left: `calc(${Math.min(100, reference * 100)}% - 1px)` }}
          />
        )}
      </div>
      <span className="ll-readout text-right text-md text-text" data-testid={testid} data-value={(value * 100).toFixed(1)}>
        {pct(value)}
      </span>
    </div>
  );
}

/** Finger load as a ruled bar chart: hairline axes, a percentage scale, one bar per finger in that finger's colour, named below. */
function FingerChart({ shares, max }: { shares: number[]; max: number }) {
  const step = max > 0.3 ? 10 : 5;
  const top = Math.max(step, Math.ceil((max * 100 + 1) / step) * step);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const groups: [string, number[]][] = [
    ["Left hand", LEFT_FINGERS],
    ["Right hand", RIGHT_FINGERS],
  ];
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
      {/* scale */}
      <div aria-hidden className="relative h-[156px] w-8">
        {ticks.map((t) => (
          <span key={t} className="ll-note absolute right-0 translate-y-1/2 text-sub" style={{ bottom: `${(t / top) * 100}%` }}>
            {t}%
          </span>
        ))}
      </div>
      {/* plot */}
      <div className="relative h-[156px] border-b border-l border-line">
        {ticks.slice(1).map((t) => (
          <span key={t} aria-hidden className="absolute inset-x-0 border-t border-dashed border-hairline" style={{ bottom: `${(t / top) * 100}%` }} />
        ))}
        <div className="absolute inset-0 flex items-end gap-[5%] px-[3%]">
          {groups.map(([hand, indices]) => (
            <div key={hand} className="flex h-full flex-1 items-end gap-[7%]">
              {indices.map((i) => (
                <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${FINGER_NAME[i]}: ${pct(shares[i], 1)}`}>
                  <span className="ll-readout text-xs leading-none text-text sm:text-sm" data-testid={`analysis-finger-${i}`} data-value={(shares[i] * 100).toFixed(1)}>
                    {pct(shares[i])}
                  </span>
                  <div
                    className="w-full border border-b-0 border-line transition-[height] duration-300 ease-out"
                    style={{ height: `${Math.max(1, (shares[i] * 100 * 100) / top)}%`, background: `var(--finger-${i})` }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* finger names, bracketed by hand */}
      <div />
      <div className="flex gap-[5%] px-[3%] pt-2">
        {groups.map(([hand, indices]) => (
          <div key={hand} className="min-w-0 flex-1">
            <div className="flex gap-[7%]">
              {indices.map((i) => (
                <span key={i} className="min-w-0 flex-1 text-center text-sm leading-none text-text">
                  <span className="sm:hidden">{FINGER_ABBR[FINGER_SHORT[i]] ?? FINGER_SHORT[i]}</span>
                  <span className="hidden sm:inline">{FINGER_SHORT[i]}</span>
                </span>
              ))}
            </div>
            <div className="ll-lettering-sm mt-2 border-t border-border pt-1.5 text-center text-sub">{hand}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FingerLegend() {
  const group = (title: string, indices: number[]) => (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      <span className="ll-lettering-sm w-full text-sub sm:w-auto sm:min-w-[84px]">{title}</span>
      {indices.map((i) => (
        <span key={i} className="inline-flex items-center gap-1.5 text-md text-text" data-testid={`finger-legend-${i}`}>
          <FingerSwatch index={i} />
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

/** The layers of a layout: each one's activator and characters, with the note that defaults are a suggestion. */
function LayerList({ layout, isCustom }: { layout: ParsedLayout; isCustom: boolean }) {
  const byId = new Map(layout.keys.map((k) => [k.id, k]));
  const name = (k: LayoutKey) => displayLegends(k.label).join(" ").trim() || "key";
  const hand = (k: LayoutKey) => (k.finger ? ` (${k.finger.hand === "L" ? "left" : "right"} ${k.finger.finger})` : "");
  return (
    <section className="mt-6 border border-border" data-testid="layout-layers">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <h3 className="ll-lettering-lg text-text">Layers</h3>
        <p className="mt-1.5 max-w-[75ch] text-md leading-snug text-sub">
          Hold the activator key and the other keys type these characters instead. {isCustom ? "Edit the layout to change them." : "Default layers are a suggestion. Edit them to match your firmware."}
        </p>
      </div>
      <ul>
        {(layout.layers ?? []).map((l) => {
          const chars = layout.keys
            .map((k) => l.keys[k.id])
            .filter((c): c is NonNullable<typeof c> => !!c)
            .flatMap((c) => (c.shifted ? [c.base, c.shifted] : [c.base]));
          return (
            <li
              key={l.id}
              data-testid="layout-layer"
              data-layer={l.id}
              className="grid gap-x-5 gap-y-1.5 border-t border-hairline px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:px-5"
            >
              <div className="text-text">
                <span className="ll-lettering">{l.name}</span>
                <span className="mt-1 block text-md leading-snug text-sub">
                  hold {l.activatorIds.map((id) => byId.get(id)).filter((k): k is LayoutKey => !!k).map((k) => `${name(k)}${hand(k)}`).join(", ")}
                </span>
              </div>
              <p className="font-mono text-md leading-relaxed break-words text-text" data-testid="layout-layer-chars">
                {chars.length > 0 ? chars.join(" ") : <span className="font-sans text-sub">No characters.</span>}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One row of the plate's title block. */
function BlockRow({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-3 border-t border-hairline px-4 py-2.5 first:border-t-0">
      <dt className="ll-lettering-sm text-sub">{name}</dt>
      <dd className="min-w-0 text-base leading-snug break-words text-text">{children}</dd>
    </div>
  );
}

export function LayoutDetail({ entry, baseline, active, onUse, onPractice, onEdit, onDuplicate, onCustomise, onCustomiseLayers, onDelete }: LayoutDetailProps) {
  const [view, setView] = useState<DetailView>("fingers");
  const { layout, analysis, diff } = entry;

  const homeIds = useMemo(() => (layout ? new Set(homeRowKeyIds(layout)) : new Set<string>()), [layout]);
  const offHomeIds = useMemo(() => (layout ? layout.keys.filter((k) => !homeIds.has(k.id)).map((k) => k.id) : []), [layout, homeIds]);
  const homeChars = useMemo(() => (layout ? homeRowChars(layout) : []), [layout]);

  const header = (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h2
          className="min-w-0 font-display text-[clamp(1.625rem,1.2rem+1.5vw,2.375rem)] leading-none font-light tracking-[0.06em] text-text uppercase"
          data-testid="layout-detail-name"
        >
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
      <span aria-hidden className="mb-2 hidden h-px min-w-8 flex-1 bg-border lg:block" />
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 max-lg:w-full">
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
          <>
            {layout && onCustomise && (
              <Button size="sm" variant="ghost" icon="hand" data-testid="layout-customise" onClick={() => onCustomise(entry)}>
                Customise fingering
              </Button>
            )}
            {layout && onCustomiseLayers && (entry.family === "split" || (entry.layers?.length ?? 0) > 0) && (
              <Button size="sm" variant="ghost" icon="layers" data-testid="layout-customise-layers" onClick={() => onCustomiseLayers(entry)}>
                Customise layers
              </Button>
            )}
            <Button size="sm" variant="ghost" icon="copy" data-testid="layout-duplicate" onClick={() => onDuplicate(entry)}>
              Duplicate
            </Button>
          </>
        )}
        {layout && !active && (
          <Button variant="primary" className="ml-2" data-testid="layout-use" icon="check" onClick={() => onUse(entry)}>
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
        <p className="mt-3 max-w-[70ch] text-base leading-snug text-sub">{entry.description}</p>
        <div className="mt-6 flex flex-col items-start gap-4 border border-error p-4 sm:flex-row sm:items-center sm:p-5">
          <Icon name="alert" size={22} className="shrink-0 text-error" />
          <div className="min-w-0 flex-1">
            <p className="ll-lettering text-error">This layout&apos;s data can&apos;t be read any more.</p>
            <p className="mt-1.5 font-mono text-md break-words text-text" data-testid="layout-detail-error">
              {entry.error}
            </p>
          </div>
          <Button variant="primary" size="sm" icon="edit" onClick={() => onEdit(entry)}>
            Fix in editor
          </Button>
        </div>
      </section>
    );
  }

  const movedCount = diff.movedLetters.length;
  const lettersPresent = 26 - diff.missingLetters.length;
  const fingerMax = Math.max(...analysis.fingers, 0.0001);
  // Same letter arrangement as QWERTY: a comparison would only repeat the bars.
  const base = baseline && baseline.id !== entry.id && movedCount > 0 ? baseline.analysis : null;
  const movedSet = new Set(diff.movedLetters);
  const missingSet = new Set(diff.missingLetters);
  const sfbMax = Math.max(...analysis.topSfb.map((s) => s.share), 0.000001);
  const layerCount = layout.layers?.length ?? 0;

  let caption: ReactNode;
  if (view === "fingers") {
    caption = analysis.fingerCoverage > 0 || layout.keys.some((k) => k.finger) ? (
      <FingerLegend />
    ) : (
      <p className="text-center text-md text-sub">Finger assignments could not be worked out for this board.</p>
    );
  } else if (view === "home") {
    caption = (
      <p className="text-center text-md text-sub">
        {homeChars.length > 0 ? (
          <>
            Your fingers rest on{" "}
            <span className="font-mono text-text" data-testid="home-row-chars">
              {homeChars.map(label).join(" ")}
            </span>
            {analysis.rows && (
              <>
                {" "}
                and can type <span className="ll-readout font-medium text-text">{pct(analysis.rows.home)}</span> of English letters without leaving that row.
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
      <p className="text-center text-md text-sub">
        {!diff.comparable ? (
          "This board could not be lined up with QWERTY's key positions."
        ) : (
          <>
            <span className="ll-readout font-medium text-text" data-testid="diff-count" data-moved={movedCount} data-total={26}>
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
      <p className="mt-3 max-w-[70ch] text-base leading-snug text-sub">{entry.description}</p>

      {/* The plate and its title block share one outlined sheet. */}
      <div className="mt-6 grid border border-line lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
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
            <span className="ll-note hidden text-sub sm:inline">
              {layout.keys.length} keys · {+layout.width.toFixed(2)}u × {+layout.height.toFixed(2)}u
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center px-3 pt-7 pb-5 sm:px-6 sm:pt-9">
            <Keyboard2D
              layout={layout}
              fingerColors={view !== "diff"}
              dimUnused={view === "home" ? offHomeIds : view === "diff" && diff.comparable ? diff.sameKeyIds : undefined}
              highlightKeyIds={view === "diff" && diff.comparable ? diff.movedKeyIds : undefined}
              maxUnit={56}
              className={view === "diff" ? styles.diffKb : undefined}
            />
            <div className="mt-7 flex min-h-[44px] items-center justify-center" data-testid="detail-caption">
              {caption}
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col border-t border-line lg:border-t-0 lg:border-l" aria-label="Plate data">
          <dl>
            <BlockRow name="Layout">{entry.name}</BlockRow>
            <BlockRow name="Board">{FAMILY_LABEL[entry.family]}</BlockRow>
            <BlockRow name="Keys">
              <span className="ll-readout">{layout.keys.length}</span>
            </BlockRow>
            <BlockRow name="Size">
              <span className="ll-readout">
                {+layout.width.toFixed(2)}u × {+layout.height.toFixed(2)}u
              </span>
            </BlockRow>
            <BlockRow name="Home keys">
              {homeChars.length > 0 ? <span className="font-mono">{homeChars.map(label).join(" ")}</span> : <span className="text-sub">not recognised</span>}
            </BlockRow>
            <BlockRow name="vs QWERTY">
              {!diff.comparable ? (
                <span className="text-sub">not comparable</span>
              ) : movedCount === 0 ? (
                "same letters"
              ) : (
                <>
                  <span className="ll-readout">{movedCount}</span> of 26 letters moved
                </>
              )}
            </BlockRow>
            <BlockRow name="Layers">{layerCount === 0 ? <span className="text-sub">none</span> : <span className="ll-readout">{layerCount}</span>}</BlockRow>
            <BlockRow name="Origin">{entry.isCustom ? "Your own layout" : "Built-in preset"}</BlockRow>
            <BlockRow name="Status">{active ? "The layout you are learning" : "Not in use"}</BlockRow>
          </dl>
          <div className="mt-auto flex flex-col gap-2 border-t border-line p-4">
            <Button variant={active ? "primary" : "subtle"} fullWidth icon="keyboard" data-testid="layout-practice" onClick={() => onPractice(entry, "/")}>
              Practice this layout
            </Button>
            <Button fullWidth icon="graduation" data-testid="layout-lessons" onClick={() => onPractice(entry, "/learn")}>
              Start lessons
            </Button>
          </div>
        </aside>
      </div>

      {layerCount > 0 && <LayerList layout={layout} isCustom={entry.isCustom} />}

      <div className="mt-6 grid border-t border-l border-border lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" data-testid="layout-analysis">
        <Chart
          testid="analysis-fingers"
          title="Finger load"
          explain="Share of letters each finger types. Strong index and middle fingers should carry more than pinkies."
        >
          {analysis.fingerCoverage > 0 ? (
            <FingerChart shares={analysis.fingers} max={fingerMax} />
          ) : (
            <Note>Needs finger assignments.</Note>
          )}
        </Chart>

        <Chart
          testid="analysis-rows"
          title="Row usage"
          explain="Where your fingers spend their time. More on the home row means less reaching."
        >
          {analysis.rows ? (
            <div className="flex flex-col gap-4">
              <RowBar name="Top row" value={analysis.rows.top} reference={base?.rows?.top} testid="analysis-row-top" />
              <RowBar name="Home row" value={analysis.rows.home} reference={base?.rows?.home} testid="analysis-row-home" emphasis />
              <RowBar name="Bottom row" value={analysis.rows.bottom} reference={base?.rows?.bottom} testid="analysis-row-bottom" />
              {analysis.rows.other > 0.0005 && (
                <RowBar name="Other" value={analysis.rows.other} testid="analysis-row-other" />
              )}
              {base?.rows && (
                <p className="flex items-center gap-2.5 text-md text-sub">
                  <span aria-hidden className="inline-block h-4 w-0.5 bg-line" />
                  QWERTY for comparison ({pct(base.rows.home)} home row)
                </p>
              )}
            </div>
          ) : (
            <Note>Needs a recognised home row.</Note>
          )}
        </Chart>

        <Chart
          testid="analysis-sfb-card"
          title="Same-finger pairs"
          explain="Two different letters in a row on one finger. They are the slowest motion in typing, so lower is better."
        >
          {analysis.sfb !== null ? (
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
              <div>
                <div className="ll-numeral text-5xl text-text" data-testid="analysis-sfb" data-value={(analysis.sfb * 100).toFixed(2)}>
                  {pct(analysis.sfb, 1)}
                </div>
                <p className="mt-2 text-md text-sub">
                  of letter pairs{base?.sfb != null && <> · QWERTY {pct(base.sfb, 1)}</>}
                </p>
              </div>
              {analysis.topSfb.length > 0 && (
                <div className="min-w-0">
                  <p className="ll-lettering-sm mb-2 text-sub">Most common</p>
                  <ul className="flex flex-col gap-1.5">
                    {analysis.topSfb.map((s) => (
                      <li key={s.bigram} className="grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-2.5" title={`${pct(s.share, 2)} of letter pairs`}>
                        <span className="font-mono text-md text-text">{s.bigram}</span>
                        <span className="h-2.5 border-l border-line">
                          <span className="block h-full border border-l-0 border-line" style={{ width: `${Math.max(2, (s.share / sfbMax) * 100)}%`, ...HATCH }} />
                        </span>
                        <span className="ll-readout text-right text-sm text-text">{pct(s.share, 2)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <Note>Needs finger assignments.</Note>
          )}
        </Chart>

        <Chart
          testid="analysis-hands"
          title="Hand balance"
          explain="How the work splits between your hands. Close to 50/50 keeps either hand from tiring first."
        >
          {analysis.hands ? (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="flex items-baseline gap-2.5">
                  <span className="ll-lettering-sm text-sub">Left</span>
                  <span className="ll-numeral text-3xl text-text" data-testid="analysis-hand-left" data-value={(analysis.hands.left * 100).toFixed(1)}>
                    {pct(analysis.hands.left)}
                  </span>
                </span>
                <span className="flex items-baseline gap-2.5">
                  <span className="ll-numeral text-3xl text-text" data-testid="analysis-hand-right" data-value={(analysis.hands.right * 100).toFixed(1)}>
                    {pct(analysis.hands.right)}
                  </span>
                  <span className="ll-lettering-sm text-sub">Right</span>
                </span>
              </div>
              <div className="relative mt-3">
                <div className="flex h-4 border border-line">
                  <div className="h-full border-r border-line bg-text transition-[width] duration-300 ease-out" style={{ width: `${analysis.hands.left * 100}%` }} />
                  <div className="h-full flex-1" style={HATCH} />
                </div>
                <span aria-hidden className="absolute -top-1.5 -bottom-1.5 left-1/2 w-px bg-line" />
              </div>
              <p className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 text-md text-sub">
                <span className="ll-note mx-auto text-sub sm:order-2 sm:mx-0">50 / 50 at the centre mark</span>
                {base?.hands && (
                  <span>
                    QWERTY: {pct(base.hands.left)} left, {pct(base.hands.right)} right
                  </span>
                )}
              </p>
            </div>
          ) : (
            <Note>Needs finger assignments.</Note>
          )}
        </Chart>

        <Chart
          testid="analysis-moved"
          className="lg:col-span-2"
          title="Moved keys"
          explain="Letters that sit on a different key than on QWERTY. These are the ones your fingers have to relearn."
        >
          {diff.comparable ? (
            <div>
              <ul className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-1 lg:grid-cols-[repeat(26,minmax(0,1fr))]" aria-label="Letters A to Z">
                {ALPHABET.map((ch) => {
                  const state = missingSet.has(ch) ? "missing" : movedSet.has(ch) ? "moved" : "same";
                  return (
                    <li
                      key={ch}
                      data-letter={ch}
                      data-state={state}
                      className={cx(
                        "flex aspect-square max-h-10 items-center justify-center border font-mono text-sm leading-none font-medium uppercase sm:text-md",
                        state === "moved" && "border-line bg-main text-main-fg",
                        state === "same" && "border-border text-text",
                        state === "missing" && "border-dashed border-border text-sub line-through",
                      )}
                    >
                      {ch}
                      <span className="sr-only">{state === "moved" ? ", moved" : state === "missing" ? ", missing" : ", same as QWERTY"}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-md text-sub">
                <span className="text-text">
                  <span className="ll-readout font-medium">{movedCount}</span> of 26 moved
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="inline-block size-3.5 border border-line bg-main" />
                  filled: moved
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="inline-block size-3.5 border border-border" />
                  outlined: same key as QWERTY
                </span>
                {diff.missingLetters.length > 0 && (
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className="inline-block size-3.5 border border-dashed border-border" />
                    dashed: not on this layout
                  </span>
                )}
              </div>
            </div>
          ) : (
            <Note>This board could not be lined up with QWERTY&apos;s key positions.</Note>
          )}
        </Chart>
      </div>

      <p className="ll-note mt-3 text-sub">Measured over the built-in list of 1,000 common English words, weighted by how often each is used.</p>
    </section>
  );
}
