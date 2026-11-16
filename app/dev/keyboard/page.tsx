"use client";

// Dev harness for the layout engine + Keyboard2D.
// URL params: ?preset=<id>&emulate=0|1&fingers=0|1&demo=1&w=<px>
import React, { useEffect, useMemo, useState } from "react";
import { Keyboard2D } from "@/components/keyboard/Keyboard2D";
import { LayoutParseError, parseLayout } from "@/lib/layout/parse";
import { parsePreset } from "@/lib/layout/layers";
import { DEFAULT_PRESET_ID, PRESETS, getPreset } from "@/lib/layout/presets";
import { keyForChar, resolveKeystroke, typableChars } from "@/lib/layout/keys";
import { keyCenter, layoutHalves } from "@/lib/layout/geometry";
import { buildCurriculum, validateCurriculum } from "@/lib/lessons/curriculum";
import { FINGER_ORDER, fingerIndex, type ParsedLayout } from "@/lib/types";

const CUSTOM = "__custom";

const keyName = (k: ParsedLayout["keys"][number]) => (k.base === " " ? "Space" : k.base ? k.base.toUpperCase() : k.label.replace(/\n/g, " ") || k.id);

/** Extra summary fields for split boards (absent on one-piece boards so their summary is unchanged). */
function splitSummary(layout: ParsedLayout) {
  const halves = layoutHalves(layout);
  if (!halves.split) return {};
  const byFinger: Record<string, string> = {};
  FINGER_ORDER.forEach((f, i) => {
    const keys = layout.keys
      .filter((k) => k.finger && fingerIndex(k.finger) === i)
      .sort((a, b) => a.row - b.row || keyCenter(a).x - keyCenter(b).x);
    byFinger[`${f.hand}-${f.finger}`] = keys.map((k) => (k.isHome ? `[${keyName(k)}]` : keyName(k))).join(" ");
  });
  return {
    split: { splitX: halves.splitX, left: halves.left.length, right: halves.right.length },
    fingerHomeKeys: layout.keys.filter((k) => k.isHome && k.finger?.finger !== "thumb").length,
    thumbHomeKeys: layout.keys.filter((k) => k.isHome && k.finger?.finger === "thumb").map(keyName),
    rotatedKeys: layout.keys.filter((k) => k.rotation).length,
    rows: [...new Set(layout.keys.map((k) => k.row))].sort((a, b) => a - b).map((r) =>
      layout.keys.filter((k) => k.row === r).sort((a, b) => keyCenter(a).x - keyCenter(b).x).map(keyName).join(" "),
    ),
    codes: layout.keys.filter((k) => k.code).map((k) => `${keyName(k)}=${k.code}`).join(" "),
    fingers: byFinger,
  };
}

