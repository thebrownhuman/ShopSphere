import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Privacy Notice',
  description: 'How ShopSphere collects, uses and protects your personal data (DPDP Act, 2023).',
};

/** Privacy notice under the Digital Personal Data Protection Act, 2023 (M7.3). */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Notice"
      updated="1 November 2026"
      sections={[
        {
          id: 'who',
          title: 'Who we are',
          body: (
            <p>
              ShopSphere (&ldquo;we&rdquo;) runs an online marketplace where ShopSphere warehouses
              and independent sellers sell to you. For the personal data described here we are the
              Data Fiduciary under the Digital Personal Data Protection Act, 2023 (DPDP Act).
            </p>
          ),
        },
        {
          id: 'collect',
          title: 'What we collect',
          body: (
            <ul>
              <li>
                Account details: name, email address, mobile number, password hash, 2FA status.
              </li>
              <li>Delivery addresses and the address snapshot stored with each order.</li>
              <li>
                Orders, returns, invoices, store balance and gift card activity. Card and UPI
                details are handled by the payment gateway; we never store your full card number.
              </li>
              <li>Reviews, questions and answers you post, and support tickets.</li>
              <li>Sign-in sessions and devices (browser, IP address) for security alerts.</li>
              <li>
                Browsing history on ShopSphere (recently viewed, searches) to personalise the store.
              </li>
            </ul>
          ),
        },
        {
          id: 'use',
          title: 'Why we use it',
          body: (
            <ul>
              <li>To create your account, take and deliver orders, process returns and refunds.</li>
              <li>To issue GST tax invoices and keep records the law requires.</li>
              <li>To protect your account and our store from fraud.</li>
              <li>
                To send order updates and, only if you opt in, offers (see notification
                preferences).
              </li>
            </ul>
          ),
        },
        {
          id: 'sharing',
          title: 'Who we share it with',
          body: (
            <p>
              The seller of each order (name, delivery address and phone, to ship it), courier
              partners, payment gateways and banks, and authorities where the law requires. We do
              not sell your personal data.
            </p>
          ),
        },
        {
          id: 'cookies',
          title: 'Cookies',
          body: (
            <>
              <p>
                <b>Essential cookies</b> keep you signed in (refresh token, HttpOnly), remember your
                cart and protect forms (CSRF). They are always on.
              </p>
              <p>
                <b>Analytics</b> and <b>marketing</b> cookies are off until you allow them in the
                cookie banner. You can change your choice any time with &ldquo;Cookie
                preferences&rdquo; at the bottom of every page.
              </p>
            </>
          ),
        },
        {
          id: 'retention',
          title: 'How long we keep it',
          body: (
            <p>
              We keep account data while your account is open. Orders and invoices are kept for 8
              years as GST law requires (CGST Act, section 36), even after your account is deleted;
              they are anonymised so they no longer identify you.
            </p>
          ),
        },
        {
          id: 'rights',
          title: 'Your rights',
          body: (
            <>
              <ul>
                <li>
                  <b>Access and portability</b>: download a copy of your data from{' '}
                  <Link href="/account/privacy">Your Account → Privacy &amp; data</Link>. We email
                  you when the archive is ready.
                </li>
                <li>
                  <b>Correction</b>: edit your details in{' '}
                  <Link href="/account/security">Login &amp; Security</Link> and{' '}
                  <Link href="/account/addresses">Your Addresses</Link>.
                </li>
                <li>
                  <b>Erasure</b>: delete your account from the same page. After a 14-day grace
                  period (in which you can cancel by signing in) your personal data is erased and
                  you are signed out everywhere.
                </li>
                <li>
                  <b>Withdraw consent</b> for marketing and analytics at any time.
                </li>
                <li>
                  <b>Grievance redressal</b> through our{' '}
                  <Link href="/grievance">Grievance Officer</Link>, and then the Data Protection
                  Board of India.
                </li>
              </ul>
            </>
          ),
        },
      ]}
    />
  );
}
