import { CardDescription, CardTitle } from "@/components/ui";
import { dayKey, type Streak } from "@/lib/stats/store";
import type { ActivityGrid } from "@/lib/stats/selectors";
import styles from "./stats.module.css";

const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

function describe(cell: ActivityGrid["weeks"][number][number]): string {
  const date = cell.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (cell.tests > 0) return `${date}: ${cell.tests} test${cell.tests === 1 ? "" : "s"}`;
  return cell.practiced ? `${date}: practised` : `${date}: no practice`;
}

/** GitHub-style day grid: columns are weeks (Monday first), colour = tests that day on this layout. */
export function ActivityCalendar({ grid, streak }: { grid: ActivityGrid; streak: Streak }) {
  const today = dayKey();
  const weeks = grid.weeks.length;
  return (
    <div data-testid="activity" data-active-days={grid.activeDays} data-tests={grid.totalTests}>
      <CardTitle>Activity</CardTitle>
      <CardDescription>The last {weeks} weeks. Darker days had more tests.</CardDescription>

      <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-5">
        <div className="w-full max-w-[360px] min-w-0">
          <div className="grid gap-x-2" style={{ gridTemplateColumns: "auto minmax(0,1fr)" }}>
            <div />
            <div className="relative mb-1.5 h-4 text-[11px] text-sub" aria-hidden>
              {grid.monthLabels.map((m) => (
                <span key={m.week} className="absolute top-0" style={{ left: `${(m.week / weeks) * 100}%` }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div className="grid grid-rows-7 gap-[3px] text-[10px] leading-none text-sub" aria-hidden>
              {WEEKDAYS.map((d, i) => (
                <span key={i} className="flex items-center">
                  {d}
                </span>
              ))}
            </div>
            <div role="img" aria-label={`${grid.activeDays} active days and ${grid.totalTests} tests in the last ${weeks} weeks`} className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
              {grid.weeks.map((col, w) => (
                <div key={w} className="grid grid-rows-7 gap-[3px]">
                  {col.map((cell) => (
                    <span
                      key={cell.day}
                      className={styles.cell}
                      data-testid="activity-day"
                      data-day={cell.day}
                      data-level={cell.level}
                      data-future={cell.future ? "" : undefined}
                      data-today={cell.day === today ? "" : undefined}
                      title={cell.future ? undefined : describe(cell)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-sub" aria-hidden>
            less
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={styles.cell} data-level={l} style={{ width: 11 }} />
            ))}
            more
          </div>
        </div>

        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 text-sm">
          {[
            ["active days", grid.activeDays],
            ["tests", grid.totalTests],
            ["current streak", `${streak.current} d`],
            ["longest streak", `${streak.longest} d`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs whitespace-nowrap text-sub">{label}</dt>
              <dd className="mt-1 font-mono text-xl leading-none text-text tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
