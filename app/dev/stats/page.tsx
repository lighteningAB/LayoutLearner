"use client";

// Dev harness for the Stats page: seed / clear the sample data for any preset layout.
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { parseLayout } from "@/lib/layout/parse";
import { PRESETS } from "@/lib/layout/presets";
import { DEMO_WEAK, clearDemoData, hasDemoData, seedDemoData } from "@/lib/stats/demo";

export default function StatsDevPage() {
  const [log, setLog] = useState("");
  const [, bump] = useState(0);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-text">Stats sample data</h1>
      <p className="text-sm text-sub">
        Weak spots: errors {DEMO_WEAK.errors.join(" ")} · slow {DEMO_WEAK.slow.join(" ")} · usage {DEMO_WEAK.usage.join(" ")}
      </p>
      <Card className="space-y-2">
        {PRESETS.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-48 text-sm text-text">{p.name}</span>
            <Button
              size="sm"
              data-testid={`seed-${p.id}`}
              onClick={() => {
                const n = seedDemoData(p.id, { layout: parseLayout(p.source, p.name) });
                setLog(`seeded ${n} results for ${p.id}`);
                bump((v) => v + 1);
              }}
            >
              Seed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid={`clear-${p.id}`}
              onClick={() => {
                clearDemoData(p.id);
                setLog(`cleared ${p.id}`);
                bump((v) => v + 1);
              }}
            >
              Clear
            </Button>
            <span className="text-xs text-sub" suppressHydrationWarning>
              {typeof window !== "undefined" && hasDemoData(p.id) ? "loaded" : ""}
            </span>
          </div>
        ))}
      </Card>
      <Button href="/stats" variant="primary" size="sm">
        Open /stats
      </Button>
      <pre data-testid="log" className="text-xs text-sub">
        {log}
      </pre>
    </div>
  );
}
