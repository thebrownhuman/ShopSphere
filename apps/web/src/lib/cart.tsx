'use client';

import type {
  AddToCartResponse,
  CartLine,
  CartResponse,
  ProductCard,
} from '@shopsphere/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { track } from './analytics';
import { ApiRequestError, apiRequest, type RequestOptions } from './api';
import { useAuth } from './auth';
import { usePincode } from './pincode';

export type CartResult = { ok: true } | { ok: false; message: string };

export interface AddInput {
  sku: string;
  sellerId?: string;
  qty: number;
  /** For analytics only; the server prices the line. */
  price?: number;
}

export interface DrawerState {
  lineId: string;
  addOns: ProductCard[];
}

interface CartCtx {
  cart: CartResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Header count, including optimistic adds still in flight. */
  count: number;
  /** Increments on every add so the header badge can re-run its animation. */
  bump: number;
  add: (input: AddInput) => Promise<CartResult>;
  setQty: (line: CartLine, qty: number) => Promise<CartResult>;
  remove: (line: CartLine) => Promise<CartResult>;
  saveForLater: (lineId: string) => Promise<CartResult>;
  moveToCart: (savedId: string) => Promise<CartResult>;
  removeSaved: (savedId: string) => Promise<CartResult>;
  drawer: DrawerState | null;
  closeDrawer: () => void;
}

const Ctx = createContext<CartCtx | null>(null);

const message = (err: unknown) =>
  err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.';

const allLines = (c: CartResponse | undefined) => c?.groups.flatMap((g) => g.lines) ?? [];

/** Optimistic edit of one line; the server response replaces it moments later. */
function patchLines(
  cart: CartResponse,
  fn: (line: CartLine) => CartLine | null,
): CartResponse {
  const groups = cart.groups
    .map((g) => ({ ...g, lines: g.lines.map(fn).filter((l): l is CartLine => l !== null) }))
    .filter((g) => g.lines.length > 0);
  const lines = groups.flatMap((g) => g.lines);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * Math.min(l.qty, l.maxQty), 0);
  return {
    ...cart,
    groups,
    summary: {
      ...cart.summary,
      itemCount: lines.reduce((s, l) => s + Math.min(l.qty, l.maxQty), 0),
      lineCount: lines.length,
      subtotal,
    },
  };
}

/**
 * Cart state (M3.7): one react-query cache entry per (pincode, viewer). Writes are optimistic and
 * roll back on error; the server's CartResponse is always the final word on totals.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { status, user, request } = useAuth();
  const { pincode } = usePincode();
  const qc = useQueryClient();
  const [pending, setPending] = useState(0);
  const [bump, setBump] = useState(0);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const key = useMemo(() => ['cart', pincode, user?.id ?? 'guest'], [pincode, user?.id]);

  const call = useCallback(
    <T,>(path: string, opts?: Omit<RequestOptions, 'accessToken'>) => {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${path}${sep}pincode=${pincode}`;
      return status === 'authenticated' ? request<T>(url, opts) : apiRequest<T>(url, opts);
    },
    [status, request, pincode],
  );

  const query = useQuery({
    queryKey: key,
    queryFn: () => call<CartResponse>('/cart'),
    enabled: status !== 'loading',
    staleTime: 15_000,
    // Another tab may have edited the cart.
    refetchOnWindowFocus: true,
  });

  const write = useCallback(
    async (
      fn: () => Promise<CartResponse>,
      optimistic?: (c: CartResponse) => CartResponse,
    ): Promise<CartResult> => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<CartResponse>(key);
      if (before && optimistic) qc.setQueryData(key, optimistic(before));
      try {
        qc.setQueryData(key, await fn());
        return { ok: true };
      } catch (err) {
        qc.setQueryData(key, before);
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 409)) {
          void qc.invalidateQueries({ queryKey: key });
        }
        return { ok: false, message: message(err) };
      }
    },
    [qc, key],
  );

  const add = useCallback(
    async (input: AddInput): Promise<CartResult> => {
      setPending((p) => p + input.qty);
      setBump((b) => b + 1);
      try {
        const res = await call<AddToCartResponse>('/cart/items', {
          method: 'POST',
          body: { sku: input.sku, sellerId: input.sellerId, qty: input.qty, pincode },
        });
        qc.setQueryData(key, res.cart);
        setDrawer({ lineId: res.lineId, addOns: res.addOns });
        const line = allLines(res.cart).find((l) => l.id === res.lineId);
        track('add_to_cart', {
          sku: input.sku,
          sellerId: line?.sellerId ?? input.sellerId,
          qty: input.qty,
          value: (line?.unitPrice ?? input.price ?? 0) * input.qty,
          currency: 'INR',
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, message: message(err) };
      } finally {
        setPending((p) => p - input.qty);
      }
    },
    [call, qc, key, pincode],
  );

  const setQty = useCallback(
    (line: CartLine, qty: number) => {
      if (qty < line.qty) {
        track('remove_from_cart', { sku: line.skuId, qty: line.qty - qty, value: line.unitPrice * (line.qty - qty) });
      }
      return write(
        () => call<CartResponse>(`/cart/items/${line.id}`, { method: 'PATCH', body: { qty } }),
        (c) => patchLines(c, (l) => (l.id === line.id ? { ...l, qty, lineTotal: l.unitPrice * qty } : l)),
      );
    },
    [call, write],
  );

  const remove = useCallback(
    (line: CartLine) => {
      track('remove_from_cart', { sku: line.skuId, qty: line.qty, value: line.lineTotal });
      return write(
        () => call<CartResponse>(`/cart/items/${line.id}`, { method: 'DELETE' }),
        (c) => patchLines(c, (l) => (l.id === line.id ? null : l)),
      );
    },
    [call, write],
  );

  const saveForLater = useCallback(
    (lineId: string) =>
      write(
        () => call<CartResponse>(`/cart/items/${lineId}/save-for-later`, { method: 'POST', body: {} }),
        (c) => patchLines(c, (l) => (l.id === lineId ? null : l)),
      ),
    [call, write],
  );

  const moveToCart = useCallback(
    (savedId: string) =>
      write(() => call<CartResponse>(`/cart/saved/${savedId}/move-to-cart`, { method: 'POST', body: {} })),
    [call, write],
  );

  const removeSaved = useCallback(
    (savedId: string) =>
      write(
        () => call<CartResponse>(`/cart/saved/${savedId}`, { method: 'DELETE' }),
        (c) => ({ ...c, saved: c.saved.filter((s) => s.id !== savedId) }),
      ),
    [call, write],
  );

  const value: CartCtx = {
    cart: query.data,
    isLoading: query.isLoading || status === 'loading',
    isError: query.isError,
    count: (query.data?.summary.itemCount ?? 0) + pending,
    bump,
    add,
    setQty,
    remove,
    saveForLater,
    moveToCart,
    removeSaved,
    drawer,
    closeDrawer: useCallback(() => setDrawer(null), []),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Null outside CartProvider (e.g. isolated component tests): callers render nothing. */
export const useCartMaybe = () => useContext(Ctx);

export function useCart(): CartCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
