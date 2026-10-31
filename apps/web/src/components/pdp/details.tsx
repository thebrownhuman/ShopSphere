'use client';

import { Price, Skeleton, formatPrice } from '@shopsphere/ui';
import { useOffers, usePdp, useSkuAvailability } from './pdp-context';
import { VariantSelector } from './variant-selector';

/** Live price block: never server-rendered, so a cached page can't show a stale price. */
export function PriceBlock() {
  const { data, isLoading } = useOffers();
  const offer = data?.buyBox;
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading price">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }
  if (!offer) return <p className="text-xl font-semibold text-deal">Currently unavailable</p>;
  // Indicative 12-month EMI at 15% p.a.
  const r = 0.15 / 12;
  const emi = Math.ceil(((offer.price / 100) * r * (1 + r) ** 12) / ((1 + r) ** 12 - 1)) * 100;
  return (
    <div data-testid="pdp-price">
      <Price price={offer.price} mrp={offer.mrp} size="lg" />
      <p className="text-sm text-slate-700">Inclusive of all taxes</p>
      <p className="mt-1 text-sm">
        EMI from <b>{formatPrice(emi)}/month</b>. No-cost EMI available.
      </p>
      {data.bankOffers.length > 0 && (
        <details className="mt-3 rounded border border-slate-200 p-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            Bank offers ({data.bankOffers.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {data.bankOffers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function Variants() {
  const { product, sku, selectSku } = usePdp();
  const available = useSkuAvailability();
  if (!product.variantAxes.length) return null;
  return (
    <VariantSelector
      axes={product.variantAxes}
      skus={product.skus}
      selected={sku}
      onSelect={selectSku}
      available={available}
    />
  );
}
