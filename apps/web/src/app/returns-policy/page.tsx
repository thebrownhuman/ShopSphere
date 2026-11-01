import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';

export const metadata: Metadata = {
  title: 'Return Policy',
  description: 'Return windows, refunds and replacements on ShopSphere.',
};

const WINDOWS: Array<[string, string]> = [
  ['Mobiles, electronics, books', '7 days from delivery'],
  ['Fashion, home & kitchen, other categories', '10 days from delivery'],
  ['Grocery, beauty & personal care', 'Not returnable (hygiene)'],
];

/** Return Policy (M7.3), matching the windows enforced by the returns module. */
export default function ReturnsPolicyPage() {
  return (
    <LegalPage
      title="Return Policy"
      updated="1 November 2026"
      sections={[
        {
          id: 'windows',
          title: 'Return windows',
          body: (
            <>
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Return window by category</caption>
                <thead>
                  <tr className="border-b border-slate-300 text-left">
                    <th scope="col" className="py-2 pr-4">
                      Category
                    </th>
                    <th scope="col" className="py-2">
                      Window
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {WINDOWS.map(([c, w]) => (
                    <tr key={c} className="border-b border-slate-200">
                      <td className="py-2 pr-4">{c}</td>
                      <td className="py-2">{w}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                An order with items from several categories uses the shortest window. The window for
                each product is also shown on its product page.
              </p>
            </>
          ),
        },
        {
          id: 'how',
          title: 'How to return',
          body: (
            <p>
              Open the order in <Link href="/orders">Your Orders</Link> and choose &ldquo;Return or
              replace&rdquo;. Pick a reason and a pickup day; a courier collects the item from your
              address.
            </p>
          ),
        },
        {
          id: 'refunds',
          title: 'Refunds and replacements',
          body: (
            <ul>
              <li>
                After the seller checks the item, we refund it to your original payment method (5–7
                working days) or instantly to ShopSphere Pay balance if you chose that.
              </li>
              <li>Cash on delivery orders are refunded to ShopSphere Pay balance.</li>
              <li>
                Electronics, mobiles, appliances and fashion can be replaced with the same item when
                it is in stock.
              </li>
            </ul>
          ),
        },
        {
          id: 'damaged',
          title: 'Damaged, defective or wrong items',
          body: (
            <p>
              Report these within the return window with photos in the return request. Defective
              items under manufacturer warranty after the window are handled by the brand&rsquo;s
              service centre.
            </p>
          ),
        },
      ]}
    />
  );
}
