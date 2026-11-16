"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card, ConfirmDialog, SettingRow, cx, toast } from "@/components/ui";
import { signOutAccount, useAccount } from "@/lib/auth/client";
import { deleteAccountData, exportSyncedData, syncNow, useSyncStatus } from "@/lib/sync/engine";
import { TONE_TEXT } from "./AccountControl";
import { openSignIn } from "./signin-store";
import { describeSync, useNow } from "./sync-text";

/** Same markup as the local Section/Rows in SettingsView (those are not exported). */
function Section({ children }: { children: React.ReactNode }) {
  return (
    <section
      id="account"
      aria-labelledby="settings-account-title"
      data-testid="settings-account"
      className="grid scroll-mt-6 gap-x-10 gap-y-4 border-t border-border py-8 first:border-t-0 first:pt-0 md:grid-cols-[200px_minmax(0,1fr)]"
    >
      <div>
        <h2 id="settings-account-title" className="text-[15px] font-semibold tracking-tight text-text">
          Account &amp; sync
        </h2>
        <p className="mt-1 text-[13px] leading-snug text-sub">Keep your progress and settings with you across devices.</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <Card padding="none" className="divide-y divide-border/70 px-5">
      {children}
    </Card>
  );
}

/** Settings → "Account & sync". Renders nothing while the feature is off. */
export function AccountSection() {
  const account = useAccount();
  if (!account.enabled) return null;
  if (account.status === "signed-in" && account.user) return <SignedIn name={account.user.name} />;
  return (
    <Section>
      <Rows>
        <SettingRow
          label="Sync across devices"
          description="Sign in to keep your lesson progress, settings and custom layouts in step on every device. Without an account everything stays in this browser."
        >
          <Button
            size="sm"
            icon="log-in"
            data-testid="account-signin-settings"
            disabled={account.status === "loading"}
            onClick={() => openSignIn()}
          >
            Sign in
          </Button>
        </SettingRow>
      </Rows>
    </Section>
  );
}

function SignedIn({ name }: { name: string }) {
  const sync = useSyncStatus();
  const now = useNow(sync.lastSyncedAt);
  const summary = describeSync(sync, now);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const trouble = sync.phase === "error" || sync.phase === "offline";

  const download = () => {
    try {
      const blob = new Blob([exportSyncedData()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "layoutlearner-data.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast("Couldn't export your data", { variant: "error" });
    }
  };

  const remove = async () => {
    setDeleting(true);
    const res = await deleteAccountData();
    setDeleting(false);
    if (res.ok) toast("Account data deleted", { variant: "success" });
    else toast("Couldn't delete account data", { variant: "error", description: res.error });
  };

  return (
    <Section>
      <Rows>
        <SettingRow
          label={
            <>
              Signed in as <span className="text-main">{name}</span>
            </>
          }
          description={
            <span aria-live="polite" data-testid="account-sync-status" className={cx(TONE_TEXT[summary.tone])}>
              {summary.text}
            </span>
          }
        >
          <Button
            size="sm"
            icon="restart"
            data-testid="account-sync-now"
            disabled={sync.phase === "syncing" || sync.phase === "mismatch"}
            onClick={() => void syncNow()}
          >
            {trouble ? "Retry" : "Sync now"}
          </Button>
          <Button size="sm" variant="ghost" icon="log-out" data-testid="account-signout" onClick={() => void signOutAccount()}>
            Sign out
          </Button>
        </SettingRow>

        <div className="py-4" data-testid="account-what-syncs">
          <h3 className="text-sm font-medium text-text">What syncs</h3>
          <p className="mt-0.5 text-[13px] leading-snug text-sub">
            Lesson progress, settings (theme, layout, test preferences…) and custom layouts follow your account.
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-sub" data-testid="account-local-only">
            <span className="font-medium text-text">Stays on this device:</span> Emulate layout (it depends on this
            device&rsquo;s keyboard), Show 3D hands (graphics power varies) and text size (screens differ).
          </p>
        </div>

        <SettingRow label="Export my data" description="Download what syncs as a JSON file. Nothing is sent over the network.">
          <Button size="sm" icon="download" data-testid="account-export" onClick={download}>
            Export
          </Button>
        </SettingRow>

        <SettingRow
          label="Delete account data"
          description={
            <>
              Erases the synced data stored for your account on the server and signs this device out. Data on your
              devices is kept; a device that signs in again uploads its copy.{" "}
              <Link href="/privacy" className="text-main underline-offset-2 hover:underline">
                Privacy
              </Link>
            </>
          }
        >
          <Button
            size="sm"
            variant="danger"
            icon="trash"
            data-testid="account-delete"
            disabled={deleting}
            onClick={() => setConfirmDelete(true)}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </SettingRow>
      </Rows>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        title="Delete account data?"
        description="This erases the synced data (progress, settings, layouts) stored for your account on the server and signs this device out. Request counters used for rate limiting are not erased. This device and your other devices keep their own copies: the others are signed out when they next sync, and any device that signs in again uploads its copy to the account."
        confirmLabel="Delete account data"
        tone="danger"
        data-testid="confirm-delete-account"
      />
    </Section>
  );
}
