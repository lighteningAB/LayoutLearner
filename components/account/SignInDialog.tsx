"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Input, Modal, toast } from "@/components/ui";
import { signInWith, useAccount } from "@/lib/auth/client";
import { closeSignIn, useSignInOpen } from "./signin-store";

const DEV_USERNAME_RE = /^[a-z0-9_-]{1,24}$/;

/** The one sign-in dialog. Mounted once (AccountGlobals); open it with openSignIn(). */
export function SignInDialog() {
  const open = useSignInOpen();
  const account = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devError, setDevError] = useState<string | null>(null);
  const [username, setUsername] = useState("alice");

  const oauth = account.providers.filter((p) => p.kind === "oauth");
  const dev = account.providers.find((p) => p.kind === "dev");

  // Fresh state every time it opens.
  useEffect(() => {
    if (open) {
      setBusy(null);
      setError(null);
      setDevError(null);
    }
  }, [open]);

  // Signed in (here or in another tab): nothing left to do.
  useEffect(() => {
    if (open && account.status === "signed-in") closeSignIn();
  }, [open, account.status]);

  // Back/forward cache can restore this page mid-redirect with the button still "pending".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const startOAuth = async (id: string) => {
    setBusy(id);
    setError(null);
    const res = await signInWith(id);
    // On success the browser is leaving for the provider; keep the pending state.
    if (!res.ok) {
      setBusy(null);
      setError(res.error ?? "Sign-in failed");
    }
  };

  const submitDev = async (e: FormEvent) => {
    e.preventDefault();
    if (!dev || busy) return;
    const name = username.trim().toLowerCase();
    if (!DEV_USERNAME_RE.test(name)) {
      setDevError("Use 1 to 24 characters: a-z, 0-9, - or _.");
      return;
    }
    setBusy(dev.id);
    setDevError(null);
    const res = await signInWith(dev.id, { username: name });
    setBusy(null);
    if (res.ok) {
      closeSignIn();
    } else {
      setDevError(res.error ?? "Sign-in failed");
    }
  };

  return (
    <Modal
      open={open && account.enabled}
      onClose={closeSignIn}
      title="Sign in"
      size="sm"
      data-testid="signin-dialog"
      description={
        <>
          Sign in to sync your lesson progress, settings and custom layouts across devices. We store only that data and
          an anonymous account id — not your email.{" "}
          <Link href="/privacy" onClick={closeSignIn} className="text-main underline-offset-2 hover:underline">
            Privacy
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {oauth.map((p, i) => (
          <Button
            key={p.id}
            variant={i === 0 ? "primary" : "subtle"}
            fullWidth
            data-testid={`signin-provider-${p.id}`}
            data-autofocus={i === 0 ? "" : undefined}
            disabled={busy !== null}
            aria-busy={busy === p.id || undefined}
            onClick={() => void startOAuth(p.id)}
          >
            {busy === p.id ? "Redirecting…" : `Continue with ${p.name}`}
          </Button>
        ))}
        {error && (
          <p role="alert" data-testid="signin-error" className="text-[13px] text-error">
            {error}
          </p>
        )}
      </div>

      {dev && (
        <form
          onSubmit={submitDev}
          noValidate
          data-testid="signin-dev"
          className={oauth.length > 0 ? "mt-5 border-t border-border pt-4" : undefined}
        >
          <label htmlFor="signin-dev-username" className="block text-[13px] font-medium text-text">
            Development sign-in
          </label>
          <p className="mt-0.5 text-xs text-sub">Local development only. Pick any username; no password.</p>
          <div className="mt-2.5 flex gap-2">
            <Input
              id="signin-dev-username"
              data-testid="signin-dev-username"
              size="sm"
              mono
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              data-autofocus={oauth.length === 0 ? "" : undefined}
              aria-invalid={devError ? true : undefined}
              aria-describedby={devError ? "signin-dev-error" : undefined}
              onChange={(e) => setUsername(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant={oauth.length === 0 ? "primary" : "subtle"}
              data-testid="signin-dev-submit"
              disabled={busy !== null}
            >
              {busy === dev.id ? "Signing in…" : "Sign in"}
            </Button>
          </div>
          {devError && (
            <p id="signin-dev-error" role="alert" data-testid="signin-dev-error" className="mt-2 text-[13px] text-error">
              {devError}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}

/**
 * next-auth sends a failed OAuth round trip back to "/?error=…". Say so once and clean the URL
 * (no reload, router state kept).
 */
export function SignInErrorFromUrl() {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("error")) return;
      url.searchParams.delete("error");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      toast("Sign-in failed", { variant: "error", description: "Please try again." });
    } catch {
      /* never block the app */
    }
  }, []);
  return null;
}
