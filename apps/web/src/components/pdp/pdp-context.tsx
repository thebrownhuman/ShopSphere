'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getDeliveryEstimate, getOffers } from '@/lib/api/catalog';
import type { ProductDetail, Sku } from '@/lib/api/catalog.types';
import { usePincode } from '@/lib/pincode';

/** PRD §6: price and stock are live, cached at most 60 s. */
const LIVE_STALE_MS = 60_000;

interface PdpCtx {
  product: ProductDetail;
  sku: Sku;
  selectSku: (skuId: string) => void;
}

const Ctx = createContext<PdpCtx | null>(null);

function skuFromLocation(product: ProductDetail): string {
  const id = new URLSearchParams(window.location.search).get('sku');
  return id && product.skus.some((s) => s.id === id) ? id : product.defaultSkuId;
}

/**
 * Selected variant lives in `?sku=` so variant links are shareable. The page itself never reads
 * searchParams (that would opt it out of ISR): the server renders the default SKU and the client
 * switches after hydration. Changing variant uses history.replaceState: no navigation, no reload.
 */
export function PdpProvider({
  product,
  children,
}: {
  product: ProductDetail;
  children: ReactNode;
}) {
  const [skuId, setSkuId] = useState(product.defaultSkuId);

  useEffect(() => {
    setSkuId(skuFromLocation(product));
    const onPop = () => setSkuId(skuFromLocation(product));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [product]);

  const selectSku = useCallback(
    (id: string) => {
      const url = new URL(window.location.href);
      if (id === product.defaultSkuId) url.searchParams.delete('sku');
      else url.searchParams.set('sku', id);
      window.history.replaceState(window.history.state, '', url);
      setSkuId(id);
    },
    [product.defaultSkuId],
  );

  const sku = product.skus.find((s) => s.id === skuId) ?? product.skus[0]!;
  const value = useMemo(() => ({ product, sku, selectSku }), [product, sku, selectSku]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePdp(): PdpCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePdp outside PdpProvider');
  return ctx;
}

export const offersKey = (productId: string, skuId: string) =>
  ['offers', productId, skuId] as const;

export function useOffers() {
  const { product, sku } = usePdp();
  return useQuery({
    queryKey: offersKey(product.id, sku.id),
    queryFn: ({ signal }) => getOffers(product.id, sku.id, { signal }),
    staleTime: LIVE_STALE_MS,
  });
}

/** Stock for every SKU, to grey out unavailable variants. */
export function useSkuAvailability(): Map<string, boolean> | null {
  const { product } = usePdp();
  const results = useQueries({
    queries: product.skus.map((s) => ({
      queryKey: offersKey(product.id, s.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => getOffers(product.id, s.id, { signal }),
      staleTime: LIVE_STALE_MS,
    })),
  });
  if (results.some((r) => !r.data)) return null;
  return new Map(product.skus.map((s, i) => [s.id, !!results[i]!.data!.buyBox]));
}

export function useDelivery() {
  const { sku } = usePdp();
  const { pincode } = usePincode();
  return useQuery({
    queryKey: ['delivery', sku.id, pincode],
    queryFn: ({ signal }) => getDeliveryEstimate(sku.id, pincode, { signal }),
    staleTime: LIVE_STALE_MS,
  });
}
