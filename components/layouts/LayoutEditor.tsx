"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { Badge, Button, ConfirmDialog, Icon, IconButton, Input, Menu, SegmentedControl, cx, toast, useOutsidePointer } from "@/components/ui";
import {
  MAX_NAME_LENGTH,
  MAX_SOURCE_BYTES,
  checkSource,
  cleanName,
  importLayoutText,
  layoutWarnings,
  type SourceCheck,
} from "@/lib/layout/custom";
import {
  applyFingerOverrides,
  countStaleOverrides,
  pruneOverrides,
  setKeyOverride,
  type FingerOverrides,
} from "@/lib/layout/overrides";
import { applyLayers, layersEqual, parsePreset, pruneLayers, setActivators, type Layers } from "@/lib/layout/layers";
import { displayLegends } from "@/lib/layout/parse";
import { PRESETS } from "@/lib/layout/presets";
import type { FingerId, LayoutKey, ParsedLayout } from "@/lib/types";
import { CodeEditor } from "./CodeEditor";
import { Note, Pane } from "./drafting";
import { FingerPicker } from "./FingerPicker";
import { LayersPanel } from "./LayersPanel";
import { copyText, downloadLayout } from "./layoutIo";

export interface EditorDraft {
  /** Set when editing a stored custom layout; absent for a new one. */
  id?: string;
  name: string;
  source: string;
  /** Per-key finger corrections. */
  fingers?: FingerOverrides;
  /** Extra firmware layers (Lower / Raise …). */
  layers?: Layers;
  /** Which view the editor opens in (default "source"). */
  mode?: EditorMode;
}

export type EditorMode = "source" | "fingers" | "layers";

const keyName = (k: LayoutKey) => displayLegends(k.label).join(" ").trim() || (k.base === " " ? "Space" : "Key");
const sameFinger = (a?: FingerId | null, b?: FingerId | null) => (a ?? null) === (b ?? null) || (!!a && !!b && a.hand === b.hand && a.finger === b.finger);

export interface LayoutEditorProps {
  draft: EditorDraft;
  /** Names already taken by other layouts (lower-cased). */
  takenNames: ReadonlySet<string>;
  onSave: (draft: EditorDraft) => void;
  onCancel: () => void;
  /** Present when editing a stored layout. */
  onDelete?: () => void;
}

const PARSE_DEBOUNCE_MS = 220;
const EMPTY_CHECK: SourceCheck = { warnings: [] };

const MODE_NOTE: Record<EditorMode, string> = {
  source: "The board itself: one bracketed list per row. The preview redraws as you type.",
  fingers: "Correct which finger presses a key. Changes apply to tests, lessons and the hands view.",
  layers: "Give keys extra characters while a layer key is held. Changes apply to the keyboard guide and lessons.",
};

