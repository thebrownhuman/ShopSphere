import { formatPaise } from '@shopsphere/ui';
import type { PriceBreakdown as Breakdown } from '@/lib/api/checkout.types';

/** PRD §8 price breakdown. Every number comes from the server; this only lays it out. */
export function PriceBreakdown({ price, itemCount }: { price: Breakdown; itemCount: number }) {
  const rows: Array<[string, string, string?]> = [
    [`Items (${itemCount})`, formatPaise(price.items)],
    ['Delivery', price.delivery === 0 ? 'FREE' : formatPaise(price.delivery)],
  ];
  if (price.discount > 0)
    rows.push(['Coupon / bank offer', `−${formatPaise(price.discount)}`, 'text-green-800']);
  if (price.giftCard > 0)
    rows.push(['Gift card applied', `−${formatPaise(price.giftCard)}`, 'text-green-800']);
  if (price.codFee > 0) rows.push(['COD fee', formatPaise(price.codFee)]);

  return (
    <section aria-labelledby="price-heading" data-testid="price-breakdown">
      <h2 id="price-heading" className="mb-2 text-sm font-bold uppercase text-slate-600">
        Price details
      </h2>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, value, cls]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt>{label}</dt>
            <dd className={cls}>{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-dashed border-slate-300 pt-2 text-base font-bold">
          <dt>Order total (incl. GST)</dt>
          <dd data-testid="order-total">{formatPaise(price.total)}</dd>
        </div>
      </dl>
      {price.savings > 0 && (
        <p className="mt-2 text-sm font-semibold text-green-800">
          You save {formatPaise(price.savings)} on this order
        </p>
      )}
    </section>
  );
}
