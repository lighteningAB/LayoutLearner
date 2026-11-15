import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = { title: "Privacy" };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border py-6 first:border-t-0 first:pt-0">
      <h2 className="text-[15px] font-semibold tracking-tight text-text">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-sub">{children}</div>
    </section>
  );
}

const List = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-1.5 pl-5 marker:text-sub/60">{children}</ul>
);

export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy" description="What LayoutLearner stores, where, and how to get rid of it." />
      <div className="max-w-2xl" data-testid="privacy-page">
        <Block title="Without an account">
          <p>
            Everything stays in this browser&rsquo;s localStorage: your settings, custom layouts and lesson progress. Nothing
            is sent to us, and clearing the data in Settings removes it.
          </p>
        </Block>

        <Block title="With an account">
          <p>
            Signing in is optional and only used to sync your data between your devices. When you sign in, our server
            stores:
          </p>
          <List>
            <li>
              an account id: a one-way hash of the sign-in provider and your account number at that provider, so it
              cannot be turned back into either;
            </li>
            <li>
              your synced document &mdash; lesson progress, settings and custom layouts &mdash; with a version number and
              a timestamp;
            </li>
            <li>
              request counters used for abuse limits: your account id and a count per time window. They are erased
              when you delete your account data, except the counter that limits how often you can delete, which may
              remain for up to a day.
            </li>
          </List>
          <p>
            The data is kept in a Postgres database hosted by Neon, served through Vercel. Three settings are never
            synced because they depend on the device: Emulate layout, Show 3D hands and text size.
          </p>
        </Block>

        <Block title="What we do not store">
          <p>
            Not your email address, and not your name or avatar. The name and avatar are read from the sign-in provider
            when you sign in and kept only in your browser&rsquo;s session cookie: encrypted, HTTP-only, and valid for 30
            days. Signing out removes it. This browser also remembers locally which account its data last belonged to.
          </p>
        </Block>

        <Block title="Sign-in providers">
          <p>
            GitHub or Google (whichever you choose) learn that you signed in to this app. We ask them only for your basic
            profile, not your email.
          </p>
        </Block>

        <Block title="Export and delete">
          <p>
            <span className="text-text">Export:</span> Settings &rarr; Account &amp; sync &rarr; Export my data downloads
            what syncs as a JSON file.
          </p>
          <p>
            <span className="text-text">Delete:</span> Settings &rarr; Account &amp; sync &rarr; Delete account data erases
            your document from the server immediately and signs you out. The data on this device is kept.
          </p>
        </Block>

        <Block title="Analytics and ads">
          <p>Accounts and sync add no analytics, advertising or tracking.</p>
        </Block>

        <p className="pt-2 text-[13px] text-sub">
          <Link href="/settings#account" className="text-main underline-offset-2 hover:underline">
            Go to Account &amp; sync settings
          </Link>
        </p>
      </div>
    </>
  );
}
