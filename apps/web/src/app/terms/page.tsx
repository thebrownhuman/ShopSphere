import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Conditions of Use',
  description: 'Terms for using ShopSphere and buying from ShopSphere sellers.',
};

/** Conditions of Use (M7.3). */
export default function TermsPage() {
  return (
    <LegalPage
      title="Conditions of Use"
      updated="1 November 2026"
      sections={[
        {
          id: 'marketplace',
          title: 'Our marketplace',
          body: (
            <p>
              ShopSphere operates a marketplace. Products are sold either from ShopSphere warehouses
              or by independent sellers; the seller of each product, its address and the country of
              origin are shown on the product page and on your invoice. The seller is responsible
              for the product, its warranty and its invoice.
            </p>
          ),
        },
        {
          id: 'account',
          title: 'Your account',
          body: (
            <p>
              Keep your sign-in details safe and tell us at once if you think someone else has used
              your account. You must be 18 or older, or use ShopSphere with a parent or guardian.
            </p>
          ),
        },
        {
          id: 'prices',
          title: 'Prices, offers and payment',
          body: (
            <p>
              Prices include GST. We confirm the final price before you pay; if it changes during
              checkout we ask you again. Coupons and bank offers carry their own conditions shown at
              checkout. Store balance and gift cards can be used only on ShopSphere and cannot be
              withdrawn or transferred.
            </p>
          ),
        },
        {
          id: 'cancellation',
          title: 'Cancellations and returns',
          body: (
            <p>
              You can cancel an order until it ships. Returns follow our{' '}
              <Link href="/returns-policy">Return Policy</Link>. We do not charge cancellation fees
              unless the seller bears a comparable charge for cancelling on you.
            </p>
          ),
        },
        {
          id: 'content',
          title: 'Reviews and questions',
          body: (
            <p>
              Reviews must be about the product and written by verified buyers. We remove content
              that is abusive, contains contact details or links, or is reported and found to break
              these rules.
            </p>
          ),
        },
        {
          id: 'law',
          title: 'Governing law and complaints',
          body: (
            <p>
              These conditions are governed by the laws of India, including the Consumer Protection
              Act, 2019 and the Consumer Protection (E-Commerce) Rules, 2020. Complaints go to our{' '}
              <Link href="/grievance">Grievance Officer</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
