"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, IconButton, Modal, cx } from "@/components/ui";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { KeymapImportError, detectFormat, parseKeymap, type KeymapFormat } from "@/lib/layout/keymap/index";
import { mapKeymapToLayers, type KeymapMapping } from "@/lib/layout/keymap/apply";
import type { LayoutLayer, ParsedLayout } from "@/lib/types";
import { Note } from "./drafting";
import styles from "./layouts.module.css";

const MAX_FILE_BYTES = 200 * 1024;
const FORMAT_NAME: Record<KeymapFormat, string> = {
  "qmk-json": "a QMK keymap.json",
  "qmk-c": "a QMK keymap.c",
  zmk: "a ZMK keymap",
  vial: "a Vial file",
};

type Result =
  | { kind: "empty" }
  | { kind: "error"; message: string; format: KeymapFormat | null }
  | { kind: "ok"; format: KeymapFormat; mapping: KeymapMapping };

function analyse(text: string, layout: ParsedLayout): Result {
  if (text.trim() === "") return { kind: "empty" };
  let format: KeymapFormat | null = null;
  try {
    format = detectFormat(text);
    const km = parseKeymap(text, format ?? undefined);
    return { kind: "ok", format: km.format, mapping: mapKeymapToLayers(km, layout) };
  } catch (e) {
    if (e instanceof KeymapImportError) return { kind: "error", message: e.message, format };
    return { kind: "error", message: "This text could not be read as a keymap.", format };
  }
}

