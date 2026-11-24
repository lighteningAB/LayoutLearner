"use client";

// Dev harness for the 3D hands scene.
// URL params: ?preset=<preset id | fixture | split-fixture>&camera=top|angled|front&target=<KeyboardEvent.code | key id>
//             &hold=<code | id>,<code | id>  (keys held meanwhile; &mod=<code | id> still works)&orbit=1&h=<px>&theme=<data-theme, this page view only>
// Press any physical key to make the hands reach for and tap it.
// CLI helpers: window.__handsDev.{setTarget(codeOrId), setHolds([codeOrId, ...]), press(codeOrId), sweep()}, window.__hands (scene internals:
// debug(), measureAll(), report() — per-row fingertip error, palm travel and how far the idle fingers leave home).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HandsScene, { type HandsCamera } from "@/components/hands";
import { QWERTY_FIXTURE, SPLIT_FIXTURE } from "@/lib/hands/fixture";
import { parseLayout } from "@/lib/layout/parse";
import { PRESETS, getPreset } from "@/lib/layout/presets";
import type { LayoutKey, ParsedLayout } from "@/lib/types";

const SEQUENCE = ["KeyQ", "KeyT", "KeyB", "KeyY", "KeyP", "Digit4", "Digit9", "Enter", "Space", "ShiftLeft", "KeyZ", "Backspace", "KeyG", "KeyH", "Slash"];
const CAMERAS: HandsCamera[] = ["angled", "top", "front"];
const THEMES = ["blueprint", "whiteprint"];

interface LiveDebug {
  targetKeyId?: string | null;
  settled?: boolean;
  distance?: number;
  finger?: string;
  onKey?: boolean;
  /** Per hand: wrist / palm-centre translation from rest (key units) and yaw change. */
  hands?: { hand: string; wrist: number; palm: number; yaw: number }[];
  /** Held keys: fingertip distance from its aim, whether it is over the key, how far the key is down (0..1). */
  holds?: { id: string; finger: string; distance: number; onKey: boolean; down: number }[];
  /** Largest xz distance of a non-reaching fingertip from its home key centre. */
  maxOther?: number;
}

interface HandsDebugHandle {
  debug(): LiveDebug | null;
  tips(): unknown;
  /** Static (no animation) result per key: see KeyMeasure in lib/hands/pose.ts. */
  measureAll(): { id: string; label: string; distance?: number; finger?: string; row?: number; reach?: number }[];
  /** measureAll condensed per row. */
  report(): unknown;
  snap(): void;
  controller: { isSettled: boolean } | null;
}

const hands = () => (window as unknown as { __hands?: HandsDebugHandle }).__hands;

function findKey(layout: ParsedLayout, ref: string | null): LayoutKey | undefined {
  if (!ref) return undefined;
  return layout.keys.find((k) => k.id === ref) ?? layout.keys.find((k) => k.code === ref);
}

