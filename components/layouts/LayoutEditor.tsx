"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { Badge, Button, Card, ConfirmDialog, Icon, Input, Menu, cx, toast, useOutsidePointer } from "@/components/ui";
import {
  MAX_NAME_LENGTH,
  MAX_SOURCE_BYTES,
  checkSource,
  cleanName,
  exportFilename,
  exportLayoutJson,
  importLayoutText,
  type SourceCheck,
} from "@/lib/layout/custom";
import { PRESETS } from "@/lib/layout/presets";
import type { ParsedLayout } from "@/lib/types";
import { CodeEditor } from "./CodeEditor";

export interface EditorDraft {
  /** Set when editing a stored custom layout; absent for a new one. */
  id?: string;
  name: string;
  source: string;
}

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

export async function copyText(text: string, what = "Layout data"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied to clipboard`, { variant: "success" });
  } catch {
    toast("Couldn't reach the clipboard", { variant: "error", description: "Select the text and copy it by hand instead." });
  }
}

export function downloadLayout(name: string, source: string): void {
  const blob = new Blob([exportLayoutJson(name, source)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function FormatHelp() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useOutsidePointer([rootRef], open, () => setOpen(false));

  const row = (code: string, text: string) => (
    <li className="grid grid-cols-[minmax(0,116px)_minmax(0,1fr)] items-baseline gap-3">
      <code className="truncate rounded-ui-sm bg-text/[0.07] px-1.5 py-0.5 font-mono text-xs text-main">{code}</code>
      <span className="text-[13px] leading-snug text-text">{text}</span>
    </li>
  );

  return (
    <div
      ref={rootRef}
      className="static sm:relative"
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
          className="absolute inset-x-0 top-full z-30 mt-2 animate-pop-in rounded-ui border border-border bg-bg p-4 shadow-pop sm:right-0 sm:left-auto sm:w-[400px]"
        >
          <p className="text-sm font-medium text-text">Keyboard Layout Editor raw data</p>
          <p className="mt-1 text-[13px] leading-snug text-sub">One bracketed list per keyboard row, top to bottom. Inside a row:</p>
          <ul className="mt-3 flex flex-col gap-2">
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
            className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-main hover:underline"
          >
            Design visually on keyboard-layout-editor.com
            <Icon name="external" size={13} />
          </a>
          <p className="mt-1 text-xs text-sub">Copy the text from its "Raw data" tab and paste it here.</p>
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
  const [lastGood, setLastGood] = useState<ParsedLayout | null>(() => check.layout ?? null);
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
      if (next.layout) setLastGood(next.layout);
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
  const dirty = name !== draft.name || source !== draft.source;
  // `check` lags the text by the debounce; validate the exact text again on save.
  const canSave = !nameError && !empty && !check.error;

  const save = () => {
    if (nameError || empty) return;
    const final = checkSource(source);
    if (!final.layout) {
      setCheck(final);
      return;
    }
    onSave({ id: draft.id, name: trimmedName, source });
  };

  const cancel = () => (dirty ? setConfirmDiscard(true) : onCancel());

  const startFrom = (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setSource(preset.source);
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
      const fallback = file.name.replace(/(\.kle)?\.(json|txt)$/i, "").replace(/[-_]+/g, " ");
      if (!trimmedName || name === draft.name) setName(cleanName(imported.name ?? fallback) || name);
      toast(`Imported ${file.name}`, { variant: "success" });
    } catch {
      toast("Couldn't read that file", { variant: "error" });
    }
  };

  const preview = check.layout ?? lastGood;
  const stale = !!check.error && !!preview;
  const letters = useMemo(() => (preview ? new Set(preview.keys.map((k) => k.base).filter((b) => /^[a-z]$/.test(b))).size : 0), [preview]);

  return (
    <div data-testid="layout-editor" data-mode={isNew ? "new" : "edit"}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 sm:mb-8">
        <div className="min-w-0">
          <button
            type="button"
            onClick={cancel}
            data-testid="editor-back"
            className="mb-2 inline-flex items-center gap-1.5 rounded-ui-sm font-mono text-xs text-sub transition-colors hover:text-text"
          >
            <Icon name="arrow-left" size={13} />
            layouts
          </button>
          <h1 className="text-2xl font-semibold tracking-tight text-text sm:text-[28px]">
            {isNew ? "New custom layout" : "Edit layout"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── source ── */}
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <label htmlFor={nameId} className="mb-1.5 block text-[13px] font-medium text-text">
              Name
            </label>
            <Input
              id={nameId}
              data-testid="editor-name"
              value={name}
              maxLength={MAX_NAME_LENGTH}
              placeholder="e.g. My Colemak mod"
              aria-invalid={!!nameError && (dirty || !isNew)}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) save();
              }}
            />
            {nameError && (dirty || !isNew) && (
              <p className="mt-1.5 text-xs text-error" data-testid="editor-name-error">
                {nameError}
              </p>
            )}
          </div>

          <div>
            <div className="relative mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <label htmlFor={sourceId} className="text-[13px] font-medium text-text">
                Layout data
              </label>
              <div className="-mr-1 flex items-center">
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
              </div>
            </div>
            <CodeEditor
              id={sourceId}
              data-testid="editor-source"
              value={source}
              onChange={setSource}
              errorLine={check.error?.line}
              aria-invalid={!!check.error}
              aria-describedby={check.error ? errorId : undefined}
              placeholder={'["Q","W","E","R","T","Y"],\n["A","S","D","F","G","H"]\n\nPaste raw data, import a file, or start from a preset.'}
              className="h-[300px] sm:h-[360px]"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-sub" data-testid="editor-status">
                {source.split("\n").length} lines · {source.length.toLocaleString("en-US")} chars
              </span>
              <div className="-mr-1 flex items-center">
                <Button size="sm" variant="ghost" icon="copy" disabled={empty} data-testid="editor-copy" onClick={() => void copyText(source)}>
                  Copy
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="download"
                  disabled={empty}
                  data-testid="editor-download"
                  onClick={() => downloadLayout(trimmedName || "layout", source)}
                >
                  Download
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* ── preview ── */}
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex h-[21px] items-center justify-between gap-3 lg:mt-px">
            <span className="text-[13px] font-medium text-text">Preview</span>
            {preview && (
              <span className="flex items-center gap-2.5">
                {stale && <Badge data-testid="editor-preview-stale">last valid version</Badge>}
                <span className="font-mono text-xs text-sub" data-testid="editor-preview-meta" data-keys={preview.keys.length}>
                  {preview.keys.length} keys · {letters}/26 letters
                </span>
              </span>
            )}
          </div>
          <Card
            padding="none"
            className={cx("relative flex min-h-[200px] items-center justify-center px-3 py-6 sm:px-5 lg:min-h-[236px]")}
            data-testid="editor-preview"
            data-stale={stale || undefined}
          >
            {preview ? (
              <>
                <Keyboard2D layout={preview} fingerColors maxUnit={44} className={cx("transition-opacity duration-150", stale && "opacity-45")} />
              </>
            ) : (
              <div className="flex max-w-xs flex-col items-center gap-3 px-4 text-center">
                <Icon name="keyboard" size={28} className="text-sub/70" />
                <p className="text-[13px] leading-snug text-sub">
                  {check.error ? "Nothing to show until the data parses." : "Your keyboard appears here as you type."}
                </p>
              </div>
            )}
          </Card>

          {check.error ? (
            <div
              id={errorId}
              role="alert"
              data-testid="editor-error"
              data-line={check.error.line}
              data-column={check.error.column}
              className="flex items-start gap-3 rounded-ui border border-error/40 bg-error/[0.08] px-3.5 py-3"
            >
              <Icon name="alert" size={17} className="mt-0.5 shrink-0 text-error" />
              <div className="min-w-0">
                {check.error.line != null && (
                  <p className="font-mono text-xs font-semibold text-error">
                    Line {check.error.line}
                    {check.error.column != null && `, column ${check.error.column}`}
                  </p>
                )}
                <p className="text-[13px] leading-snug break-words text-text">{check.error.message.replace(/ \(line \d+, column \d+\)/, "")}</p>
              </div>
            </div>
          ) : check.warnings.length > 0 ? (
            <ul className="flex flex-col gap-2" data-testid="editor-warnings">
              {check.warnings.map((w) => (
                <li key={w} data-testid="editor-warning" className="flex items-start gap-3 rounded-ui bg-text/[0.05] px-3.5 py-2.5">
                  <Icon name="info" size={16} className="mt-0.5 shrink-0 text-main" />
                  <span className="text-[13px] leading-snug text-sub">{w}</span>
                </li>
              ))}
            </ul>
          ) : check.layout ? (
            <p className="flex items-center gap-2 px-1 text-[13px] text-sub" data-testid="editor-ok">
              <Icon name="check" size={15} className="text-success" />
              Looks good. Fingers and home row were recognised.
            </p>
          ) : null}
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