/** One step of the import sheet: its number (the order matters), a lettered name, the state it is in. */
function Step({ n, title, state, children }: { n: number; title: string; state: "todo" | "now" | "done" | "error"; children: ReactNode }) {
  return (
    <section className="border-t border-border first:border-t-0" data-step={n} data-state={state}>
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5 sm:px-5">
        <span
          aria-hidden
          className={cx(
            "ll-readout flex size-6 shrink-0 items-center justify-center border text-sm font-medium",
            state === "done" && "border-line bg-text text-bg",
            state === "now" && "border-line text-text",
            state === "error" && "border-error text-error",
            state === "todo" && "border-dashed border-border text-sub",
          )}
        >
          {n}
        </span>
        <h3 className={cx("ll-lettering", state === "todo" ? "text-sub" : "text-text")}>
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export interface KeymapImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** The board the layers are placed on. */
  layout: ParsedLayout | null;
  /** Called with the imported layers when the user confirms; the caller replaces its layers. */
  onApply: (layers: LayoutLayer[]) => void;
}

/** Paste or choose a firmware keymap, preview the layers it would give this board, then replace the editor's layers. */
export function KeymapImportDialog({ open, onClose, layout, onApply }: KeymapImportDialogProps) {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const result = useMemo<Result>(() => (layout ? analyse(text, layout) : { kind: "empty" }), [text, layout]);

  const close = () => {
    setText("");
    setFileError("");
    onClose();
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`That file is too large (over ${MAX_FILE_BYTES / 1024} KB) to be a keymap.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFileError("");
      setText(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onerror = () => setFileError("That file could not be read.");
    reader.readAsText(file);
  };

  const ok = result.kind === "ok" ? result : null;
  const mapping = ok?.mapping;
  const mismatch = mapping && mapping.baseMismatch.total > 0 && mapping.baseMismatch.matched / mapping.baseMismatch.total < 0.8 ? mapping.baseMismatch : null;
  const format = result.kind === "ok" || result.kind === "error" ? result.format : null;
  const errorText = fileError || (result.kind === "error" ? result.message : "");
  const canApply = !!mapping && mapping.layers.length > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      bare
      label="Import a keymap"
      data-testid="layer-import-dialog"
      className="flex max-h-[calc(100dvh-4rem)] flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-stretch border-b border-line">
        <h2 className="ll-lettering-lg min-w-0 flex-1 self-center px-4 py-3 text-text sm:px-5">Import a keymap</h2>
        <IconButton
          icon="x"
          label="Close"
          size="sm"
          className="h-auto w-11 self-stretch border-0 border-l border-line text-text hover:bg-text hover:text-bg"
          onClick={close}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <p className="border-b border-border px-4 py-3 text-base leading-snug text-sub sm:px-5">
          Paste your firmware keymap or choose its file. You will see the layers before anything changes.
        </p>

        <Step n={1} title="Keymap" state={errorText ? "error" : ok ? "done" : "now"}>
          <div className="flex min-w-0 flex-col gap-3">
            <textarea
              data-testid="layer-import-text"
              aria-label="Keymap text"
              aria-invalid={!!errorText}
              value={text}
              onChange={(e) => {
                setFileError("");
                setText(e.target.value);
              }}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              placeholder="Paste a keymap.json, keymap.c, .keymap or .vil here"
              className={cx(
                styles.code,
                "h-32 w-full resize-y border bg-fill p-3 font-mono text-sm leading-[20px] text-text outline-2 -outline-offset-2 outline-transparent transition-colors duration-150 placeholder:text-sub hover:border-line focus:bg-transparent",
                errorText ? "border-error focus:outline-error" : "border-border focus:outline-main",
              )}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button size="sm" variant="subtle" icon="upload" onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
              <input
                ref={fileRef}
                type="file"
                data-testid="layer-import-file"
                accept=".json,.c,.keymap,.vil,.txt"
                className="sr-only"
                tabIndex={-1}
                aria-label="Choose a keymap file"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {format ? (
                <span className="text-md text-text" data-testid="layer-import-format" data-format={format}>
                  Looks like {FORMAT_NAME[format]}.
                </span>
              ) : (
                <span className="ll-note text-sub">QMK .json / .c · ZMK .keymap · Vial .vil</span>
              )}
            </div>

            {errorText && (
              <Note role="alert" tone="error" title="This keymap can't be imported" data-testid="layer-import-error">
                {errorText}
              </Note>
            )}
          </div>
        </Step>

        <Step n={2} title="Check the layers" state={!ok ? "todo" : canApply ? "done" : "error"}>
          {ok && mapping ? (
            <div className="flex min-w-0 flex-col gap-3" data-testid="layer-import-preview" data-layer-count={mapping.layers.length}>
              {ok.format === "vial" && (
                <Note data-testid="layer-import-vial-note">
                  Vial files list keys in wiring order, which can differ from how the board looks. Check the preview.
                </Note>
              )}
              {mismatch && (
                <Note tone="warn" title="Base layer differs" data-testid="layer-import-mismatch">
                  The base layer in this keymap does not match this board&apos;s letters ({mismatch.matched} of {mismatch.total} keys match). Layers were placed by
                  key position, so check the preview. If you use another base layout such as Colemak-DH, pick that board first.
                </Note>
              )}
              {mapping.layers.length === 0 ? (
                <Note tone="error" title="Nothing to import" data-testid="layer-import-none">
                  No hold-to-activate layers were found in this keymap, so there is nothing to import.
                </Note>
              ) : (
                <p className="text-md leading-snug text-sub">
                  {mapping.layers.length} {mapping.layers.length === 1 ? "layer" : "layers"} found. Replace layers swaps the layers below in for the ones you
                  have now; you still need to save.
                </p>
              )}
              {layout &&
                mapping.layers.map((l) => (
                  <div key={l.id} className="min-w-0 border border-border" data-testid={`layer-import-layer-${l.id}`}>
                    <p className="flex items-baseline gap-3 border-b border-hairline px-3 py-2">
                      <span className="ll-lettering text-text">{l.name}</span>
                      <span className="ll-note text-sub">{Object.keys(l.keys).length} keys</span>
                    </p>
                    <div className="overflow-hidden p-2.5">
                      <Keyboard2D layout={layout} layer={l} highlightKeyIds={l.activatorIds} showHomeMarkers={false} maxUnit={34} />
                    </div>
                  </div>
                ))}
              {mapping.warnings.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-md leading-snug text-sub marker:text-border" data-testid="layer-import-warnings">
                  {mapping.warnings.map((w, i) => (
                    <li key={i} className="break-words">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="ll-hatch border border-dashed border-border px-3 py-5 text-center text-md text-sub">
              The layers this keymap gives your board are drawn here once it can be read.
            </p>
          )}
        </Step>

        <Step n={3} title="Replace layers" state={canApply ? "now" : "todo"}>
          <p className="text-md leading-snug text-sub">
            {canApply
              ? "Swaps the layers you have now for the ones above. Nothing is stored until you save the layout."
              : "Available once step 2 shows at least one layer."}
          </p>
        </Step>
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
        <Button variant="ghost" data-testid="layer-import-cancel" onClick={close}>
          Cancel
        </Button>
        <Button
          variant="primary"
          data-testid="layer-import-apply"
          disabled={!canApply}
          onClick={() => {
            if (!mapping) return;
            onApply(mapping.layers);
            close();
          }}
        >
          Replace layers
        </Button>
      </div>
    </Modal>
  );
}
