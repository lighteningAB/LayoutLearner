"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { useAccount } from "@/lib/auth/client";
import { resolveMismatch, useSyncStatus } from "@/lib/sync/engine";

type Choice = "use-account" | "merge" | "cancel";

/**
 * Shown whenever this device's data belongs to another account than the one just signed in.
 * Cannot be dismissed (no close button, Esc and the backdrop do nothing): one of the three choices
 * has to be made.
 */
export function MismatchDialog() {
  const account = useAccount();
  const sync = useSyncStatus();
  const [busy, setBusy] = useState<Choice | null>(null);
  const open = sync.phase === "mismatch" && sync.mismatch !== null;

  useEffect(() => {
    if (!open) setBusy(null);
  }, [open]);

  const choose = async (choice: Choice) => {
    setBusy(choice);
    await resolveMismatch(choice);
    setBusy(null);
  };

  const name = account.user?.name ?? "your account";
  const prev = sync.mismatch?.localAccountName ?? "a different account";

  return (
    <Modal
      open={open}
      onClose={() => {}}
      showClose={false}
      closeOnBackdrop={false}
      size="md"
      title="This device has data from another account"
      data-testid="mismatch-dialog"
      description={
        <>
          The data in this browser was last synced with <strong className="font-medium text-text">{prev}</strong>. You are
          now signed in as <strong className="font-medium text-text">{name}</strong>.
        </>
      }
    >
      {sync.mismatch?.hasUnsyncedLocalChanges && (
        <p
          role="note"
          data-testid="mismatch-unsynced"
          className="mb-4 border border-error px-3 py-2 text-[14px] leading-snug text-error"
        >
          Some of the data on this device is not stored in that account.
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Choice
          button={
            <Button
              variant="primary"
              fullWidth
              data-testid="mismatch-use-account"
              data-autofocus=""
              disabled={busy !== null}
              onClick={() => void choose("use-account")}
            >
              {busy === "use-account" ? "Working…" : `Use ${name}’s account data`}
            </Button>
          }
        >
          Replaces the progress, settings and layouts on this device with the ones in the account.
        </Choice>
        <Choice
          button={
            <Button fullWidth data-testid="mismatch-merge" disabled={busy !== null} onClick={() => void choose("merge")}>
              {busy === "merge" ? "Working…" : `Merge this device into ${name}’s account`}
            </Button>
          }
        >
          Adds this device&rsquo;s progress and layouts to the account; nothing is removed from the account. Where both
          have a setting, the newer one is kept.
        </Choice>
        <Choice
          button={
            <Button
              variant="ghost"
              fullWidth
              data-testid="mismatch-cancel"
              disabled={busy !== null}
              onClick={() => void choose("cancel")}
            >
              {busy === "cancel" ? "Signing out…" : "Cancel and sign out"}
            </Button>
          }
        >
          Nothing changes. This device keeps its data and is signed out.
        </Choice>
      </div>
      {sync.error && (
        <p role="alert" data-testid="mismatch-error" className="mt-4 text-[14px] text-error">
          {sync.error.message}
        </p>
      )}
    </Modal>
  );
}

function Choice({ button, children }: { button: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      {button}
      <p className="mt-1.5 text-[14px] leading-snug text-sub">{children}</p>
    </div>
  );
}
