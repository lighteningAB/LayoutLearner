"use client";

import { useState } from "react";
import { Button, ConfirmDialog, IconButton, Input, cx } from "@/components/ui";
import { MAX_LAYER_NAME, addLayer, removeLayer, renameLayer, setActivators, setKeyChars, type Layers } from "@/lib/layout/layers";
import { MAX_LAYERS, type LayoutKey, type ParsedLayout } from "@/lib/types";
import { displayLegends } from "@/lib/layout/parse";
import { KeyChip, Note } from "./drafting";
import { KeymapImportDialog } from "./KeymapImportDialog";

const keyName = (k: LayoutKey) => displayLegends(k.label).join(" ").trim() || (k.base === " " ? "Space" : "Key");
const fingerText = (k: LayoutKey) => (k.finger ? `${k.finger.hand === "L" ? "left" : "right"} ${k.finger.finger}` : "");
/** The last code point typed: typing over a filled field replaces its character. */
const lastChar = (v: string) => {
  const cps = Array.from(v);
  return cps.length ? cps[cps.length - 1] : "";
};

function RenameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(name);
  const commit = () => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) setText(name);
    else if (t !== name) onCommit(t);
  };
  return (
    <Input
      size="sm"
      data-testid="layer-name"
      aria-label="Layer name"
      value={text}
      maxLength={MAX_LAYER_NAME}
      className="w-40"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

export interface LayersPanelProps {
  /** The layout the layers sit on (key names for the chips). */
  layout: ParsedLayout | null;
  layers: Layers;
  onChange: (layers: Layers) => void;
  activeId: string | null;
  onActiveId: (id: string | null) => void;
  /** Key being edited on the board. */
  selectedKey: LayoutKey | null;
  settingActivator: boolean;
  onSettingActivator: (on: boolean) => void;
  onClearSelection: () => void;
}

/** The "Layers" view of the layout editor: layer tabs, the activator picker and the key editor. */
export function LayersPanel({ layout, layers, onChange, activeId, onActiveId, selectedKey, settingActivator, onSettingActivator, onClearSelection }: LayersPanelProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = layers ?? [];
  const active = list.find((l) => l.id === activeId) ?? null;
  const byId = new Map((layout?.keys ?? []).map((k) => [k.id, k]));
  const entry = active && selectedKey ? active.keys[selectedKey.id] : undefined;
  const isActivator = !!active && !!selectedKey && active.activatorIds.includes(selectedKey.id);

  const add = () => {
    const r = addLayer(layers);
    if (!r.id) return;
    onChange(r.layers);
    onActiveId(r.id);
    onSettingActivator(false);
    onClearSelection();
  };

  return (
    <div className="flex flex-col" data-testid="layers-panel" data-layer-count={list.length}>
      <p className="border-b border-hairline px-3 py-3 text-md leading-snug text-sub sm:px-4">
        A layer is a set of characters that appears on the board while you hold its activator key (Lower, Raise, Fn). Layers guide the keyboard view and
        lessons; typed characters are matched exactly as before. Default layers are a suggestion. Edit them to match your firmware.
      </p>

      {/* Layer tabs on a rule; adding and importing sit at the end of the same line. */}
      <div className="flex flex-wrap items-end gap-x-1 border-b border-border px-1 sm:px-2" role="group" aria-label="Layers">
        {list.map((l) => {
          const on = l.id === activeId;
          return (
            <button
              key={l.id}
              type="button"
              data-testid={`layer-tab-${l.id}`}
              data-active={on ? "" : undefined}
              aria-pressed={on}
              onClick={() => {
                onActiveId(l.id);
                onSettingActivator(false);
                onClearSelection();
              }}
              className={cx(
                "ll-lettering -mb-px inline-flex h-10 max-w-[180px] items-center gap-2 border-b-2 px-2.5 transition-colors duration-150 focus-visible:outline-offset-[-2px]",
                on ? "border-main text-text" : "border-transparent text-sub hover:border-border hover:text-text",
              )}
            >
              <span className="ll-trim truncate">{l.name}</span>
              <span className={cx("ll-readout text-xs font-normal tracking-normal", on ? "text-text" : "text-sub")}>{Object.keys(l.keys).length}</span>
            </button>
          );
        })}
        <div className="ml-auto flex flex-wrap items-center py-1">
          <Button size="sm" variant="ghost" icon="plus" data-testid="layer-add" disabled={list.length >= MAX_LAYERS} onClick={add}>
            Add layer
          </Button>
          <Button size="sm" variant="ghost" icon="upload" data-testid="layer-import" disabled={!layout} onClick={() => setImporting(true)}>
            Import keymap
          </Button>
        </div>
      </div>
      <p className="px-3 pt-2.5 text-md leading-snug text-sub sm:px-4">
        {list.length >= MAX_LAYERS && <>Up to {MAX_LAYERS} layers. </>}
        Works with QMK (keymap.json or keymap.c), ZMK (.keymap) and Vial (.vil). Only hold-to-activate layers are imported.
      </p>

      <div className="p-3 sm:p-4">
        {!active ? (
          <Note data-testid="layers-empty">
            <span className="text-sub">{list.length === 0 ? "This layout has no layers yet. Add one to give keys extra characters." : "Choose a layer."}</span>
          </Note>
        ) : (
          <div className="border border-line" data-testid="layer-editor" data-layer={active.id}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-2 pr-1.5 pl-3">
              <div className="flex items-center gap-3">
                <span className="ll-lettering-sm text-sub">Name</span>
                <RenameField key={active.id} name={active.name} onCommit={(n) => onChange(renameLayer(layers, active.id, n))} />
              </div>
              <Button size="sm" variant="ghost" icon="trash" data-testid="layer-delete" onClick={() => setConfirmDelete(true)}>
                Delete layer
              </Button>
            </div>

            <div className={cx("border-b border-border p-3", settingActivator && "outline-2 -outline-offset-2 outline-main")} data-testid="layer-activators">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="ll-lettering text-text">Activator</p>
                <div className="flex items-center gap-1">
                  {active.activatorIds.length > 0 && !settingActivator && (
                    <Button size="sm" variant="ghost" data-testid="layer-clear-activator" onClick={() => onChange(setActivators(layers, active.id, []))}>
                      Clear
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={settingActivator ? "primary" : "subtle"}
                    icon={settingActivator ? "check" : "keyboard"}
                    aria-pressed={settingActivator}
                    data-testid="layer-set-activator"
                    onClick={() => {
                      onSettingActivator(!settingActivator);
                      onClearSelection();
                    }}
                  >
                    {settingActivator ? "Done" : "Set activator"}
                  </Button>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="layer-activator-list" data-ids={active.activatorIds.join(",")}>
                {active.activatorIds.length === 0 ? (
                  <span className="text-md text-sub">No activator yet. Layers without one are not saved.</span>
                ) : (
                  active.activatorIds.map((id) => {
                    const k = byId.get(id);
                    return (
                      <span key={id} className={cx("inline-flex items-center gap-2 text-md", k ? "text-text" : "text-error")}>
                        {k ? <KeyChip>{keyName(k)}</KeyChip> : "missing key"}
                        {k && fingerText(k) && <span className="text-sub">{fingerText(k)}</span>}
                      </span>
                    );
                  })
                )}
              </div>
              <p className="mt-2.5 text-md leading-snug text-sub">
                {settingActivator
                  ? "Click the key (or up to 4 keys) on the board that you hold for this layer. Click it again to remove it."
                  : "The key you hold to reach this layer. Choose Set activator, then click it on the board."}
              </p>
            </div>

            {!settingActivator &&
              (selectedKey ? (
                <div data-testid="layer-key-editor" data-key-id={selectedKey.id}>
                  <div className="flex items-stretch border-b border-border">
                    <p className="ll-lettering flex min-w-0 flex-1 flex-wrap items-center gap-2 px-3 py-2.5 text-text">
                      Key <KeyChip>{keyName(selectedKey)}</KeyChip> on {active.name}
                    </p>
                    <IconButton
                      icon="x"
                      label="Close the key editor"
                      size="sm"
                      className="h-auto w-11 self-stretch border-0 border-l border-border text-text hover:bg-text hover:text-bg"
                      onClick={onClearSelection}
                    />
                  </div>
                  <div className="p-3">
                    {isActivator ? (
                      <p className="text-md text-sub">This key is the activator of {active.name}, so it types nothing on it.</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="ll-lettering-sm block text-sub">
                            Character
                            <Input
                              size="sm"
                              mono
                              data-testid="layer-key-base"
                              aria-label={`Character on ${active.name}`}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              className="mt-1.5 block w-24 text-center tracking-normal normal-case"
                              value={entry?.base ?? ""}
                              onChange={(e) => {
                                const c = lastChar(e.target.value);
                                onChange(setKeyChars(layers, active.id, selectedKey.id, c, c ? entry?.shifted : undefined));
                              }}
                            />
                          </label>
                          <label className="ll-lettering-sm block text-sub">
                            With Shift
                            <Input
                              size="sm"
                              mono
                              data-testid="layer-key-shift"
                              aria-label={`Character on ${active.name} with Shift`}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              disabled={!entry}
                              className="mt-1.5 block w-24 text-center tracking-normal normal-case"
                              value={entry?.shifted ?? ""}
                              onChange={(e) => entry && onChange(setKeyChars(layers, active.id, selectedKey.id, entry.base, lastChar(e.target.value)))}
                            />
                          </label>
                          <Button size="sm" variant="ghost" icon="restart" disabled={!entry} data-testid="layer-key-clear" onClick={() => onChange(setKeyChars(layers, active.id, selectedKey.id, ""))}>
                            Clear key
                          </Button>
                        </div>
                        <p className="mt-3 text-md leading-snug text-sub">
                          Type one character. Leave the Shift box empty if the key has none. A character the board already types without a layer is never routed
                          through one.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-3">
                  <Note icon="keyboard" data-testid="layer-hint">
                    <span className="text-sub">
                      {layout
                        ? `Select a key on the keyboard to choose what it types while ${active.name} is held. The board shows this layer's characters.`
                        : "Fix the layout data first; the keyboard appears here when it parses."}
                    </span>
                  </Note>
                </div>
              ))}
          </div>
        )}
      </div>

      <KeymapImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        layout={layout}
        onApply={(next) => {
          onChange(next);
          onActiveId(next[0]?.id ?? null);
          onSettingActivator(false);
          onClearSelection();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          if (!active) return;
          const next = removeLayer(layers, active.id);
          onChange(next);
          onActiveId(next?.[0]?.id ?? null);
          onSettingActivator(false);
          onClearSelection();
        }}
        title={`Delete the ${active?.name ?? ""} layer?`}
        description="Its characters and activator are removed from this layout."
        confirmLabel="Delete layer"
        cancelLabel="Keep it"
        tone="danger"
      />
    </div>
  );
}
