"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, Kbd, Modal, cx } from "@/components/ui";
import { THEMES, getSettings, previewTheme, useSettings, type Settings } from "@/lib/settings";
import { NAV_LINKS } from "./nav-links";
import {
  closeCommandPalette,
  fuzzyScore,
  openCommandPalette,
  usePaletteState,
  type Command,
} from "./commands";

type BooleanSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const TOGGLES: { key: BooleanSetting; label: string; icon: Command["icon"]; keywords?: string }[] = [
  { key: "showKeyboard", label: "Show keyboard", icon: "keyboard", keywords: "hide 2d" },
  { key: "showHands", label: "Show 3D hands", icon: "hand", keywords: "hide fingers" },
  { key: "fingerColors", label: "Finger colours", icon: "palette", keywords: "colors tint" },
  { key: "emulateLayout", label: "Emulate layout", icon: "layers", keywords: "remap os" },
  { key: "punctuation", label: "Punctuation", icon: "at" },
  { key: "numbers", label: "Numbers", icon: "hash", keywords: "digits" },
  { key: "smoothCaret", label: "Smooth caret", icon: "cursor", keywords: "cursor animation" },
  { key: "soundOnError", label: "Sound on error", icon: "volume", keywords: "audio beep" },
];

export function CommandPalette() {
  const { open, initialQuery } = usePaletteState();

  // Global shortcuts: Esc (when nothing else claimed it) and Ctrl/Cmd+K.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closeCommandPalette();
        else if (!document.querySelector("[data-ll-modal]")) openCommandPalette();
        return;
      }
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !open &&
        !document.querySelector("[data-ll-modal]")
      ) {
        e.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={closeCommandPalette}
      label="Command palette"
      position="top"
      size="lg"
      bare
      data-testid="command-palette"
      className="overflow-hidden"
    >
      {open && <PaletteBody initialQuery={initialQuery} />}
    </Modal>
  );
}

