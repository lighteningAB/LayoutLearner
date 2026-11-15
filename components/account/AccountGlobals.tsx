"use client";

import { AccountCommands } from "./AccountCommands";
import { MismatchDialog } from "./MismatchDialog";
import { SignInDialog, SignInErrorFromUrl } from "./SignInDialog";
import { SyncToasts } from "./SyncToasts";

/** Everything account-related that lives outside the page content. Only mounted when the feature is on. */
export function AccountGlobals() {
  return (
    <>
      <SignInDialog />
      <MismatchDialog />
      <SyncToasts />
      <AccountCommands />
      <SignInErrorFromUrl />
    </>
  );
}
