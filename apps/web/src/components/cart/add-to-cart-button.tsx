'use client';

import { Button, cx, type ButtonProps } from '@shopsphere/ui';
import { useState } from 'react';
import { useCartMaybe } from '@/lib/cart';

/**
 * Add to Cart (M3.7) for the PDP buy box, tiles and deal rows. Optimistic: the header count moves
 * at once and rolls back with an inline message ("Only 2 available") if the server refuses.
 */
export function AddToCartButton({
  sku,
  sellerId,
  qty = 1,
  price,
  label = 'Add to Cart',
  className,
  errorClassName,
  ...rest
}: {
  sku: string;
  sellerId?: string;
  qty?: number;
  price?: number;
  label?: string;
  errorClassName?: string;
} & Omit<ButtonProps, 'onClick' | 'children'>) {
  const cart = useCartMaybe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!cart) return null;

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await cart.add({ sku, sellerId, qty, price });
    setBusy(false);
    if (!r.ok) setError(r.message);
  };

  return (
    <div className={cx('relative z-10', className)}>
      <Button
        data-testid="add-to-cart"
        {...rest}
        onClick={onClick}
        // Not `disabled` while busy: a disabled button drops keyboard focus, which then cannot
        // return here when the added-to-cart drawer closes (M7.4).
        disabled={rest.disabled}
        aria-disabled={busy || undefined}
        aria-busy={busy}
      >
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
            Adding…
          </span>
        ) : (
          label
        )}
      </Button>
      {error && (
        <p role="alert" className={cx('mt-1 text-xs font-medium text-deal', errorClassName)}>
          {error}
        </p>
      )}
    </div>
  );
}
