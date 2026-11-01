import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Grievance Officer',
  description:
    'Contact ShopSphere’s Grievance Officer (Consumer Protection (E-Commerce) Rules 2020, IT Rules 2021, DPDP Act 2023).',
};

/** Grievance redressal (M7.3). Rule 4(4)-(5) of the Consumer Protection (E-Commerce) Rules 2020. */
export default function GrievancePage() {
  return (
    <LegalPage
      title="Grievance Officer"
      updated="1 November 2026"
      sections={[
        {
          id: 'officer',
          title: 'Contact',
          body: (
            <address className="not-italic" data-testid="grievance-officer">
              <p>
                <b>Ms. Kavya Iyer</b> (simulated), Grievance Officer and Nodal Contact
              </p>
              <p>ShopSphere Marketplace Pvt. Ltd. (simulated)</p>
              <p>4th Floor, Prestige Tech Park, Outer Ring Road, Bengaluru, Karnataka 560103</p>
              <p>
                Email: <a href="mailto:grievance@shopsphere.test">grievance@shopsphere.test</a>
              </p>
              <p>Phone: 080-4000-0000 (Mon–Sat, 9 am – 6 pm IST)</p>
            </address>
          ),
        },
        {
          id: 'timelines',
          title: 'What happens next',
          body: (
            <ul>
              <li>We acknowledge your complaint within 48 hours and give you a ticket number.</li>
              <li>We resolve it within one month of receiving it.</li>
              <li>
                You can track it under <Link href="/help/contact">Help → Contact us</Link>.
              </li>
            </ul>
          ),
        },
        {
          id: 'covers',
          title: 'What you can raise',
          body: (
            <ul>
              <li>Orders, deliveries, returns, refunds and sellers (Consumer Protection Act).</li>
              <li>Your personal data and privacy rights (DPDP Act, 2023).</li>
              <li>Content on ShopSphere, such as reviews (IT Rules, 2021).</li>
            </ul>
          ),
        },
        {
          id: 'escalate',
          title: 'If you are not satisfied',
          body: (
            <p>
              You can approach the National Consumer Helpline (1915) or the consumer commission, and
              for personal data the Data Protection Board of India.
            </p>
          ),
        },
      ]}
    />
  );
}
