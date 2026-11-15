"use client";
// Bare verification harness for lib/typing, lib/lessons and lib/stats. Not a product page.
// Query params: ?mode=time&seconds=3  ?seed=7  ?count=10  ?layout=dvorak  ?lesson=0&drill=0
import { useEffect, useMemo, useState } from "react";
import { generateText, createWordStream, type GenerateConfig } from "@/lib/typing/words";
import { useTypingTest } from "@/lib/typing/useTypingTest";
import type { TestConfig, TestResult } from "@/lib/typing/engine";
import { buildCurriculum, validateCurriculum, type Lesson } from "@/lib/lessons/curriculum";
import { DEV_LAYOUTS } from "@/lib/lessons/devLayouts";
import {
  clearAll,
  recordLessonResult,
  recordResult,
  useKeyStats,
  useLessonProgress,
  usePersonalBests,
  useResults,
  useStreak,
  useWeakestKeys,
} from "@/lib/stats/store";

interface Params {
  mode: "words" | "time";
  seconds: number;
  count: number;
  seed: number;
  layout: string;
  lesson: number | null;
  drill: number;
}

function readParams(): Params {
  const q = new URLSearchParams(window.location.search);
  const n = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  return {
    mode: q.get("mode") === "time" ? "time" : "words",
    seconds: n("seconds", 5),
    count: n("count", 10),
    seed: n("seed", 1),
    layout: DEV_LAYOUTS[q.get("layout") ?? ""] ? (q.get("layout") as string) : "qwerty",
    lesson: q.has("lesson") ? n("lesson", 0) : null,
    drill: n("drill", 0),
  };
}

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, monospace)" };
const COLORS: Record<string, string> = {
  pending: "var(--sub, #777)",
  correct: "var(--text, #ddd)",
  incorrect: "var(--error, #e55)",
  extra: "var(--error-alt, #a33)",
  missed: "var(--error, #e55)",
};

export default function EngineDevPage() {
  const [params, setParams] = useState<Params | null>(null);
  useEffect(() => setParams(readParams()), []);
  if (!params) return <main data-testid="loading">loading</main>;
  return <Harness params={params} />;
}

