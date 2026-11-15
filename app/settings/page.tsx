import type { Metadata } from "next";
import { PageHeader } from "@/components/shell";
import { SettingsView } from "@/components/shell/settings/SettingsView";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Everything is saved in this browser, instantly." />
      <SettingsView />
    </>
  );
}
