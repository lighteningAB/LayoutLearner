"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, CardDescription, CardTitle, ConfirmDialog, Icon, IconButton, cx, toast } from "@/components/ui";
import type { StoredResult } from "@/lib/stats/store";
import { deleteResult } from "@/lib/stats/selectors";
import { modeLabel } from "./ProgressChart";

type SortKey = "at" | "mode" | "wpm" | "raw" | "accuracy" | "consistency";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "at", label: "date" },
  { key: "mode", label: "mode" },
  { key: "wpm", label: "wpm", numeric: true },
  { key: "raw", label: "raw", numeric: true },
  { key: "accuracy", label: "accuracy", numeric: true },
  { key: "consistency", label: "consistency", numeric: true },
];

const PAGE = 10;

const fmtDate = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtTime = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export interface HistoryTableProps {
  /** Results of the selected range. */
  results: StoredResult[];
  /** Result ids holding the current personal best of their mode. */
  bestIds: Set<string>;
  rangeLabel: string;
}

export function HistoryTable({ results, bestIds, rangeLabel }: HistoryTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "at", dir: -1 });
  const [visible, setVisible] = useState(PAGE);
  const [pendingDelete, setPendingDelete] = useState<StoredResult | null>(null);

  useEffect(() => setVisible(PAGE), [rangeLabel]);

  const sorted = useMemo(() => {
    const value = (r: StoredResult): number | string => (sort.key === "mode" ? `${r.mode}:${String(r.modeValue).padStart(5, "0")}` : r[sort.key]);
    return results.slice().sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return c * sort.dir || b.at - a.at;
    });
  }, [results, sort]);

  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "mode" ? 1 : -1 }));
  const rows = sorted.slice(0, visible);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <CardTitle>History</CardTitle>
          <CardDescription>
            {results.length} test{results.length === 1 ? "" : "s"} {rangeLabel}. Click a column to sort.
          </CardDescription>
        </div>
      </div>

      {results.length === 0 ? (
        <p className="mt-5 text-sm text-sub" data-testid="history-table" data-rows={0}>
          No tests in this period.
        </p>
      ) : (
        <>
          <div className="relative -mx-5 mt-4 overflow-x-auto px-5">
            <table data-testid="history-table" data-rows={results.length} data-sort={`${sort.key}:${sort.dir === 1 ? "asc" : "desc"}`} className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  {COLUMNS.map((c) => {
                    const on = sort.key === c.key;
                    return (
                      <th key={c.key} scope="col" aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cx("p-0 font-normal", c.numeric ? "text-right" : "text-left")}>
                        <button
                          type="button"
                          data-testid={`sort-${c.key}`}
                          onClick={() => onSort(c.key)}
                          className={cx(
                            "inline-flex h-9 items-center gap-1 text-xs whitespace-nowrap transition-colors hover:text-text",
                            c.numeric ? "pl-3" : "pr-3",
                            on ? "text-text" : "text-sub",
                          )}
                        >
                          {c.label}
                          <Icon name={on && sort.dir === 1 ? "arrow-up" : "arrow-down"} size={12} className={on ? "opacity-100" : "opacity-0"} />
                        </button>
                      </th>
                    );
                  })}
                  <th scope="col" aria-label="actions" className="w-10 p-0" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const best = bestIds.has(r.id);
                  return (
                    <tr key={r.id} data-testid="history-row" data-id={r.id} data-wpm={r.wpm} data-best={best ? "" : undefined} className="group border-b border-border/60 last:border-b-0">
                      <td className="py-2.5 pr-3 whitespace-nowrap text-text">
                        {fmtDate(r.at)} <span className="text-sub">{fmtTime(r.at)}</span>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[13px] whitespace-nowrap text-sub">{modeLabel(r)}</td>
                      <td className="py-2.5 pl-3 text-right font-mono whitespace-nowrap tabular-nums">
                        {best && (
                          <Badge tone="success" icon="trophy" className="mr-2 align-middle" title="Personal best for this mode">
                            pb
                          </Badge>
                        )}
                        <span className={cx("font-medium", best ? "text-success" : "text-main")}>{r.wpm.toFixed(1)}</span>
                      </td>
                      <td className="py-2.5 pl-3 text-right font-mono text-sub tabular-nums">{r.raw.toFixed(1)}</td>
                      <td className="py-2.5 pl-3 text-right font-mono text-text tabular-nums">{r.accuracy.toFixed(1)}%</td>
                      <td className="py-2.5 pl-3 text-right font-mono text-sub tabular-nums">{Math.round(r.consistency)}%</td>
                      <td className="py-1 pl-2 text-right">
                        <IconButton icon="trash" size="sm" label="Delete this test" data-testid="history-delete" onClick={() => setPendingDelete(r)} className="opacity-60 hover:opacity-100" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(sorted.length > PAGE || visible < sorted.length) && (
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-sub">
              <span data-testid="history-count">
                showing {rows.length} of {sorted.length}
              </span>
              {visible < sorted.length ? (
                <Button size="sm" variant="subtle" iconRight="chevron-down" data-testid="history-more" onClick={() => setVisible((v) => v + PAGE * 2)}>
                  Show more
                </Button>
              ) : (
                <Button size="sm" variant="ghost" iconRight="chevron-up" onClick={() => setVisible(PAGE)}>
                  Show fewer
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteResult(pendingDelete.id);
            toast("Test deleted", { variant: "success" });
          }
          setPendingDelete(null);
        }}
        title="Delete this test?"
        description={
          pendingDelete
            ? `${Math.round(pendingDelete.wpm)} wpm on ${fmtDate(pendingDelete.at)}, ${fmtTime(pendingDelete.at)}. It is removed from your history and averages; per-key stats are kept. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
        data-testid="history-delete-confirm"
      />
    </div>
  );
}