function Harness({ params }: { params: Params }) {
  const layout = DEV_LAYOUTS[params.layout];
  const layoutId = `dev-${params.layout}`;
  const curriculum = useMemo(() => buildCurriculum(layout), [layout]);
  const lesson: Lesson | null = params.lesson == null ? null : curriculum[params.lesson] ?? null;

  const genCfg: GenerateConfig = useMemo(
    () => ({ wordList: "english200", punctuation: false, numbers: false, seed: params.seed }),
    [params.seed],
  );
  const config: TestConfig = useMemo(
    () => (params.mode === "time" && !lesson ? { mode: "time", seconds: params.seconds } : { mode: "words" }),
    [params.mode, params.seconds, lesson],
  );
  const words = useMemo(() => {
    if (lesson) return lesson.drills[params.drill] ?? lesson.drills[0];
    return generateText(params.mode === "time" ? { mode: "time", seconds: params.seconds } : { mode: "words", count: params.count }, genCfg);
  }, [lesson, params, genCfg]);
  const moreWords = useMemo(() => {
    // Offset stream so the refill does not replay the opening words.
    const stream = createWordStream({ ...genCfg, seed: (genCfg.seed ?? 0) + 1000 });
    return (n: number) => stream.next(n);
  }, [genCfg]);

  const [lastSave, setLastSave] = useState<string>("");
  const test = useTypingTest({
    words,
    config,
    moreWords,
    onFinish: (result: TestResult) => {
      if (lesson) {
        const r = recordLessonResult(layoutId, lesson, result);
        setLastSave(JSON.stringify({ lesson: lesson.id, ...r }));
      } else {
        const r = recordResult({ layoutId, result });
        setLastSave(JSON.stringify({ id: r.entry.id, isPersonalBest: r.isPersonalBest }));
      }
    },
  });
  const { handleInput, restart } = test;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || (e.ctrlKey && e.key !== "Backspace")) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        handleInput({ type: "backspace", word: e.ctrlKey || e.altKey });
      } else if (e.key === "Escape") {
        restart();
      } else if (e.key.length === 1) {
        e.preventDefault();
        handleInput({ type: "char", char: e.key, keyId: e.code });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleInput, restart]);

  const results = useResults(layoutId);
  const allResults = useResults();
  const keyStats = useKeyStats(layoutId);
  const weakest = useWeakestKeys(layoutId, 5);
  const progress = useLessonProgress(layoutId);
  const bests = usePersonalBests(layoutId);
  const streak = useStreak();

  const checks = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [name, l] of Object.entries(DEV_LAYOUTS)) {
      const c = buildCurriculum(l);
      const again = buildCurriculum(l);
      const letters = c.flatMap((x) => x.newChars).filter((ch) => ch >= "a" && ch <= "z");
      out[name] = {
        lessons: c.length,
        first: c[0]?.newChars,
        letters: letters.length,
        uniqueLetters: new Set(letters).size,
        deterministic: JSON.stringify(c) === JSON.stringify(again),
        problems: validateCurriculum(l, c),
      };
    }
    return out;
  }, []);

  const shortResult = test.result && { ...test.result, charStats: undefined, mistypes: undefined };
  const visible = test.words.slice(0, Math.max(40, test.caret.wordIndex + 20));

  return (
    <main style={{ padding: 16, ...mono, fontSize: 14, color: "var(--text, #ddd)", background: "var(--bg, #222)", minHeight: "100vh" }}>
      <h1>engine harness</h1>
      <p>
        layout <b data-testid="layout">{layout.name}</b> · mode <b data-testid="mode">{config.mode}</b> · status{" "}
        <b data-testid="status">{test.status}</b> · wpm <b data-testid="wpm">{test.live.wpm}</b> · raw <b data-testid="raw">{test.live.raw}</b> · acc{" "}
        <b data-testid="accuracy">{test.live.accuracy}</b> · elapsed <b data-testid="elapsed">{Math.round(test.live.elapsedMs)}</b> · remaining{" "}
        <b data-testid="remaining">{test.live.remainingMs == null ? "-" : Math.round(test.live.remainingMs)}</b> · next{" "}
        <b data-testid="next-char">{test.nextChar === null ? "null" : JSON.stringify(test.nextChar)}</b> · caret{" "}
        <b data-testid="caret">
          {test.caret.wordIndex}:{test.caret.letterIndex}
        </b>{" "}
        · words <b data-testid="word-count">{test.state.words.length}</b>
      </p>
      <p data-testid="target">{words.slice(0, 60).join(" ")}</p>
      <div data-testid="words" style={{ fontSize: 22, lineHeight: 1.6, display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
        {visible.map((w) => (
          <span key={w.index} data-testid="word" data-index={w.index} data-state={w.state} style={{ textDecoration: w.state === "incorrect" ? "underline" : "none" }}>
            {w.letters.map((l, i) => (
              <span key={i} data-state={l.state} style={{ color: COLORS[l.state], opacity: l.state === "missed" ? 0.5 : 1 }}>
                {l.char}
              </span>
            ))}
          </span>
        ))}
      </div>
      {/* One token per word reached: first letter of each letter state (c/i/e/m/p). */}
      <p data-testid="states">
        {test.words
          .filter((w) => w.state !== "pending")
          .map((w) => w.letters.map((l) => l.state[0]).join(""))
          .join(" ")}
      </p>
      <p data-testid="chars">{JSON.stringify(test.live.chars)}</p>
      <p>
        <button data-testid="restart" onClick={() => restart()}>
          restart (Esc)
        </button>{" "}
        <button data-testid="finish" onClick={() => test.finish()}>
          finish now
        </button>{" "}
        <button data-testid="clear" onClick={() => clearAll()}>
          clear storage
        </button>
      </p>
      <h2>result</h2>
      <pre data-testid="result" style={{ whiteSpace: "pre-wrap" }}>{shortResult ? JSON.stringify(shortResult) : ""}</pre>
      <pre data-testid="char-stats" style={{ whiteSpace: "pre-wrap" }}>{test.result ? JSON.stringify({ charStats: test.result.charStats, mistypes: test.result.mistypes, keyPresses: test.state.keyPresses }) : ""}</pre>
      <pre data-testid="last-save" style={{ whiteSpace: "pre-wrap" }}>{lastSave}</pre>
      <h2>stored</h2>
      <p>
        results for layout <b data-testid="stored-count">{results.length}</b> (all layouts <b data-testid="stored-count-all">{allResults.length}</b>) · streak{" "}
        <b data-testid="streak">{JSON.stringify(streak)}</b>
      </p>
      <pre data-testid="stored-results" style={{ whiteSpace: "pre-wrap" }}>
        {JSON.stringify(results.map((r) => ({ id: r.id, mode: r.mode, modeValue: r.modeValue, wpm: r.wpm, accuracy: r.accuracy, history: r.history.length })))}
      </pre>
      <pre data-testid="bests" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(bests)}</pre>
      <pre data-testid="lesson-progress" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(progress)}</pre>
      <pre data-testid="weakest" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(weakest)}</pre>
      <pre data-testid="key-stats" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(keyStats)}</pre>
      <h2>curriculum checks</h2>
      <pre data-testid="curriculum-check" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(checks)}</pre>
      <h2>curriculum: {layout.name}</h2>
      <ol data-testid="curriculum" start={0}>
        {curriculum.map((l) => (
          <li key={l.id} data-testid="lesson" data-id={l.id} data-stage={l.stage}>
            <b>{l.id}</b> [{l.stage}/{l.kind}] {l.title} | new: {l.newChars.join(" ")} | focus: {l.focusKeyIds.join(",")} | goal {l.goal.accuracy}%/{l.goal.wpm}wpm
            <br />
            <i>{l.description}</i>
            {l.drills.map((d, i) => (
              <div key={i} style={{ color: "var(--sub, #888)" }}>
                {i}: {d.join(" ")}
              </div>
            ))}
          </li>
        ))}
      </ol>
    </main>
  );
}
