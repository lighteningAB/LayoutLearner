"use client";

import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  ConfirmDialog,
  ICON_NAMES,
  Icon,
  IconButton,
  Input,
  Kbd,
  Menu,
  Modal,
  ProgressBar,
  SegmentedControl,
  Select,
  SettingRow,
  Skeleton,
  Slider,
  Stat,
  Tabs,
  Textarea,
  Toggle,
  Tooltip,
  toast,
} from "@/components/ui";
import { PageHeader, openCommandPalette } from "@/components/shell";
import { FINGER_ORDER } from "@/lib/types";
import { THEMES, useSettings, type ThemeId } from "@/lib/settings";

const COLOR_TOKENS = [
  "bg",
  "bg-alt",
  "border",
  "text",
  "sub",
  "main",
  "main-fg",
  "caret",
  "error",
  "error-alt",
  "success",
  "key-bg",
  "key-border",
  "key-text",
] as const;

const TYPE_SCALE: [string, string, string][] = [
  ["text-6xl font-mono font-medium", "96", "Stat lg · mono 60"],
  ["text-4xl font-mono font-medium", "74.2", "Stat md · mono 36"],
  ["text-[28px] font-semibold tracking-tight", "Page title", "sans 28 / 600"],
  ["text-lg font-semibold tracking-tight", "Dialog title", "sans 18 / 600"],
  ["text-[15px] font-semibold tracking-tight", "Section & card title", "sans 15 / 600"],
  ["text-[15px]", "Body copy for descriptions and longer prose.", "sans 15 / 400"],
  ["text-sm", "Controls, rows and menu items.", "sans 14 / 400"],
  ["text-[13px] text-sub", "Secondary descriptions under labels.", "sans 13 / sub"],
  ["text-xs text-sub", "Captions, hints and footer text.", "sans 12 / sub"],
  ["font-mono text-2xl", "the quick brown fox", "typing text · mono 24"],
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-8" data-testid={`ui-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <h2 className="mb-5 font-mono text-xs text-main lowercase">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-x-4 gap-y-2 py-2 sm:flex-row sm:items-center">
      <div className="w-24 shrink-0 text-xs text-sub">{label}</div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function fingerName(i: number) {
  const f = FINGER_ORDER[i];
  return `${f.hand} ${f.finger}`;
}

function ThemeTokens({ theme }: { theme: (typeof THEMES)[number] }) {
  return (
    <div data-theme={theme.id} data-testid={`tokens-${theme.id}`} className="rounded-ui-lg border border-border bg-bg p-5 text-text">
      <div className="flex items-baseline justify-between">
        <div className="text-[15px] font-semibold tracking-tight">{theme.name}</div>
        <div className="font-mono text-xs text-sub">
          {theme.id} · {theme.scheme}
        </div>
      </div>
      <p className="mt-1 text-[13px] text-sub">{theme.description}</p>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {COLOR_TOKENS.map((t) => (
          <div key={t} className="min-w-0">
            <div className="h-9 rounded-ui-sm border border-border" style={{ backgroundColor: `var(--${t})` }} />
            <div className="mt-1 truncate font-mono text-[10px] text-sub">{t}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {FINGER_ORDER.map((_, i) => (
          <div
            key={`tint-${i}`}
            title={`--finger-${i} (${fingerName(i)}) as a keycap tint`}
            className="flex size-9 items-center justify-center rounded-ui-sm border font-mono text-xs text-key-text"
            style={{
              backgroundColor: `color-mix(in srgb, var(--finger-${i}) 30%, var(--key-bg))`,
              borderColor: `color-mix(in srgb, var(--finger-${i}) 55%, var(--key-border))`,
            }}
          >
            {i}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {FINGER_ORDER.map((_, i) => (
          <div
            key={`solid-${i}`}
            title={`--finger-${i} (${fingerName(i)}) solid`}
            className="flex size-9 items-center justify-center rounded-ui-sm font-mono text-xs font-medium"
            style={{ backgroundColor: `var(--finger-${i})`, color: theme.scheme === "dark" ? "var(--bg)" : "#fff" }}
          >
            {"asdf  jkl;"[i] === " " ? "␣" : "asdf  jkl;"[i]}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-mono">
          typed<span className="mx-px inline-block h-[1.1em] w-[2px] bg-caret align-[-0.2em]" />
          <span className="text-sub">upcoming </span>
          <span className="text-error">wrong</span>
          <span className="text-error-alt">extra</span>
        </span>
        <span className="rounded-ui-sm bg-main px-2 py-0.5 text-xs font-medium text-main-fg">accent</span>
        <span className="text-xs text-success">success</span>
        <Kbd>esc</Kbd>
      </div>
    </div>
  );
}

export default function UiKitchenSink() {
  const [settings, update] = useSettings();
  const [on, setOn] = useState(true);
  const [off, setOff] = useState(false);
  const [seg, setSeg] = useState("30");
  const [mode, setMode] = useState("time");
  const [fruit, setFruit] = useState("colemak");
  const [tab, setTab] = useState("overview");
  const [slider, setSlider] = useState(40);
  const [modal, setModal] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [menuLog, setMenuLog] = useState("—");

  return (
    <div data-testid="ui-kitchen-sink">
      <PageHeader
        eyebrow="dev / ui"
        title="Design system"
        description="Every primitive, token and state. Switch theme to check them all."
        actions={
          <SegmentedControl<ThemeId>
            aria-label="Theme"
            data-testid="ui-theme-switcher"
            size="sm"
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={THEMES.map((t) => ({ value: t.id, label: t.name.toLowerCase() }))}
          />
        }
      />

      <Section title="Buttons">
        <Row label="primary">
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary">Start test</Button>
          <Button variant="primary" size="lg" icon="play">Large</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </Row>
        <Row label="subtle">
          <Button size="sm">Small</Button>
          <Button icon="restart">Restart</Button>
          <Button size="lg" iconRight="arrow-right">Next lesson</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row label="ghost">
          <Button variant="ghost" size="sm">Small</Button>
          <Button variant="ghost" icon="copy">Copy</Button>
          <Button variant="ghost" size="lg">Large</Button>
          <Button variant="ghost" disabled>Disabled</Button>
        </Row>
        <Row label="danger">
          <Button variant="danger" size="sm" icon="trash">Delete</Button>
          <Button variant="danger">Clear data</Button>
          <Button href="/settings" iconRight="arrow-right">As a link</Button>
        </Row>
        <Row label="icon button">
          <IconButton icon="restart" label="Restart" size="sm" />
          <IconButton icon="restart" label="Restart" />
          <IconButton icon="restart" label="Restart" size="lg" />
          <IconButton icon="plus" label="Add" variant="subtle" />
          <IconButton icon="check" label="Done" variant="primary" />
          <IconButton icon="trash" label="Delete" variant="danger" />
          <Tooltip content="Restart test">
            <IconButton icon="restart" label="Restart test" />
          </Tooltip>
          <Tooltip content="Tooltip below" side="bottom">
            <Button variant="ghost" size="sm">hover or focus me</Button>
          </Tooltip>
        </Row>
      </Section>

      <Section title="Choice controls">
        <Row label="toggle">
          <Toggle checked={on} onChange={setOn} aria-label="Demo on" data-testid="ui-toggle" />
          <Toggle checked={off} onChange={setOff} aria-label="Demo off" />
          <Toggle checked={on} onChange={setOn} size="sm" aria-label="Small" />
          <Toggle checked={on} onChange={setOn} label="With label" />
          <Toggle checked disabled onChange={() => {}} aria-label="Disabled on" />
          <Toggle checked={false} disabled onChange={() => {}} aria-label="Disabled off" />
        </Row>
        <Row label="segmented">
          <SegmentedControl aria-label="Mode" value={mode} onChange={setMode} options={[
            { value: "time", label: "time", icon: "clock" },
            { value: "words", label: "words", icon: "type" },
            { value: "quote", label: "quote", disabled: true },
          ]} />
          <SegmentedControl aria-label="Seconds" size="sm" value={seg} onChange={setSeg} options={["15", "30", "60", "120"]} className="font-mono" />
        </Row>
        <Row label="inline">
          <SegmentedControl aria-label="Mode inline" variant="inline" value={mode} onChange={setMode} options={[
            { value: "time", label: "time", icon: "clock" },
            { value: "words", label: "words", icon: "type" },
          ]} />
          <span className="h-4 w-px bg-border" />
          <SegmentedControl aria-label="Seconds inline" variant="inline" value={seg} onChange={setSeg} options={["15", "30", "60", "120"]} className="font-mono" data-testid="ui-segmented-inline" />
        </Row>
        <Row label="select">
          <Select aria-label="Layout" data-testid="ui-select" value={fruit} onChange={setFruit} options={[
            { value: "qwerty", label: "QWERTY", hint: "default" },
            { value: "dvorak", label: "Dvorak" },
            { value: "colemak", label: "Colemak" },
            { value: "colemak-dh", label: "Colemak-DH" },
            { value: "workman", label: "Workman", disabled: true },
          ]} />
          <Select aria-label="Small" size="sm" value={"" as string} onChange={() => {}} placeholder="Placeholder" options={[{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }]} />
          <Select aria-label="Disabled" disabled value="a" onChange={() => {}} options={[{ value: "a", label: "Disabled" }]} />
        </Row>
        <Row label="menu">
          <Menu
            aria-label="Layout actions"
            trigger={(p) => <Button {...p} iconRight="chevron-down" data-testid="ui-menu">Actions</Button>}
            items={[
              { label: "Edit", icon: "edit", hint: "E", onSelect: () => setMenuLog("edit") },
              { label: "Duplicate", icon: "copy", onSelect: () => setMenuLog("duplicate") },
              { label: "Export", icon: "download", disabled: true },
              { label: "Delete", icon: "trash", danger: true, separator: true, onSelect: () => setMenuLog("delete") },
            ]}
          />
          <span className="font-mono text-xs text-sub" data-testid="ui-menu-log">last: {menuLog}</span>
        </Row>
        <Row label="slider">
          <Slider aria-label="Demo slider" value={slider} onChange={setSlider} data-testid="ui-slider" />
          <span className="font-mono text-sm text-main tabular-nums">{slider}</span>
          <Slider aria-label="Disabled slider" value={30} onChange={() => {}} disabled />
        </Row>
        <Row label="input">
          <Input aria-label="Name" placeholder="Layout name" className="max-w-56" />
          <Input aria-label="Small" size="sm" placeholder="Small" className="max-w-40" />
          <Input aria-label="Invalid" aria-invalid defaultValue="not json" mono className="max-w-40" />
        </Row>
        <Row label="textarea">
          <Textarea aria-label="KLE JSON" mono defaultValue={'["Q","W","E","R","T","Y"],\n["A","S","D","F","G","H"]'} className="max-w-md" />
        </Row>
      </Section>

      <Section title="Tabs">
        <Tabs
          aria-label="Demo tabs"
          data-testid="ui-tabs"
          value={tab}
          onChange={setTab}
          items={[
            { value: "overview", label: "Overview", icon: "chart", content: <p className="text-sm text-sub">Overview panel. Arrow keys move between tabs.</p> },
            { value: "keys", label: "Per key", icon: "keyboard", content: <p className="text-sm text-sub">Per-key panel.</p> },
            { value: "history", label: "History", icon: "clock", content: <p className="text-sm text-sub">History panel.</p> },
            { value: "off", label: "Disabled", disabled: true },
          ]}
        />
      </Section>

      <Section title="Data display">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card><Stat label="wpm" value="74" hint="best 92" /></Card>
          <Card><Stat label="accuracy" value="96.4" unit="%" tone="text" /></Card>
          <Card><Stat label="errors" value="7" tone="error" size="sm" /><Stat className="mt-4" label="streak" value="12" unit="days" tone="success" size="sm" /></Card>
          <Card variant="outline"><Stat label="time" value="0:30" tone="sub" /></Card>
        </div>
        <div className="mt-8 flex flex-wrap items-end gap-x-12 gap-y-6">
          <Stat size="lg" label="wpm" value="88" />
          <Stat size="lg" label="acc" value="98" unit="%" />
          <Stat label="raw" value="93" tone="text" />
          <Stat label="consistency" value="81" unit="%" tone="text" />
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <Card>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Solid panel on bg-alt, for grouped content.</CardDescription>
            <div className="mt-5 space-y-3">
              <ProgressBar aria-label="Lesson progress" value={64} />
              <ProgressBar aria-label="Accuracy" value={92} tone="success" size="md" />
              <ProgressBar aria-label="Errors" value={18} tone="error" size="xs" />
            </div>
          </Card>
          <Card variant="outline">
            <CardTitle>Outline card</CardTitle>
            <CardDescription>Transparent with a border, for quieter grouping.</CardDescription>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge>neutral</Badge>
              <Badge tone="main">current</Badge>
              <Badge tone="success" icon="check">done</Badge>
              <Badge tone="error" icon="alert">3 weak keys</Badge>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-sub">
              <Kbd>tab</Kbd>+<Kbd>enter</Kbd><span className="mx-2">·</span><Kbd>esc</Kbd><span className="mx-2">·</span><Kbd size="sm">⌘</Kbd><Kbd size="sm">K</Kbd>
            </div>
            <div className="mt-5 space-y-2">
              <Skeleton animate className="h-3 w-2/3 rounded-full" />
              <Skeleton animate className="h-3 w-1/3 rounded-full" />
            </div>
          </Card>
        </div>
        <Card padding="none" className="mt-3 divide-y divide-border/70 px-5">
          <SettingRow label="Setting row" description="Label and description left, control right." htmlFor="ui-row-toggle">
            <Toggle id="ui-row-toggle" checked={on} onChange={setOn} />
          </SettingRow>
          <SettingRow label="With a wider control" description="Wraps under the label on narrow screens.">
            <SegmentedControl aria-label="Row seconds" value={seg} onChange={setSeg} options={["15", "30", "60", "120"]} className="font-mono" />
          </SettingRow>
        </Card>
      </Section>

      <Section title="Overlays">
        <Row label="modal">
          <Button onClick={() => setModal(true)} data-testid="ui-open-modal">Open modal</Button>
          <Button variant="danger" onClick={() => setConfirm(true)} data-testid="ui-open-confirm">Confirm dialog</Button>
          <Button variant="ghost" icon="command" onClick={() => openCommandPalette()}>Command palette</Button>
        </Row>
        <Row label="toast">
          <Button size="sm" onClick={() => toast("Layout saved")} data-testid="ui-toast-info">Info</Button>
          <Button size="sm" onClick={() => toast("Lesson complete", { variant: "success", description: "Home row · 96% accuracy" })}>Success</Button>
          <Button size="sm" onClick={() => toast("Could not parse layout", { variant: "error", description: "Unexpected token at line 3" })}>Error</Button>
        </Row>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Rename layout"
          description="Focus is trapped here; Esc or the backdrop closes it."
          data-testid="ui-modal"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModal(false)}>Save</Button>
            </>
          }
        >
          <Input aria-label="Layout name" defaultValue="My split layout" data-autofocus="" />
        </Modal>
        <ConfirmDialog
          open={confirm}
          onClose={() => setConfirm(false)}
          onConfirm={() => toast("Deleted", { variant: "success" })}
          title="Delete this layout?"
          description="This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
        />
      </Section>

      <Section title="Type scale">
        <div className="divide-y divide-border/70">
          {TYPE_SCALE.map(([cls, sample, note]) => (
            <div key={note} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
              <div className={`min-w-0 truncate ${cls}`}>{sample}</div>
              <div className="font-mono text-xs text-sub">{note}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Icons">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2">
          {ICON_NAMES.map((n) => (
            <div key={n} className="flex flex-col items-center gap-2 rounded-ui bg-bg-alt px-1 py-3 text-text">
              <Icon name={n} size={20} />
              <span className="max-w-full truncate font-mono text-[10px] text-sub">{n}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Colour tokens and finger colours, all themes">
        <div className="grid gap-3 lg:grid-cols-2">
          {THEMES.map((t) => (
            <ThemeTokens key={t.id} theme={t} />
          ))}
        </div>
      </Section>
    </div>
  );
}
