"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, useRegisterCommands, type Command } from "@/components/shell";
import { Button, ConfirmDialog, Icon, SegmentedControl, toast, type MenuItem } from "@/components/ui";
import { newCustomId, uniqueName } from "@/lib/layout/custom";
import { DEFAULT_PRESET_ID, PRESETS } from "@/lib/layout/presets";
import { useSettings } from "@/lib/settings";
import { FAMILY_LABEL, useLayoutCatalog, type Family, type LayoutEntry } from "./catalog";
import { LayoutCard } from "./LayoutCard";
import { LayoutDetail } from "./LayoutDetail";
import { LayoutEditor, copyText, downloadLayout, type EditorDraft } from "./LayoutEditor";

type Filter = "all" | Family;
const FAMILY_ORDER: Family[] = ["ansi-60", "ansi-100", "ortho", "split", "custom"];

const filterLabel = (text: string, count: number) => (
  <>
    {text}
    <span className="font-mono text-[11px] opacity-60">{count}</span>
  </>
);

export function LayoutsView() {
  const router = useRouter();
  const [settings, update] = useSettings();
  const entries = useLayoutCatalog(settings.customLayouts);
  const [filter, setFilter] = useState<Filter>("all");
  /** Layout shown in the detail panel; null follows the active layout. */
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LayoutEntry | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const activeId = entries.some((e) => e.id === settings.layoutId && e.layout) ? settings.layoutId : DEFAULT_PRESET_ID;
  const inspected = entries.find((e) => e.id === inspectedId) ?? entries.find((e) => e.id === activeId) ?? entries[0];
  const baseline = entries.find((e) => e.id === "qwerty");

  const select = useCallback(
    (entry: LayoutEntry, quiet = false) => {
      if (!entry.layout) return;
      setInspectedId(entry.id);
      if (settings.layoutId === entry.id) return;
      update({ layoutId: entry.id });
      if (!quiet) toast(`Now learning ${entry.name}`, { variant: "success", description: "Tests, lessons and the hands view use this layout." });
    },
    [settings.layoutId, update],
  );

  const inspect = useCallback((entry: LayoutEntry) => {
    setInspectedId(entry.id);
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const openEditor = useCallback((next: EditorDraft) => {
    setDraft(next);
    window.scrollTo({ top: 0 });
  }, []);

  const openNew = useCallback(() => openEditor({ name: "", source: "" }), [openEditor]);

  const duplicate = useCallback(
    (entry: LayoutEntry) => openEditor({ name: uniqueName(`${entry.name} copy`, settings.customLayouts), source: entry.source }),
    [openEditor, settings.customLayouts],
  );

  const edit = useCallback((entry: LayoutEntry) => openEditor({ id: entry.id, name: entry.name, source: entry.source }), [openEditor]);

  const saveDraft = (d: EditorDraft) => {
    const id = d.id ?? newCustomId(settings.customLayouts.map((l) => l.id));
    const record = { id, name: d.name, source: d.source };
    update((prev) => ({
      customLayouts: prev.customLayouts.some((l) => l.id === id)
        ? prev.customLayouts.map((l) => (l.id === id ? record : l))
        : [...prev.customLayouts, record],
    }));
    setDraft(null);
    setInspectedId(id);
    setFilter((f) => (f === "all" || f === "custom" ? f : "all"));
    toast(d.id ? `Saved ${d.name}` : `Created ${d.name}`, {
      variant: "success",
      description: d.id || settings.layoutId === id ? undefined : "Select its card to start learning it.",
    });
  };

  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    const wasActive = settings.layoutId === target.id;
    update((prev) => ({
      customLayouts: prev.customLayouts.filter((l) => l.id !== target.id),
      ...(prev.layoutId === target.id ? { layoutId: DEFAULT_PRESET_ID } : {}),
    }));
    if (inspectedId === target.id) setInspectedId(null);
    if (draft?.id === target.id) setDraft(null);
    toast(`Deleted ${target.name}`, {
      description: wasActive ? `Switched back to ${PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)?.name ?? "the default layout"}.` : undefined,
    });
  };

  const practice = (entry: LayoutEntry, href: string) => {
    select(entry, true);
    router.push(href);
  };

  // Command palette: one command per layout + "New custom layout".
  const commands = useMemo<Command[]>(
    () => [
      ...entries
        .filter((e) => e.layout)
        .map<Command>((e) => ({
          id: `layout:${e.id}`,
          label: `Layout: ${e.name}`,
          group: "Layout",
          icon: "keyboard",
          keywords: `${FAMILY_LABEL[e.family]} switch keyboard`,
          hint: e.id === activeId ? "current" : undefined,
          run: () => select(e),
        })),
      { id: "layout:new", label: "New custom layout", group: "Layout", icon: "plus", keywords: "create kle import editor", run: openNew },
    ],
    [entries, activeId, select, openNew],
  );
  useRegisterCommands(commands);

  // A custom layout deleted elsewhere (another tab, "clear all data") must not leave the editor orphaned.
  useEffect(() => {
    if (draft?.id && !settings.customLayouts.some((l) => l.id === draft.id)) setDraft(null);
  }, [draft, settings.customLayouts]);

  const deleteDialog = (
    <ConfirmDialog
      open={!!deleteTarget}
      onClose={() => setDeleteTarget(null)}
      onConfirm={confirmDelete}
      title={`Delete ${deleteTarget?.name ?? "layout"}?`}
      description={
        deleteTarget && settings.layoutId === deleteTarget.id
          ? "This is the layout you are learning. It will be removed from this browser and you will be switched back to QWERTY."
          : "It will be removed from this browser. Download it first if you want a copy."
      }
      confirmLabel="Delete"
      tone="danger"
      data-testid="layout-delete-dialog"
    />
  );

  if (draft) {
    const taken = new Set(entries.filter((e) => e.id !== draft.id).map((e) => e.name.toLowerCase()));
    const editing = draft.id ? entries.find((e) => e.id === draft.id) : undefined;
    return (
      <>
        <LayoutEditor
          key={draft.id ?? "new"}
          draft={draft}
          takenNames={taken}
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
          onDelete={editing ? () => setDeleteTarget(editing) : undefined}
        />
        {deleteDialog}
      </>
    );
  }

  const counts = new Map<Filter, number>([["all", entries.length]]);
  for (const e of entries) counts.set(e.family, (counts.get(e.family) ?? 0) + 1);
  const visible = filter === "all" ? entries : entries.filter((e) => e.family === filter);
  const customCount = counts.get("custom") ?? 0;
  const showNewCard = filter === "all" || filter === "custom";

  const menuFor = (entry: LayoutEntry): MenuItem[] => [
    { label: "Show details", icon: "eye", onSelect: () => inspect(entry) },
    ...(entry.isCustom ? [{ label: "Edit", icon: "edit", onSelect: () => edit(entry) } satisfies MenuItem] : []),
    { label: entry.isCustom ? "Duplicate" : "Duplicate and edit", icon: "copy", onSelect: () => duplicate(entry) },
    { label: "Copy data", icon: "code", separator: true, onSelect: () => void copyText(entry.source) },
    { label: "Download .json", icon: "download", onSelect: () => downloadLayout(entry.name, entry.source) },
    ...(entry.isCustom
      ? [{ label: "Delete", icon: "trash", danger: true, separator: true, onSelect: () => setDeleteTarget(entry) } satisfies MenuItem]
      : []),
  ];

  return (
    <div data-testid="layouts-view" data-active-layout={activeId}>
      <PageHeader
        title="Layouts"
        description="Choose the layout you are learning, see how it compares, or bring your own."
        actions={
          <Button icon="plus" data-testid="new-layout" onClick={openNew}>
            New layout
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl<Filter>
          aria-label="Filter layouts by family"
          data-testid="layout-filter"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: filterLabel("All", entries.length) },
            ...FAMILY_ORDER.map((f) => ({ value: f as Filter, label: filterLabel(FAMILY_LABEL[f], counts.get(f) ?? 0) })),
          ]}
        />
        <p className="hidden text-xs text-sub md:block">Click a layout to start learning it.</p>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="layout-gallery">
        {visible.map((entry) => (
          <LayoutCard
            key={entry.id}
            entry={entry}
            selected={entry.id === activeId}
            inspected={entry.id === inspected?.id}
            onSelect={select}
            onInspect={inspect}
            menuItems={menuFor(entry)}
          />
        ))}
        {showNewCard && (
          <li className="min-w-0">
            <button
              type="button"
              onClick={openNew}
              data-testid="new-layout-card"
              className="group flex h-full min-h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-ui-lg border border-dashed border-border px-6 py-8 text-center transition-colors duration-150 hover:border-main/70 hover:bg-main/[0.04]"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-text/[0.07] text-sub transition-colors duration-150 group-hover:bg-main/[0.16] group-hover:text-main">
                <Icon name="plus" size={20} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold tracking-tight text-text">
                  {customCount === 0 ? "Bring your own layout" : "New custom layout"}
                </span>
                <span className="mx-auto mt-1 block max-w-[250px] text-[13px] leading-snug text-sub">
                  {customCount === 0
                    ? "Tweak a preset, paste raw data from keyboard-layout-editor.com, or import a .json file."
                    : "Start from a preset, paste raw data or import a file."}
                </span>
              </span>
            </button>
          </li>
        )}
      </ul>

      <div ref={detailRef} className="mt-12 scroll-mt-6 border-t border-border pt-10 sm:mt-14">
        {inspected && (
          <LayoutDetail
            key={inspected.id}
            entry={inspected}
            baseline={baseline}
            active={inspected.id === activeId}
            onUse={select}
            onPractice={practice}
            onEdit={edit}
            onDuplicate={duplicate}
            onDelete={setDeleteTarget}
          />
        )}
      </div>

      {deleteDialog}
    </div>
  );
}