export default function KeyboardDevPage() {
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [emulate, setEmulate] = useState(true);
  const [fingers, setFingers] = useState(true);
  const [demo, setDemo] = useState(false);
  const [custom, setCustom] = useState('["Q","W","E"],\n[{x:0.25},"A","S","D"]');
  const [maxWidth, setMaxWidth] = useState<number | null>(null);
  const [pressed, setPressed] = useState<string[]>([]);
  const [log, setLog] = useState<unknown>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("preset");
    if (p && (getPreset(p) || p === CUSTOM)) setPresetId(p);
    if (q.has("emulate")) setEmulate(q.get("emulate") !== "0");
    if (q.has("fingers")) setFingers(q.get("fingers") !== "0");
    if (q.has("demo")) setDemo(q.get("demo") !== "0");
    if (q.has("w")) setMaxWidth(Number(q.get("w")) || null);
    if (q.has("src")) setCustom(q.get("src") ?? "");
  }, []);

  const parsed = useMemo<{ layout?: ParsedLayout; error?: string }>(() => {
    try {
      if (presetId === CUSTOM) return { layout: parseLayout(custom, "Custom") };
      const preset = getPreset(presetId)!;
      return { layout: parsePreset(preset) };
    } catch (e) {
      return { error: e instanceof LayoutParseError ? e.message : String(e) };
    }
  }, [presetId, custom]);
  const layout = parsed.layout;

  useEffect(() => {
    if (!layout) return;
    const editing = (t: EventTarget | null) => t instanceof HTMLTextAreaElement;
    const held = new Map<string, string>();
    const down = (ev: KeyboardEvent) => {
      if (editing(ev.target) || ev.metaKey || ev.ctrlKey) return;
      const res = resolveKeystroke(layout, ev, { emulate });
      if (["Tab", "Backspace", " ", "'", "/"].includes(ev.key)) ev.preventDefault();
      setLog({ ...res, event: { key: ev.key, code: ev.code, shiftKey: ev.shiftKey }, emulate });
      if (res.keyId) {
        held.set(ev.code, res.keyId);
        setPressed([...new Set(held.values())]);
      }
    };
    const up = (ev: KeyboardEvent) => {
      held.delete(ev.code);
      setPressed([...new Set(held.values())]);
    };
    const blur = () => setPressed([]);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [layout, emulate]);

  useEffect(() => setPressed([]), [layout]);

  const summary = useMemo(() => {
    if (!layout) return null;
    const codes = layout.keys.map((k) => k.code).filter(Boolean) as string[];
    const charKeys = layout.keys.filter((k) => k.base !== "");
    const wanted = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`~!@#$%^&*()-_=+[]{}\\|;:'\",<.>/? ";
    return {
      name: layout.name,
      size: `${layout.width}x${layout.height}`,
      keyCount: layout.keys.length,
      chars: typableChars(layout).length,
      missingChars: wanted.split("").filter((c) => !keyForChar(layout, c)).join(""),
      unresolvedCodes: layout.keys.filter((k) => !k.code).map((k) => k.label || k.id),
      duplicateCodes: codes.filter((c, i) => codes.indexOf(c) !== i),
      keysWithoutFinger: layout.keys.filter((k) => !k.finger).map((k) => k.label || k.id),
      charKeysWithoutFinger: charKeys.filter((k) => !k.finger).map((k) => k.label),
      homeKeys: layout.keys.filter((k) => k.isHome).map((k) => `${k.code}:${k.base === " " ? "space" : k.base}`),
      ...splitSummary(layout),
    };
  }, [layout]);

  // Static showcase of every visual state.
  const demoProps = useMemo(() => {
    if (!demo || !layout) return {};
    const id = (code: string) => layout.keys.find((k) => k.code === code)?.id ?? "";
    const heat: Record<string, number> = {};
    ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8"].forEach((c, i) => {
      if (id(c)) heat[id(c)] = (i + 1) / 8;
    });
    // Rotated (thumb-cluster) keys show the states too.
    const rot = layout.keys.filter((k) => k.rotation).map((k) => k.id);
    return {
      highlightKeyIds: [id("KeyJ"), id("ShiftLeft"), ...rot.slice(0, 1)],
      pressedKeyIds: [id("KeyD"), ...rot.slice(1, 2)],
      errorKeyIds: [id("KeyL"), ...rot.slice(2, 3)],
      dimUnused: ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB"].map(id),
      heat,
    };
  }, [demo, layout]);

  // Expose the engine for `eval:` checks from scripts/verify.mjs.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__ll = {
      parseLayout,
      parsePreset,
      PRESETS,
      getPreset,
      keyForChar,
      resolveKeystroke,
      typableChars,
      keyCenter,
      layoutHalves,
      buildCurriculum,
      validateCurriculum,
      layout,
    };
  }, [layout]);

  const label: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 };
  const pre: React.CSSProperties = {
    margin: 0,
    padding: 12,
    borderRadius: 8,
    background: "var(--bg-alt, #2c2e31)",
    border: "1px solid var(--border, #3b3e43)",
    fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "auto",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        padding: "24px 16px 64px",
        background: "var(--bg, #1e1f22)",
        color: "var(--text, #d1d0c5)",
        fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
      }}
    >
      <div style={{ maxWidth: maxWidth ?? 1400, margin: "0 auto", display: "grid", gap: 20, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Keyboard dev harness</h1>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <label style={label}>
            Preset
            <select
              data-testid="preset"
              value={presetId}
              onChange={(e) => {
                setPresetId(e.target.value);
                e.target.blur();
              }}
              style={{ padding: "4px 8px", fontSize: 14 }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.family}
                </option>
              ))}
              <option value={CUSTOM}>Custom (paste below)</option>
            </select>
          </label>
          <label style={label}>
            <input data-testid="emulate" type="checkbox" checked={emulate} onChange={(e) => { setEmulate(e.target.checked); e.target.blur(); }} />
            Emulate (OS is on QWERTY)
          </label>
          <label style={label}>
            <input data-testid="fingers" type="checkbox" checked={fingers} onChange={(e) => { setFingers(e.target.checked); e.target.blur(); }} />
            Finger colours
          </label>
          <label style={label}>
            <input data-testid="demo" type="checkbox" checked={demo} onChange={(e) => { setDemo(e.target.checked); e.target.blur(); }} />
            Show all states
          </label>
        </div>

        {presetId === CUSTOM && (
          <textarea
            data-testid="custom-source"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            rows={6}
            spellCheck={false}
            style={{ ...pre, width: "100%", boxSizing: "border-box", color: "inherit", resize: "vertical" }}
          />
        )}

        {parsed.error && (
          <div data-testid="parse-error" style={{ ...pre, borderColor: "var(--error, #ca4754)", color: "var(--error, #ca4754)" }}>
            {parsed.error}
          </div>
        )}

        {layout && (
          <div data-testid="keyboard-frame" style={{ minWidth: 0, padding: "8px 0" }}>
            <Keyboard2D layout={layout} fingerColors={fingers} pressedKeyIds={pressed} {...demoProps} />
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--sub, #7f8288)" }}>Last keystroke (press any key)</div>
          <pre data-testid="log" style={pre}>{log ? JSON.stringify(log) : "null"}</pre>
          <div style={{ fontSize: 12, color: "var(--sub, #7f8288)" }}>Layout summary</div>
          <pre data-testid="summary" style={pre}>{summary ? JSON.stringify(summary, null, 1) : "null"}</pre>
        </div>
      </div>
    </main>
  );
}
