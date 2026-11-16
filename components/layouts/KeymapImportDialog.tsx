"use client";

import { useMemo, useRef, useState } from "react";
import { Button, Icon, Modal } from "@/components/ui";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { KeymapImportError, detectFormat, parseKeymap, type KeymapFormat } from "@/lib/layout/keymap/index";
import { mapKeymapToLayers, type KeymapMapping } from "@/lib/layout/keymap/apply";
import type { LayoutLayer, ParsedLayout } from "@/lib/types";

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

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Import a keymap"
      description="Paste your firmware keymap or choose its file. You will see the layers before anything changes."
      data-testid="layer-import-dialog"
      className="max-h-[calc(100dvh-4rem)] overflow-y-auto overflow-x-hidden"
      footer={
        <>
          <Button variant="ghost" data-testid="layer-import-cancel" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-testid="layer-import-apply"
            disabled={!mapping || mapping.layers.length === 0}
            onClick={() => {
              if (!mapping) return;
              onApply(mapping.layers);
              close();
            }}
          >
            Replace layers
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <textarea
          data-testid="layer-import-text"
          aria-label="Keymap text"
          value={text}
          onChange={(e) => {
            setFileError("");
            setText(e.target.value);
          }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          placeholder="Paste a keymap.json, keymap.c, .keymap or .vil here"
          className="h-32 w-full resize-y rounded-ui border border-border bg-bg-alt p-3 font-mono text-xs text-text outline-none placeholder:text-sub focus-visible:border-main"
        />
        <div className="flex flex-wrap items-center gap-2">
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
          {format && (
            <span className="text-[13px] text-sub" data-testid="layer-import-format" data-format={format}>
              Looks like {FORMAT_NAME[format]}.
            </span>
          )}
        </div>

        {errorText && (
          <p role="alert" data-testid="layer-import-error" className="flex items-start gap-2 text-[13px] leading-snug text-error">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{errorText}</span>
          </p>
        )}

        {ok && mapping && (
          <div className="flex min-w-0 flex-col gap-3" data-testid="layer-import-preview" data-layer-count={mapping.layers.length}>
            {ok.format === "vial" && (
              <p className="text-[13px] leading-snug text-sub" data-testid="layer-import-vial-note">
                Vial files list keys in wiring order, which can differ from how the board looks. Check the preview.
              </p>
            )}
            {mismatch && (
              <p className="rounded-ui border border-border bg-bg-alt px-3 py-2 text-[13px] leading-snug text-text" data-testid="layer-import-mismatch">
                The base layer in this keymap does not match this board&apos;s letters ({mismatch.matched} of {mismatch.total} keys match). Layers were placed by
                key position, so check the preview. If you use another base layout such as Colemak-DH, pick that board first.
              </p>
            )}
            {mapping.layers.length === 0 ? (
              <p className="text-[13px] text-sub" data-testid="layer-import-none">
                No hold-to-activate layers were found in this keymap, so there is nothing to import.
              </p>
            ) : (
              <p className="text-[13px] text-sub">
                {mapping.layers.length} {mapping.layers.length === 1 ? "layer" : "layers"} found. Replace layers swaps the layers below in for the ones you
                have now; you still need to save.
              </p>
            )}
            {layout &&
              mapping.layers.map((l) => (
                <div key={l.id} className="min-w-0" data-testid={`layer-import-layer-${l.id}`}>
                  <p className="mb-1 text-[13px] font-medium text-text">
                    {l.name} <span className="font-mono text-[11px] font-normal text-sub">{Object.keys(l.keys).length} keys</span>
                  </p>
                  <div className="overflow-hidden rounded-ui border border-border bg-bg-alt p-2">
                    <Keyboard2D layout={layout} layer={l} highlightKeyIds={l.activatorIds} showHomeMarkers={false} maxUnit={34} />
                  </div>
                </div>
              ))}
            {mapping.warnings.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs leading-snug text-sub" data-testid="layer-import-warnings">
                {mapping.warnings.map((w, i) => (
                  <li key={i} className="break-words">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
