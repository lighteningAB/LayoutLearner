"use client";

import { useState, type ReactNode } from "react";
import {
  Button,
  Card,
  ConfirmDialog,
  SegmentedControl,
  Select,
  SettingRow,
  Slider,
  Toggle,
  toast,
} from "@/components/ui";
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TIME_AMOUNTS,
  WORD_AMOUNTS,
  WORD_LISTS,
  clearAllData,
  resetSettings,
  useSettings,
  type Settings,
  type TestMode,
} from "@/lib/settings";
import { AccountSection } from "@/components/account/AccountSection";
import { useAccount } from "@/lib/auth/client";
import { ThemePicker } from "./ThemePicker";

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`settings-${id}`}
      data-testid={`settings-section-${id}`}
      className="grid gap-x-10 gap-y-4 border-t border-border py-8 first:border-t-0 first:pt-0 md:grid-cols-[200px_minmax(0,1fr)]"
    >
      <div>
        <h2 id={`settings-${id}`} className="text-[15px] font-semibold tracking-tight text-text">
          {title}
        </h2>
        <p className="mt-1 text-[13px] leading-snug text-sub">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return (
    <Card padding="none" className="divide-y divide-border/70 px-5">
      {children}
    </Card>
  );
}

type BooleanKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

export function SettingsView() {
  const [settings, update] = useSettings();
  const [confirmClear, setConfirmClear] = useState(false);
  const signedIn = useAccount().status === "signed-in";

  const toggleRow = (key: BooleanKey, label: string, description: string) => (
    <SettingRow label={label} description={description} htmlFor={`setting-${key}`}>
      <Toggle
        id={`setting-${key}`}
        data-testid={`setting-${key}`}
        checked={settings[key]}
        onChange={(v) => update({ [key]: v })}
      />
    </SettingRow>
  );

  const amounts: readonly number[] = settings.testMode === "time" ? TIME_AMOUNTS : WORD_AMOUNTS;
  const customLayout = settings.customLayouts.find((l) => l.id === settings.layoutId);

  return (
    <div data-testid="settings-view">
      <Section id="appearance" title="Appearance" description="Pick a theme. The typing text size only affects the test and lessons.">
        <ThemePicker value={settings.theme} onChange={(theme) => update({ theme })} />
        <Rows>
          <SettingRow label="Typing text size" description="Size of the words you type." labelId="setting-fontSize-label" className="mt-3">
            <Slider
              aria-labelledby="setting-fontSize-label"
              data-testid="setting-fontSize"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={settings.fontSize}
              valueText={`${settings.fontSize} pixels`}
              onChange={(fontSize) => update({ fontSize })}
            />
            <span className="w-10 text-right font-mono text-sm text-main tabular-nums" data-testid="setting-fontSize-value">
              {settings.fontSize}px
            </span>
          </SettingRow>
          <div className="flex h-20 items-center overflow-hidden" aria-hidden>
            <p className="truncate font-mono leading-none" style={{ fontSize: settings.fontSize }}>
              <span className="text-text">the quick br</span>
              <span className="mx-px inline-block h-[1.15em] w-[2px] rounded-full bg-caret align-[-0.2em]" />
              <span className="text-sub">own fox jumps over the lazy dog</span>
            </p>
          </div>
        </Rows>
      </Section>

      <Section id="test" title="Test" description="Defaults for the typing test. You can also change these from the test itself.">
        <Rows>
          <SettingRow label="Mode" description="Race the clock or type a fixed number of words." labelId="setting-testMode-label">
            <SegmentedControl<TestMode>
              aria-labelledby="setting-testMode-label"
              data-testid="setting-testMode"
              value={settings.testMode}
              onChange={(testMode) =>
                update({ testMode, testAmount: testMode === "time" ? TIME_AMOUNTS[1] : WORD_AMOUNTS[1] })
              }
              options={[
                { value: "time", label: "time", icon: "clock" },
                { value: "words", label: "words", icon: "type" },
              ]}
            />
          </SettingRow>
          <SettingRow
            label={settings.testMode === "time" ? "Duration" : "Length"}
            description={settings.testMode === "time" ? "Seconds per test." : "Words per test."}
            labelId="setting-testAmount-label"
          >
            <SegmentedControl<number>
              aria-labelledby="setting-testAmount-label"
              data-testid="setting-testAmount"
              value={settings.testAmount}
              onChange={(testAmount) => update({ testAmount })}
              options={amounts}
              className="font-mono"
            />
          </SettingRow>
          <SettingRow label="Word list" description="Where test words are drawn from." labelId="setting-wordList-label">
            <Select
              aria-labelledby="setting-wordList-label"
              data-testid="setting-wordList"
              align="end"
              value={settings.wordList}
              onChange={(wordList) => update({ wordList })}
              options={WORD_LISTS.map((w) => ({ value: w.id as string, label: w.name }))}
            />
          </SettingRow>
          {toggleRow("punctuation", "Punctuation", "Mix in commas, full stops, quotes and capitals.")}
          {toggleRow("numbers", "Numbers", "Sprinkle digits between the words.")}
        </Rows>
      </Section>

      <Section id="layout" title="Layout" description="The layout you are learning.">
        <Rows>
          <SettingRow
            label="Current layout"
            description={
              <span className="font-mono text-main" data-testid="setting-layoutId">
                {customLayout?.name ?? settings.layoutId}
              </span>
            }
          >
            <Button href="/layouts" size="sm" iconRight="arrow-right">
              Change
            </Button>
          </SettingRow>
          {toggleRow(
            "emulateLayout",
            "Emulate layout",
            "Off: the app uses whatever characters your OS produces (right if your OS is already set to this layout). On: the app remaps your physical keys itself, so you can practise on a QWERTY system without changing OS settings.",
          )}
        </Rows>
      </Section>

      <Section id="guides" title="Guides" description="Visual help while you build muscle memory. Turn them off as you improve.">
        <Rows>
          {toggleRow("showKeyboard", "Show keyboard", "On-screen keyboard that highlights the next key.")}
          {toggleRow("showHands", "Show 3D hands", "Rigged hands that show which finger reaches for each key.")}
          {toggleRow("fingerColors", "Finger colours", "Tint each key with the colour of the finger that owns it.")}
        </Rows>
      </Section>

      <Section id="feel" title="Feel" description="Small things that change how typing feels.">
        <Rows>
          {toggleRow("smoothCaret", "Smooth caret", "Glide the caret between characters instead of jumping.")}
          {toggleRow("soundOnError", "Sound on error", "Play a soft tick when you hit the wrong key.")}
        </Rows>
      </Section>

      <AccountSection />

      <Section id="data" title="Data" description={signedIn ? "Settings, custom layouts and lesson progress are kept in this browser and synced to your account." : "Settings, custom layouts and lesson progress live only in this browser."}>
        <Rows>
          <SettingRow label="Reset settings" description="Back to the defaults. Custom layouts and lesson progress are kept.">
            <Button
              size="sm"
              icon="restart"
              data-testid="settings-reset"
              onClick={() => {
                const { customLayouts } = settings;
                resetSettings();
                update({ customLayouts });
                toast("Settings reset to defaults", { variant: "success" });
              }}
            >
              Reset
            </Button>
          </SettingRow>
          <SettingRow label="Clear all data" description="Delete everything LayoutLearner has stored in this browser.">
            <Button size="sm" variant="danger" icon="trash" data-testid="settings-clear" onClick={() => setConfirmClear(true)}>
              Clear data
            </Button>
          </SettingRow>
        </Rows>
      </Section>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clearAllData();
          toast("All local data cleared", { variant: "success" });
        }}
        title="Clear all data?"
        description={"This removes your settings, custom layouts and lesson progress from this browser" + (signedIn ? " and signs this device out. Your account’s data on the server is not deleted. It cannot be undone here." : ". It cannot be undone.")}
        confirmLabel="Clear everything"
        tone="danger"
        data-testid="confirm-clear"
      />
    </div>
  );
}
