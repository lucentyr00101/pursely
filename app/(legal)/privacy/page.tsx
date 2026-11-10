import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/components/legal-links";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="text-sm text-subtle">Effective November 10, 2026</p>

      <p>
        Pursely is a personal expense tracker. This policy explains what information Pursely collects when you use
        it, how that information is used, and the choices you have.
      </p>

      <h2>Information we collect</h2>
      <p>When you sign in with Google, we receive and store:</p>
      <ul>
        <li>Your name, email address and profile picture.</li>
        <li>Your Google account identifier and the sign-in tokens Google issues, which are used only to sign you in.</li>
      </ul>
      <p>When you use the app, we store the information you enter:</p>
      <ul>
        <li>Transactions (amount, date, category and note), custom categories, monthly budgets and your currency setting.</li>
        <li>Household membership and invites, including the email addresses of people you invite.</li>
      </ul>
      <p>To keep your account secure, each sign-in session records the IP address and browser user agent it came from.</p>

      <h2>How we use your information</h2>
      <ul>
        <li>To sign you in and keep you signed in.</li>
        <li>To store, display, chart and export your financial records.</li>
        <li>To let you share a ledger with the members of your household.</li>
      </ul>
      <p>
        We do not sell your information, use it for advertising, or use it to train machine learning models. Pursely
        does not use analytics or tracking tools.
      </p>

      <h2>Google user data</h2>
      <p>
        Pursely requests only the basic Google scopes needed for sign-in (your name, email address and profile
        picture). Pursely&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>Cookies</h2>
      <p>Pursely sets only the cookies it needs to work:</p>
      <ul>
        <li>Session cookies that keep you signed in.</li>
        <li>A timezone cookie so that &quot;today&quot; matches your local date.</li>
      </ul>

      <h2>Sharing</h2>
      <p>Your information is shared only in these cases:</p>
      <ul>
        <li>
          <strong>Household members.</strong> If you join or create a household, its members can see the shared ledger,
          along with your name, email address and profile picture.
        </li>
        <li>
          <strong>Service providers.</strong> Pursely is hosted on Vercel and stores data in MongoDB Atlas. Google
          provides sign-in. These providers process data only to run the service.
        </li>
        <li>
          <strong>Legal requirements.</strong> When disclosure is required by law.
        </li>
      </ul>

      <h2>Retention and deletion</h2>
      <p>
        Your data is kept while your account exists. You can export your transactions as CSV from Settings at any time.
        You can delete your account and all of its data yourself from Settings, at once. You can also email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address you sign in with, and it will be
        deleted within 30 days. Records you added to a household ledger stay with that household after you leave it
        or delete your account.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over HTTPS and every request is checked against your account, so only you and your household can
        read your ledger. No method of storage or transmission is completely secure, so we can&apos;t guarantee
        absolute security.
      </p>

      <h2>Children</h2>
      <p>Pursely is not meant for children under 13, and we don&apos;t knowingly collect their information.</p>

      <h2>Changes to this policy</h2>
      <p>
        If this policy changes, the new version will be posted here with a new effective date. Continuing to use
        Pursely after a change means you accept the updated policy.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy or your data: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also
        the <Link href="/terms">Terms of Service</Link>.
      </p>
    </article>
  );
}
