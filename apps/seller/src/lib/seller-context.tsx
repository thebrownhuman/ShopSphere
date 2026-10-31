'use client';

import type { SellerAccountView } from '@shopsphere/types';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiCallError, getToken, setToken } from './api';

interface SellerState {
  /** undefined while loading; null when signed in without a seller account. */
  account: SellerAccountView | null | undefined;
  signedIn: boolean;
  refresh: () => Promise<void>;
  setAccount: (a: SellerAccountView) => void;
  signOut: () => void;
}

const Ctx = createContext<SellerState | null>(null);

const PUBLIC = ['/signin'];

export function SellerProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<SellerAccountView | null | undefined>(undefined);
  const [signedIn, setSignedIn] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setSignedIn(false);
      setAccount(null);
      return;
    }
    setSignedIn(true);
    try {
      setAccount(await api<SellerAccountView>('/seller/me'));
    } catch (err) {
      if (err instanceof ApiCallError && err.status === 401) setSignedIn(false);
      setAccount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Route gate: signed out → /signin; no account or not approved → /onboarding.
  useEffect(() => {
    if (account === undefined || PUBLIC.includes(pathname)) return;
    if (!signedIn) router.replace(`/signin?returnTo=${encodeURIComponent(pathname)}`);
    else if ((!account || account.status !== 'APPROVED') && pathname !== '/onboarding') {
      router.replace('/onboarding');
    }
  }, [account, signedIn, pathname, router]);

  const signOut = useCallback(() => {
    setToken(null);
    setSignedIn(false);
    setAccount(null);
    router.replace('/signin');
  }, [router]);

  return (
    <Ctx.Provider value={{ account, signedIn, refresh, setAccount, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSeller(): SellerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSeller outside SellerProvider');
  return v;
}