function PaletteBody({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [settings, update] = useSettings();
  const { extra } = usePaletteState();
  const [query, setQuery] = useState(initialQuery);
  // Highlight is remembered per query; a new query falls back to its default row.
  const [sel, setSel] = useState<{ q: string; i: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = NAV_LINKS.map((l) => ({
      id: `go:${l.href}`,
      label: l.label,
      group: "Go to",
      icon: l.icon,
      keywords: `${l.keywords} navigate open page`,
      run: () => router.push(l.href),
    }));
    const themes: Command[] = THEMES.map((t) => ({
      id: `theme:${t.id}`,
      label: `Theme: ${t.name}`,
      group: "Theme",
      icon: t.scheme === "light" ? "sun" : "moon",
      keywords: `${t.scheme} colour color appearance ${t.description}`,
      hint: settings.theme === t.id ? <Icon name="check" size={15} className="text-main" /> : undefined,
      themePreview: t.id,
      run: () => update({ theme: t.id }),
    }));
    const toggles: Command[] = TOGGLES.map((t) => ({
      id: `toggle:${t.key}`,
      label: t.label,
      group: "Settings",
      icon: t.icon,
      keywords: `toggle setting ${t.keywords ?? ""}`,
      hint: (
        <span
          className={cx(
            "ll-lettering-sm inline-flex h-5 items-center border px-1.5",
            settings[t.key] ? "border-main bg-main text-main-fg" : "border-border text-sub",
          )}
        >
          <span className="ll-trim">{settings[t.key] ? "on" : "off"}</span>
        </span>
      ),
      keepOpen: true,
      run: () => update({ [t.key]: !getSettings()[t.key] }),
    }));
    const mode: Command[] = (["time", "words"] as const).map((m) => ({
      id: `mode:${m}`,
      label: `Test mode: ${m}`,
      group: "Settings",
      icon: m === "time" ? "clock" : "type",
      keywords: "test mode setting",
      hint: settings.testMode === m ? <Icon name="check" size={15} className="text-main" /> : undefined,
      run: () => update({ testMode: m, testAmount: m === "time" ? 30 : 25 }),
    }));
    return [...extra, ...nav, ...themes, ...mode, ...toggles];
  }, [router, settings, update, extra]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return commands;
    return commands
      .map((c, i) => {
        const onLabel = fuzzyScore(q, c.label);
        const s = onLabel >= 0 ? onLabel + 40 : fuzzyScore(q, `${c.label} ${c.group ?? ""} ${c.keywords ?? ""}`, false);
        return { c, i, s };
      })
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((r) => r.c);
  }, [commands, query]);

  // When browsing themes, start on the current one instead of the first row.
  const defaultIndex = useMemo(() => {
    if (!/^theme:?\s*$/i.test(query)) return 0;
    return Math.max(0, results.findIndex((c) => c.id === `theme:${getSettings().theme}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const rawIndex = sel && sel.q === query ? sel.i : defaultIndex;
  const activeIndex = Math.min(rawIndex, Math.max(0, results.length - 1));
  const activeCommand = results[activeIndex];
  const setActive = (i: number) => setSel({ q: query, i });

  // Live theme preview while a theme command is highlighted; restored on close.
  const previewId = activeCommand?.themePreview ?? null;
  useEffect(() => {
    previewTheme(previewId);
  }, [previewId, settings.theme]);
  useEffect(() => () => previewTheme(null), []);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    if (!cmd.keepOpen) closeCommandPalette();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const n = results.length;
    const down = e.key === "ArrowDown" || (e.ctrlKey && e.key === "n");
    const up = e.key === "ArrowUp" || (e.ctrlKey && e.key === "p");
    if (down || up) {
      e.preventDefault();
      if (n) setActive((activeIndex + (down ? 1 : -1) + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(activeCommand);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      if (n) setActive(Math.min(n - 1, Math.max(0, activeIndex + (e.key === "PageDown" ? 6 : -6))));
    }
  };

  const showGroups = !query.trim();

  return (
      <div onKeyDown={onKeyDown}>
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          <Icon name="search" size={18} className="text-sub" />
          <input
            data-autofocus=""
            data-testid="command-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={activeCommand ? `${uid}-${activeCommand.id}` : undefined}
            aria-autocomplete="list"
            aria-label="Search commands"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-lg text-text outline-none placeholder:text-sub"
          />
          <Kbd>esc</Kbd>
        </div>
        <div
          ref={listRef}
          id={`${uid}-list`}
          role="listbox"
          aria-label="Commands"
          className="max-h-[min(52vh,420px)] overflow-y-auto p-1.5"
        >
          {results.length === 0 && (
            <div className="px-3 py-8 text-center text-base text-sub" data-testid="command-empty">
              Nothing matches “{query.trim()}”
            </div>
          )}
          {results.map((c, i) => {
            const isActive = i === activeIndex;
            const heading = showGroups && c.group && c.group !== results[i - 1]?.group ? c.group : null;
            return (
              <div key={c.id} role="none">
                {heading && (
                  <div
                    role="presentation"
                    className={cx("ll-lettering-sm flex items-center gap-3 px-2.5 pb-1.5 text-sub", i > 0 ? "pt-4" : "pt-2")}
                  >
                    {heading}
                    <span aria-hidden className="h-px flex-1 bg-hairline" />
                  </div>
                )}
                <div
                  id={`${uid}-${c.id}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive}
                  data-command={c.id}
                  onPointerMove={() => !isActive && setActive(i)}
                  onClick={() => run(c)}
                  className={cx(
                    "flex h-10 cursor-pointer items-center gap-3 border px-2.5 text-base",
                    isActive ? "border-line bg-fill-strong text-text" : "border-transparent text-sub",
                  )}
                >
                  {c.icon ? (
                    <Icon name={c.icon} size={16} className={isActive ? "text-main" : undefined} />
                  ) : (
                    <span className="w-4" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint}
                  {!showGroups && c.group && !c.label.startsWith(c.group) && <span className="ll-lettering-sm text-sub">{c.group}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-sm text-sub">
          <span className="flex items-center gap-1.5">
            <Kbd size="sm">↑</Kbd>
            <Kbd size="sm">↓</Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd size="sm">↵</Kbd>
            select
          </span>
          <span className="ll-readout ml-auto" data-testid="command-count">
            {results.length}
          </span>
        </div>
      </div>
  );
}
