'use client';

import type { AdminMe, StaffRole } from '@shopsphere/types';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

interface AdminState {
  /** undefined while loading; null when signed out or not staff. */
  me: AdminMe | null | undefined;
  refresh: () => Promise<void>;
  signOut: () => void;
  can: (...roles: StaffRole[]) => boolean;
}

const Ctx = createContext<AdminState | null>(null);

export function AdminProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      return;
    }
    try {
      setMe(await api<AdminMe>('/admin/me'));
    } catch {
      setToken(null);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (me === null && pathname !== '/signin')
      router.replace(`/signin?returnTo=${encodeURIComponent(pathname)}`);
  }, [me, pathname, router]);

  const signOut = useCallback(() => {
    setToken(null);
    setMe(null);
    router.replace('/signin');
  }, [router]);

  /** UI hint only; the API enforces roles. SUPER_ADMIN can do everything. */
  const can = useCallback(
    (...roles: StaffRole[]) =>
      !!me && (me.roles.includes('SUPER_ADMIN') || roles.some((r) => me.roles.includes(r))),
    [me],
  );

  return <Ctx.Provider value={{ me, refresh, signOut, can }}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdmin outside AdminProvider');
  return v;
}
