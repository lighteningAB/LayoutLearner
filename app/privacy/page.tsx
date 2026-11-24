import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell";

export const metadata: Metadata = { title: "Privacy" };

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-5 pb-10 first:border-t-line">
      <h2 className="ll-heading text-text">{title}</h2>
      <div className="mt-4 space-y-3.5 text-[17px] leading-[1.6] text-text">{children}</div>
    </section>
  );
}

const List = ({ children }: { children: ReactNode }) => (
  <ul className="list-[square] space-y-2.5 pl-5 marker:text-border">{children}</ul>
);

// Keep this sentence word for word in step with docs/accounts-setup.md (section 11, "What is stored").
const COUNTER_RETENTION =
  "After you delete your account data, the short-lived request counters (account id, counter name, count and " +
  "timestamp) are not erased with it. They are removed by a periodic cleanup once they are more than a day old. The " +
  "cleanup runs when someone uses sync, so normally they are gone a little over a day after your last request; while " +
  "nobody uses sync at all they stay until the next request. A device that is still signed in creates new counters " +
  "when it next syncs.";

export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy" description="What LayoutLearner stores, where, and how to get rid of it." />
      <div className="max-w-[70ch] text-[17px]" data-testid="privacy-page">
        <Block title="Without an account">
          <p>
            Your settings, custom layouts and lesson progress stay in this browser&rsquo;s localStorage. They are not sent
            to us, and clearing the data in Settings removes them.
          </p>
          <p>
            The site is served by Vercel. Like any web host, it receives your IP address and the addresses of the pages
            you request in order to deliver them.
          </p>
        </Block>

        <Block title="With an account">
          <p>
            Signing in is optional and only used to sync your data between your devices. When you sign in, our server
            stores:
          </p>
          <List>
            <li>
              an account id: a pseudonymous identifier computed (as a SHA-256 hash) from the name of the sign-in provider
              and your account number at that provider. It contains no name or email address, but it is not anonymous:
              someone with access to our database could work out which GitHub or Google account an id belongs to, by
              hashing candidate account numbers until one matches;
            </li>
            <li>
              your synced document &mdash; lesson progress, settings and custom layouts &mdash; with a version number and
              a timestamp;
            </li>
            <li>
              request counters used for abuse limits: your account id, the name of the counter (read, write or delete),
              a count and the time its current window started. They are short-lived; see &ldquo;Export and
              delete&rdquo; below for when they are removed.
            </li>
          </List>
          <p>
            The data is kept in a Postgres database hosted by Neon, served through Vercel. Three settings are never
            synced because they depend on the device: Emulate layout, Show 3D hands and text size.
          </p>
        </Block>

        <Block title="What we do not store">
          <p>
            Not your email address, and not your name or avatar: none of them is written to our database. The name and
            avatar address are read from the sign-in provider when you sign in and kept in your browser&rsquo;s session
            cookie, which is encrypted and HTTP-only. Your browser sends that cookie back with each request so the app
            can show who is signed in.
          </p>
        </Block>

        <Block title="Sessions and cookies">
          <p>
            A session lasts at most 30 days from the moment you signed in; after that you have to sign in again, however
            often you used the app in between. Signing in also sets a few small technical cookies that protect the
            sign-in itself (a CSRF token, the address to return to, and the provider&rsquo;s sign-in state).
          </p>
          <p>
            Signing out deletes the session cookie from this browser. Sessions are not tracked on the server, so we
            cannot cancel one remotely: if someone had copied your cookie, the copy would keep working until 30 days
            after the sign-in it came from. For the same reason, signing out on one device does not sign out your
            other devices, and deleting your account data signs them out only when they next sync.
          </p>
          <p>
            This browser also remembers locally (in localStorage) whether you are signed in, which account its data
            last belonged to, and its copy of the synced document.
          </p>
        </Block>

        <Block title="Sign-in providers">
          <p>
            GitHub or Google (whichever you choose) learn that you signed in to this app. We request only basic profile
            access and no email permission. If your GitHub profile shows a public email address, GitHub includes it in
            the profile it sends us; we discard it. Your avatar picture is loaded by your browser directly from the
            provider&rsquo;s servers.
          </p>
        </Block>

        <Block title="Export and delete">
          <p>
            <span className="font-semibold">Export:</span> Settings &rarr; Account &amp; sync &rarr; Export my data downloads
            what syncs as a JSON file.
          </p>
          <p>
            <span className="font-semibold">Delete:</span> Settings &rarr; Account &amp; sync &rarr; Delete account data erases
            your document from our database immediately and signs this device out. The data on this device is kept.
          </p>
          <p>What deleting does not do:</p>
          <List>
            <li>
              It does not sign out your other devices right away. A device that is still signed in notices the next
              time it syncs, signs itself out and keeps its own local data. In a rare case where another device is
              saving at the very moment you delete, that save can store a document again; deleting once more removes
              it.
            </li>
            <li>
              It does not erase the copies kept in your browsers. If you sign in to the same account again on a device
              that still has its data, that device uploads its copy and the account holds it again. To remove
              everything, also use Clear all data on each device.
            </li>
            <li>
              {COUNTER_RETENTION}
            </li>
            <li>
              The database host (Neon) can keep a short history of the database for recovery, so a deleted document
              may persist in that history until it ages out.
            </li>
          </List>
        </Block>

        <Block title="Analytics and ads">
          <p>Accounts and sync add no analytics, advertising or tracking.</p>
        </Block>

        <p className="border-t border-line pt-5 text-[17px]">
          <Link href="/settings#account" className="text-text underline decoration-main decoration-2 underline-offset-4 hover:text-main">
            Go to Account &amp; sync settings
          </Link>
        </p>
      </div>
    </>
  );
}