/** Key ids for a list of ids / codes. Unknown ones are dropped, unless prefixed with "!" (passed through as-is, to test ids that are not on the board). */
function resolveHolds(layout: ParsedLayout, refs: string[]): string[] {
  const out: string[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    const id = findKey(layout, ref)?.id ?? (ref.startsWith("!") ? ref.slice(1) : null);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

const btn =
  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-80 focus-visible:outline focus-visible:outline-2";
const btnStyle: React.CSSProperties = { borderColor: "var(--border)", background: "var(--bg-alt)", color: "var(--text)" };
const onStyle: React.CSSProperties = { borderColor: "var(--main)", background: "var(--main)", color: "var(--main-fg)" };

export default function HandsDevPage() {
  const [presetId, setPresetId] = useState("fixture");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [holdIds, setHoldIds] = useState<string[]>([]);
  const [press, setPress] = useState<{ keyId: string; nonce: number } | null>(null);
  const [ok, setOk] = useState(true);
  const [camera, setCamera] = useState<HandsCamera>("angled");
  const [orbit, setOrbit] = useState(false);
  const [zones, setZones] = useState(true);
  const [height, setHeight] = useState<number | null>(null);
  const [debug, setDebug] = useState("{}");
  const [sweep, setSweep] = useState<string>("");
  const [ready, setReady] = useState(false);
  const seq = useRef(-1);
  const nonce = useRef(0);

  const layout = useMemo<ParsedLayout>(() => {
    if (presetId === "fixture") return QWERTY_FIXTURE;
    if (presetId === "split-fixture") return SPLIT_FIXTURE;
    const p = getPreset(presetId);
    try {
      return p ? parseLayout(p.source, p.name) : QWERTY_FIXTURE;
    } catch {
      return QWERTY_FIXTURE;
    }
  }, [presetId]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const pending = useRef<{ target?: string; holds?: string[] }>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("preset");
    if (p && (p === "fixture" || p === "split-fixture" || getPreset(p))) setPresetId(p);
    const c = q.get("camera") as HandsCamera | null;
    if (c && CAMERAS.includes(c)) setCamera(c);
    if (q.get("orbit") === "1") setOrbit(true);
    if (q.get("zones") === "0") setZones(false);
    if (q.has("h")) setHeight(Number(q.get("h")) || null);
    const th = q.get("theme");
    if (th && /^[a-z]+$/.test(th)) document.documentElement.setAttribute("data-theme", th);
    const holds = [...(q.get("hold") ?? "").split(","), q.get("mod") ?? ""].map((s) => s.trim()).filter(Boolean);
    pending.current = { target: q.get("target") ?? undefined, holds };
    setReady(true);
  }, []);
  useEffect(() => {
    // resolve ?target / ?hold once the URL has been read and the right layout is active
    if (!ready) return;
    const { target, holds } = pending.current;
    pending.current = {};
    setTargetId(findKey(layout, target ?? null)?.id ?? null);
    setHoldIds(resolveHolds(layout, holds ?? []));
    seq.current = -1;
  }, [layout, ready]);

  const tap = useCallback((id: string, good = true) => {
    setOk(good);
    setPress({ keyId: id, nonce: ++nonce.current });
  }, []);

  useEffect(() => {
    const down = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.repeat) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "SELECT" || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const key = findKey(layoutRef.current, ev.code);
      if (!key) return;
      ev.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      setTargetId(key.id);
      tap(key.id);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [tap]);

  // live debug read-out
  useEffect(() => {
    const id = window.setInterval(() => {
      const d = hands()?.debug();
      const s = JSON.stringify(d ?? {});
      setDebug((prev) => (prev === s ? prev : s));
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const step = (dir: number) => {
    const codes = SEQUENCE.filter((c) => findKey(layout, c));
    if (!codes.length) return;
    seq.current = (seq.current + dir + codes.length) % codes.length;
    setTargetId(findKey(layout, codes[seq.current])!.id);
  };

  // Animates to every finger-assigned key in turn and records, once settled: the fingertip error, how far
  // the hand moved (wrist, palm centre) and how far the other fingertips are from their home keys.
  const runSweep = useCallback(async () => {
    const keys = layoutRef.current.keys.filter((k) => k.finger && k.base !== "");
    const stat = new Map((hands()?.measureAll() ?? []).map((m) => [m.id, m]));
    type Row = { label: string; finger: string; distance: number; onKey: boolean; others: number; palm: number; wrist: number; group: string };
    const rows: Row[] = [];
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    setSweep("running…");
    for (const k of keys) {
      setTargetId(k.id);
      await frame();
      await frame();
      const t0 = performance.now();
      while (performance.now() - t0 < 2000) {
        await frame();
        const d = hands()?.debug();
        if (d && d.targetKeyId === k.id && d.settled) break;
      }
      const d = hands()?.debug();
      const hand = d?.hands?.find((h) => h.hand === k.finger!.hand);
      const m = stat.get(k.id);
      const row = m?.row ?? 0;
      // "letter": character keys of the three letter rows within 2u of the finger's home key
      const letter = Math.abs(row) <= 1 && (m?.reach ?? 9) <= 2 && k.base.trim().length === 1;
      rows.push({
        label: k.label.replace(/\n/g, " ") || "Space",
        finger: d?.finger ?? "?",
        distance: d?.distance ?? NaN,
        onKey: !!d?.onKey,
        others: d?.maxOther ?? NaN,
        palm: hand?.palm ?? NaN,
        wrist: hand?.wrist ?? NaN,
        group: `${letter ? "letter" : "far"} row ${row}`,
      });
    }
    setTargetId(null);
    const groups: Record<string, { n: number; distance: number; others: string; palm: string; wrist: string }> = {};
    for (const name of [...new Set(rows.map((r) => r.group))].sort()) {
      const g = rows.filter((r) => r.group === name);
      const worst = (f: "others" | "palm" | "wrist") => {
        const w = g.reduce((a, b) => (b[f] > a[f] ? b : a));
        return `${w[f]} (${w.label})`;
      };
      groups[name] = { n: g.length, distance: Math.max(...g.map((r) => r.distance)), others: worst("others"), palm: worst("palm"), wrist: worst("wrist") };
    }
    rows.sort((a, b) => b.distance - a.distance);
    const result = {
      layout: layoutRef.current.name,
      keys: rows.length,
      max: rows[0]?.distance ?? 0,
      mean: Math.round((rows.reduce((s, r) => s + r.distance, 0) / Math.max(1, rows.length)) * 1000) / 1000,
      offKey: rows.filter((r) => !r.onKey).map((r) => r.label),
      worst: rows.slice(0, 4).map((r) => `${r.label} ${r.distance}`),
      rows: groups,
    };
    setSweep(JSON.stringify(result));
    return result;
  }, []);

  useEffect(() => {
    const w = window as unknown as { __handsDev?: unknown };
    w.__handsDev = {
      setTarget: (ref: string | null) => setTargetId(findKey(layoutRef.current, ref)?.id ?? null),
      setHolds: (refs: string[] | null) => setHoldIds(resolveHolds(layoutRef.current, refs ?? [])),
      setModifier: (ref: string | null) => setHoldIds(resolveHolds(layoutRef.current, ref ? [ref] : [])),
      press: (ref: string, good = true) => {
        const k = findKey(layoutRef.current, ref);
        if (k) tap(k.id, good);
      },
      sweep: runSweep,
    };
    return () => {
      delete w.__handsDev;
    };
  }, [runSweep, tap]);

  const target = findKey(layout, targetId);
  const isShift = (k: LayoutKey) => /^Shift/.test(k.code ?? "") || /shift/i.test(k.label);
  const heldShift = holdIds.some((id) => {
    const k = findKey(layout, id);
    return !!k && isShift(k);
  });
  const toggleShift = () => {
    if (heldShift) return setHoldIds((ids) => ids.filter((id) => !isShift(findKey(layout, id)!)));
    const hand = target?.finger?.hand ?? "R";
    const shift = layout.keys.find((k) => k.code === (hand === "L" ? "ShiftRight" : "ShiftLeft")) ?? layout.keys.find(isShift);
    if (shift) setHoldIds((ids) => [...ids, shift.id]);
  };
  // "hold target": the current target becomes a held key (then pick the next target); "release": drop all holds
  const holdTarget = () => {
    if (!target) return;
    setHoldIds((ids) => (ids.includes(target.id) ? ids : [...ids, target.id]));
    setTargetId(null);
  };
  const cycleTheme = () => {
    const el = document.documentElement;
    const i = THEMES.indexOf(el.getAttribute("data-theme") ?? "");
    el.setAttribute("data-theme", THEMES[(i + 1) % THEMES.length]);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4" data-testid="hands-dev">
      <div className="flex flex-wrap items-center gap-2">
        <select
          data-testid="preset"
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="rounded-md border px-2 py-1 text-xs"
          style={btnStyle}
        >
          <option value="fixture">fixture (QWERTY 60%)</option>
          <option value="split-fixture">fixture (split columnar)</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button data-testid="prev" className={btn} style={btnStyle} onClick={() => step(-1)}>
          ← prev
        </button>
        <button data-testid="next" className={btn} style={btnStyle} onClick={() => step(1)}>
          next target →
        </button>
        <button data-testid="clear" className={btn} style={btnStyle} onClick={() => setTargetId(null)}>
          rest
        </button>
        <button data-testid="tap" className={btn} style={btnStyle} onClick={() => target && tap(target.id, true)}>
          tap
        </button>
        <button data-testid="tap-wrong" className={btn} style={btnStyle} onClick={() => target && tap(target.id, false)}>
          tap (wrong)
        </button>
        <button data-testid="shift" className={btn} style={heldShift ? onStyle : btnStyle} onClick={toggleShift}>
          hold shift
        </button>
        <button data-testid="hold-target" className={btn} style={btnStyle} onClick={holdTarget} title="Keep the current target held, then choose the next target">
          hold target
        </button>
        <input
          data-testid="holds"
          aria-label="Held keys (ids or codes, comma separated)"
          placeholder="held: id,id"
          key={holdIds.join(",")}
          defaultValue={holdIds.join(",")}
          onKeyDown={(e) => {
            if (e.key === "Enter") setHoldIds(resolveHolds(layout, e.currentTarget.value.split(",")));
          }}
          onBlur={(e) => setHoldIds(resolveHolds(layout, e.currentTarget.value.split(",")))}
          className="w-28 rounded-md border px-2 py-1 text-xs"
          style={btnStyle}
        />
        <button data-testid="release" className={btn} style={btnStyle} onClick={() => setHoldIds([])}>
          release
        </button>
        <button
          data-testid="camera"
          className={btn}
          style={btnStyle}
          onClick={() => setCamera((c) => CAMERAS[(CAMERAS.indexOf(c) + 1) % CAMERAS.length])}
        >
          camera: {camera}
        </button>
        <button data-testid="orbit" className={btn} style={orbit ? onStyle : btnStyle} onClick={() => setOrbit((o) => !o)}>
          orbit
        </button>
        <button data-testid="zones" className={btn} style={zones ? onStyle : btnStyle} onClick={() => setZones((z) => !z)}>
          finger zones
        </button>
        <button data-testid="theme" className={btn} style={btnStyle} onClick={cycleTheme}>
          theme
        </button>
        <button data-testid="sweep-run" className={btn} style={btnStyle} onClick={() => void runSweep()}>
          sweep all keys
        </button>
      </div>

      <div
        data-testid="stage"
        className="w-full overflow-hidden rounded-xl border"
        style={{ height: height ?? "min(68vh, 640px)", borderColor: "var(--border)", background: "var(--bg)" }}
      >
        <HandsScene
          layout={layout}
          targetKeyId={targetId}
          holdKeyIds={holdIds}
          press={press}
          pressedOk={ok}
          camera={camera}
          interactive={orbit}
          fingerZones={zones}
          debug
        />
      </div>

      <p className="text-xs" style={{ color: "var(--sub)" }}>
        Press any key: the assigned finger reaches for it and taps. Target:{" "}
        <span data-testid="target-label" style={{ color: "var(--text)" }}>
          {target ? `${target.label.replace(/\n/g, " ") || "Space"} (${target.finger ? `${target.finger.hand} ${target.finger.finger}` : "no finger"})` : "none"}
        </span>
      </p>
      <pre data-testid="debug" className="overflow-x-auto rounded-md border p-2 text-[11px] leading-snug" style={{ ...btnStyle, color: "var(--sub)" }}>
        {debug}
      </pre>
      {sweep && (
        <pre data-testid="sweep" className="overflow-x-auto whitespace-pre-wrap rounded-md border p-2 text-[11px] leading-snug" style={{ ...btnStyle, color: "var(--sub)" }}>
          {sweep}
        </pre>
      )}
    </div>
  );
}