function FormatHelp() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useOutsidePointer([rootRef], open, () => setOpen(false));

  const row = (code: string, text: string) => (
    <li className="grid grid-cols-[minmax(0,116px)_minmax(0,1fr)] items-baseline gap-3 border-t border-hairline py-2 first:border-t-0">
      <code className="truncate font-mono text-sm text-text">{code}</code>
      <span className="text-md leading-snug text-sub">{text}</span>
    </li>
  );

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <Button
        size="sm"
        variant="ghost"
        icon="info"
        aria-expanded={open}
        aria-controls={id}
        data-testid="editor-help"
        onClick={() => setOpen((o) => !o)}
      >
        Format help
      </Button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Layout data format"
          data-testid="editor-help-popover"
          className="absolute top-full right-0 z-30 mt-2 w-[min(400px,calc(100vw-3rem))] animate-pop-in border border-line bg-bg"
        >
          <p className="ll-lettering border-b border-line px-4 py-3 text-text">Keyboard Layout Editor raw data</p>
          <div className="px-4 pt-3 pb-4">
            <p className="text-md leading-snug text-sub">One bracketed list per keyboard row, top to bottom. Inside a row:</p>
            <ul className="mt-2">
              {row('"Q"', "A string is one key.")}
              {row('"!\\n1"', "Shifted character over the base one.")}
              {row("{w:1.5}", "The next key is 1.5 units wide.")}
              {row("{x:0.5}", "Leave a half-unit gap before the next key.")}
              {row('"Shift", ""', "Names make modifier keys; an empty string is the space bar.")}
            </ul>
            <a
              href="http://www.keyboard-layout-editor.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-md font-medium text-text underline decoration-main decoration-2 underline-offset-4 hover:text-main"
            >
              Design visually on keyboard-layout-editor.com
              <Icon name="external" size={14} />
            </a>
            <p className="mt-1.5 text-md text-sub">Copy the text from its &quot;Raw data&quot; tab and paste it here.</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function LayoutEditor({ draft, takenNames, onSave, onCancel, onDelete }: LayoutEditorProps) {
  const isNew = !draft.id;
  const [name, setName] = useState(draft.name);
  const [source, setSource] = useState(draft.source);
  const [check, setCheck] = useState<SourceCheck>(() => (draft.source.trim() ? checkSource(draft.source) : EMPTY_CHECK));
  const [lastGood, setLastGood] = useState<ParsedLayout | null>(() => check.base ?? null);
  const [mode, setMode] = useState<EditorMode>(draft.mode ?? "source");
  const [overrides, setOverrides] = useState<FingerOverrides | undefined>(draft.fingers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layers, setLayers] = useState<Layers>(draft.layers);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(draft.layers?.[0]?.id ?? null);
  const [settingActivator, setSettingActivator] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const sourceId = useId();
  const errorId = useId();

  // Debounced parse; the preview keeps showing the last layout that parsed.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = source.trim() ? checkSource(source) : EMPTY_CHECK;
      setCheck(next);
      if (next.base) setLastGood(next.base);
      else if (!source.trim()) setLastGood(null);
    }, PARSE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [source]);

  const trimmedName = cleanName(name);
  const empty = !source.trim();
  const nameError = !trimmedName
    ? "Give the layout a name."
    : takenNames.has(trimmedName.toLowerCase())
      ? `Another layout is already called "${trimmedName}".`
      : undefined;
  const dirty = name !== draft.name || source !== draft.source || JSON.stringify(overrides ?? null) !== JSON.stringify(draft.fingers ?? null) || !layersEqual(layers, draft.layers);
  // `check` lags the text by the debounce; validate the exact text again on save.
  const canSave = !nameError && !empty && !check.error;

  const save = () => {
    if (nameError || empty) return;
    const final = checkSource(source);
    if (!final.layout) {
      setCheck(final);
      return;
    }
    // Overrides whose key is gone or changed are not kept.
    onSave({
      id: draft.id,
      name: trimmedName,
      source,
      fingers: final.base ? pruneOverrides(final.base, overrides).overrides : overrides,
      layers: final.base ? pruneLayers(final.base, layers) : layers,
    });
  };

  const cancel = () => (dirty ? setConfirmDiscard(true) : onCancel());

  const startFrom = (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSource(preset.source);
    setOverrides(undefined);
    const presetLayers = parsePreset(preset).layers;
    setLayers(presetLayers);
    setActiveLayerId(presetLayers?.[0]?.id ?? null);
    setSettingActivator(false);
    setSelectedId(null);
    if (!trimmedName || name === draft.name) setName(`${preset.name} copy`.slice(0, MAX_NAME_LENGTH));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_SOURCE_BYTES) {
      toast("That file is too large to be a layout", {
        variant: "error",
        description: `${Math.round(file.size / 1000)} KB; the limit is ${MAX_SOURCE_BYTES / 1000} KB.`,
      });
      return;
    }
    try {
      const imported = importLayoutText(await file.text());
      setSource(imported.source);
      setOverrides(imported.fingers);
      setLayers(imported.layers);
      setActiveLayerId(imported.layers?.[0]?.id ?? null);
      setSettingActivator(false);
      setSelectedId(null);
      const fallback = file.name.replace(/(\.kle)?\.(json|txt)$/i, "").replace(/[-_]+/g, " ");
      if (!trimmedName || name === draft.name) setName(cleanName(imported.name ?? fallback) || name);
      toast(`Imported ${file.name}`, {
        variant: "success",
        description:
          [
            imported.fingers ? `${Object.keys(imported.fingers).length} finger overrides` : "",
            imported.layers ? `${imported.layers.length} ${imported.layers.length === 1 ? "layer" : "layers"}` : "",
          ]
            .filter(Boolean)
            .join(", ")
            .replace(/^(.+)$/, "$1 included.") || undefined,
      });
    } catch {
      toast("Couldn't read that file", { variant: "error" });
    }
  };

  const base = check.base ?? lastGood;
  // Overrides apply instantly (no debounce): the preview is always base + overrides.
  const preview = useMemo(() => (base ? applyLayers(applyFingerOverrides(base, overrides), layers) : null), [base, overrides, layers]);
  const stale = !!check.error && !!preview;
  const staleCount = base ? countStaleOverrides(base, overrides) : 0;
  const markedIds = useMemo(() => {
    if (!overrides || !base) return [];
    const byId = new Map(base.keys.map((k) => [k.id, k]));
    return Object.keys(overrides).filter((id) => {
      const k = byId.get(id);
      return k && (overrides[id].label === undefined || overrides[id].label === k.label);
    });
  }, [overrides, base]);
  const warnings = useMemo(() => (check.layout && preview ? layoutWarnings(preview) : check.warnings), [check, preview]);
  const selectedKey = preview?.keys.find((k) => k.id === selectedId);
  // The layer on show in the Layers view comes straight from the draft: a new layer has no activator yet
  // (so the layout drops it), and the board must still show it.
  const activeLayer = mode === "layers" ? (layers?.find((l) => l.id === activeLayerId) ?? null) : null;
  const layerKeyClick = (id: string) => {
    if (!activeLayer) return;
    if (settingActivator) {
      const has = activeLayer.activatorIds.includes(id);
      setLayers((prev) => setActivators(prev, activeLayer.id, has ? activeLayer.activatorIds.filter((a) => a !== id) : [...activeLayer.activatorIds, id]));
    } else setSelectedId(id);
  };
  const baseKey = base?.keys.find((k) => k.id === selectedId);

  /** Stores a choice; one that equals what the parser guessed is no override at all. */
  const commit = (choice: { finger: FingerId | null; isHome: boolean }) => {
    if (!base || !baseKey || !selectedId) return;
    const automatic = sameFinger(choice.finger, baseKey.finger) && (choice.finger ? !!baseKey.isHome === choice.isHome : true);
    setOverrides((prev) => setKeyOverride(base, prev, selectedId, automatic ? "auto" : choice));
  };
  const chooseFinger = (finger: FingerId | null) => {
    if (!selectedKey) return;
    commit({ finger, isHome: finger ? sameFinger(finger, selectedKey.finger) && !!selectedKey.isHome : false });
  };
  const chooseHome = (home: boolean) => {
    if (selectedKey?.finger) commit({ finger: selectedKey.finger, isHome: home });
  };
  const resetKey = () => selectedId && base && setOverrides((prev) => setKeyOverride(base, prev, selectedId, "auto"));
  const customisedCount = markedIds.length;
  const closePicker = () => {
    const id = selectedId;
    setSelectedId(null);
    if (id) window.setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="editor-preview"] [data-key-id="${id}"]`)?.focus(), 0);
  };
  const letters = useMemo(() => (preview ? new Set(preview.keys.map((k) => k.base).filter((b) => /^[a-z]$/.test(b))).size : 0), [preview]);
  const showNameError = !!nameError && (dirty || !isNew);

  const hasFingers = !!preview?.keys.some((k) => k.finger);
  const fingersPanel = (
    <div className="flex flex-col gap-4 p-3 sm:p-4" data-testid="fingers-panel">
      {selectedKey && baseKey ? (
        <FingerPicker
          keyName={keyName(selectedKey)}
          finger={selectedKey.finger ?? null}
          isHome={!!selectedKey.isHome}
          autoFinger={baseKey.finger ?? null}
          autoHome={!!baseKey.isHome}
          customised={markedIds.includes(selectedKey.id)}
          onFinger={chooseFinger}
          onHome={chooseHome}
          onReset={resetKey}
          onClose={closePicker}
        />
      ) : (
        <Note icon="hand" data-testid="finger-hint">
          <span className="text-sub">
            {preview
              ? "Select a key on the keyboard to choose which finger presses it and whether it is a home key. Arrow keys move between keys; Enter selects."
              : "Fix the layout data first; the keyboard appears here when it parses."}
          </span>
        </Note>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline pt-3">
        <p className="text-md text-sub" data-testid="override-count" data-count={customisedCount} aria-live="polite">
          {customisedCount === 0 ? "No keys customised" : `${customisedCount} ${customisedCount === 1 ? "key" : "keys"} customised`}
          {!hasFingers && preview ? " · no automatic fingers for this board" : ""}
        </p>
        <Button
          size="sm"
          variant="ghost"
          icon="restart"
          disabled={customisedCount === 0 && staleCount === 0}
          data-testid="fingers-reset-all"
          onClick={() => {
            setOverrides(undefined);
            setSelectedId(null);
          }}
        >
          Reset all to automatic
        </Button>
      </div>
    </div>
  );

  const sourcePane = (
    <Pane
      heading="div"
      title={<label htmlFor={sourceId}>Layout data</label>}
      className="relative"
      tools={
        <>
          <Menu
            aria-label="Start from a preset"
            align="end"
            items={PRESETS.map((p) => ({ id: p.id, label: p.name, onSelect: () => startFrom(p.id) }))}
            trigger={(props) => (
              <Button size="sm" variant="ghost" icon="copy" data-testid="editor-start-from" {...props}>
                Start from
              </Button>
            )}
          />
          <Button size="sm" variant="ghost" icon="upload" data-testid="editor-import" onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <FormatHelp />
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-label="Import a layout file"
            data-testid="editor-file"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
      }
    >
      <CodeEditor
        id={sourceId}
        data-testid="editor-source"
        value={source}
        onChange={setSource}
        errorLine={check.error?.line}
        aria-invalid={!!check.error}
        aria-describedby={check.error ? errorId : undefined}
        placeholder={'["Q","W","E","R","T","Y"],\n["A","S","D","F","G","H"]\n\nPaste raw data, import a file, or start from a preset.'}
        className="h-[300px] border-0 sm:h-[400px]"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-t border-border py-1 pr-1 pl-3 sm:pl-4">
        <span className="ll-note text-sub" data-testid="editor-status">
          {source.split("\n").length} lines · {source.length.toLocaleString("en-US")} chars
        </span>
        <div className="flex items-center">
          <Button size="sm" variant="ghost" icon="copy" disabled={empty} data-testid="editor-copy" onClick={() => void copyText(source)}>
            Copy
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="download"
            disabled={empty}
            data-testid="editor-download"
            onClick={() => downloadLayout(trimmedName || "layout", source, overrides, layers)}
          >
            Download
          </Button>
        </div>
      </div>
    </Pane>
  );

  return (
    <div data-testid="layout-editor" data-mode={isNew ? "new" : "edit"}>
      {/* Heading line: back, lettered title, a rule run out to the actions. */}
      <div className="mb-7 flex flex-wrap items-end gap-x-4 gap-y-4 sm:mb-9">
        <IconButton icon="arrow-left" label="Back to layouts" variant="subtle" data-testid="editor-back" className="mb-0.5" onClick={cancel} />
        <h1 className="ll-title min-w-0 text-text [font-size:clamp(1.75rem,1.2rem+1.9vw,2.875rem)]">{isNew ? "New custom layout" : "Edit layout"}</h1>
        <span aria-hidden className="mb-2 hidden h-px min-w-8 flex-1 bg-border lg:block" />
        <div className="flex flex-wrap items-center gap-2 max-lg:w-full">
          {onDelete && (
            <Button variant="ghost" icon="trash" data-testid="editor-delete" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="ghost" data-testid="editor-cancel" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" data-testid="editor-save" disabled={!canSave} onClick={save}>
            {isNew ? "Save layout" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* The working sheet: name, view switch, then two ruled panes. */}
      <div className="border border-line">
        <div className="grid border-b border-line md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start">
            <label htmlFor={nameId} className="ll-lettering flex h-12 items-center border-r border-border px-3 text-text sm:px-4">
              Name
            </label>
            <div className="min-w-0">
              <Input
                id={nameId}
                data-testid="editor-name"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                placeholder="e.g. My Colemak mod"
                aria-invalid={showNameError}
                aria-describedby={showNameError ? `${nameId}-error` : undefined}
                className="h-12 border-0 bg-transparent px-3 text-lg hover:bg-fill focus:bg-fill sm:px-4"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSave) save();
                }}
              />
              {showNameError && (
                <p id={`${nameId}-error`} className="flex items-center gap-2 border-t border-error px-3 py-2 text-md text-error sm:px-4" data-testid="editor-name-error">
                  <Icon name="alert" size={15} className="shrink-0" />
                  {nameError}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center border-t border-border px-2 py-2 md:border-t-0 md:border-l">
            <SegmentedControl<EditorMode>
              aria-label="Editor view"
              data-testid="editor-mode"
              size="sm"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setSelectedId(null);
                setSettingActivator(false);
                if (m === "layers" && !layers?.some((l) => l.id === activeLayerId)) setActiveLayerId(layers?.[0]?.id ?? null);
              }}
              options={[
                { value: "source", label: "Layout data", icon: "code", testId: "editor-mode-source" },
                { value: "fingers", label: "Fingers", icon: "hand", testId: "editor-mode-fingers" },
                { value: "layers", label: "Layers", icon: "layers", testId: "editor-mode-layers" },
              ]}
            />
          </div>
        </div>
        <p className="border-b border-border px-3 py-2 text-md text-sub sm:px-4">{MODE_NOTE[mode]}</p>

        <div className="grid lg:grid-cols-2">
          {/* ── working pane: data, fingers or layers ── */}
          <div className="flex min-w-0 flex-col lg:border-r lg:border-border">
            {mode === "layers" ? (
              <Pane title="Layers" meta={`${layers?.length ?? 0} on this layout`}>
                <LayersPanel
                  layout={preview}
                  layers={layers}
                  onChange={setLayers}
                  activeId={activeLayerId}
                  onActiveId={setActiveLayerId}
                  selectedKey={selectedKey ?? null}
                  settingActivator={settingActivator}
                  onSettingActivator={setSettingActivator}
                  onClearSelection={() => setSelectedId(null)}
                />
              </Pane>
            ) : mode === "fingers" ? (
              <Pane title="Fingers" meta={customisedCount > 0 ? `${customisedCount} customised` : "automatic"}>
                {fingersPanel}
              </Pane>
            ) : (
              sourcePane
            )}
          </div>

          {/* ── preview ── */}
          <Pane
            title="Preview"
            className={cx("border-border max-lg:border-t", mode !== "source" && "order-first max-lg:border-t-0 max-lg:border-b lg:order-none")}
            bodyClassName="flex flex-col"
            meta={
              preview ? (
                <span data-testid="editor-preview-meta" data-keys={preview.keys.length}>
                  {preview.keys.length} keys · {letters}/26 letters
                </span>
              ) : undefined
            }
            tools={stale ? <Badge data-testid="editor-preview-stale">last valid version</Badge> : undefined}
          >
            <div
              className="ll-grid relative flex min-h-[220px] flex-1 items-center justify-center px-3 py-7 sm:px-5 lg:min-h-[280px]"
              data-testid="editor-preview"
              data-stale={stale || undefined}
            >
              {preview ? (
                <Keyboard2D
                  layout={preview}
                  fingerColors
                  maxUnit={44}
                  className={cx("transition-opacity duration-150", stale && "opacity-45")}
                  {...(mode === "layers" && !stale
                    ? {
                        layer: activeLayer,
                        onKeyClick: layerKeyClick,
                        selectedKeyIds: selectedId && !settingActivator ? [selectedId] : undefined,
                        highlightKeyIds: activeLayer?.activatorIds,
                      }
                    : mode === "fingers" && !stale
                      ? {
                          onKeyClick: setSelectedId,
                          selectedKeyIds: selectedId ? [selectedId] : undefined,
                          markedKeyIds: markedIds,
                        }
                      : { markedKeyIds: mode === "fingers" ? markedIds : undefined })}
                />
              ) : (
                <div className="flex max-w-xs flex-col items-center gap-3 border border-dashed border-border px-6 py-6 text-center">
                  <Icon name="keyboard" size={28} className="text-sub" />
                  <p className="text-md leading-snug text-sub">
                    {check.error ? "Nothing to show until the data parses." : "Your keyboard appears here as you type."}
                  </p>
                </div>
              )}
            </div>

            {(check.error || warnings.length > 0 || check.layout || staleCount > 0) && (
              <div className="flex flex-col gap-2 border-t border-border p-3 sm:p-4">
                {check.error ? (
                  <Note
                    id={errorId}
                    role="alert"
                    tone="error"
                    data-testid="editor-error"
                    data-line={check.error.line}
                    data-column={check.error.column}
                    title={
                      check.error.line != null ? (
                        <>
                          Line {check.error.line}
                          {check.error.column != null && `, column ${check.error.column}`}
                        </>
                      ) : (
                        "Layout data can't be read"
                      )
                    }
                  >
                    {check.error.message.replace(/ \(line \d+, column \d+\)/, "")}
                  </Note>
                ) : warnings.length > 0 ? (
                  <ul className="flex flex-col gap-2" data-testid="editor-warnings">
                    {warnings.map((w) => (
                      <li key={w} data-testid="editor-warning">
                        <Note tone="warn">{w}</Note>
                      </li>
                    ))}
                  </ul>
                ) : check.layout ? (
                  <p className="flex items-center gap-2 text-md text-text" data-testid="editor-ok">
                    <Icon name="check" size={16} className="text-success" />
                    Looks good. Fingers and home row were recognised.
                  </p>
                ) : null}
                {staleCount > 0 && (
                  <Note tone="warn" data-testid="override-dropped" data-count={staleCount} role="status">
                    {staleCount === 1 ? "1 finger override no longer matches a key" : `${staleCount} finger overrides no longer match a key`} after your edits to
                    the layout data. {staleCount === 1 ? "It was" : "They were"} dropped and will not be saved.
                  </Note>
                )}
              </div>
            )}
          </Pane>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={onCancel}
        title="Discard changes?"
        description="Your edits to this layout have not been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
      />
    </div>
  );
}
