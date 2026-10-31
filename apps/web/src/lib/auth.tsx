'use client';

import type { AuthResponse, AuthUser } from '@shopsphere/types';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiRequestError, apiRequest, readCookie, type RequestOptions } from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: AuthUser | null;
  /** Store a successful sign-in response (access token stays in memory only). */
  setSession: (res: Extract<AuthResponse, { status: 'authenticated' }>) => void;
  setUser: (user: AuthUser) => void;
  /** Bearer request with one silent refresh + retry on expired access token. */
  request: <T>(path: string, opts?: Omit<RequestOptions, 'accessToken'>) => Promise<T>;
  logout: (all?: boolean) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUserState] = useState<AuthUser | null>(null);
  const token = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Single-flight: concurrent refreshes would spend the same refresh token twice (= reuse → revoke).
  const inflight = useRef<Promise<string | null> | null>(null);
  const refreshRef = useRef<() => Promise<string | null>>(async () => null);

  const clear = useCallback(() => {
    token.current = null;
    if (timer.current) clearTimeout(timer.current);
    setUserState(null);
    setStatus('anonymous');
  }, []);

  const apply = useCallback((res: Extract<AuthResponse, { status: 'authenticated' }>) => {
    token.current = res.accessToken;
    setUserState(res.user);
    setStatus('authenticated');
    if (timer.current) clearTimeout(timer.current);
    // Refresh a minute before the 15-minute access token lapses.
    timer.current = setTimeout(
      () => void refreshRef.current(),
      Math.max(res.expiresIn - 60, 30) * 1000,
    );
  }, []);

  const refresh = useCallback((): Promise<string | null> => {
    if (!inflight.current) {
      inflight.current = apiRequest<AuthResponse>('/auth/refresh', { method: 'POST' })
        .then((res) => {
          if (res.status !== 'authenticated') throw new Error('unexpected');
          apply(res);
          return res.accessToken;
        })
        .catch(() => {
          clear();
          return null;
        })
        .finally(() => {
          inflight.current = null;
        });
    }
    return inflight.current;
  }, [apply, clear]);
  refreshRef.current = refresh;

  useEffect(() => {
    // Only a signed-in browser has the CSRF cookie; skip the round-trip otherwise.
    if (readCookie('ss_csrf')) void refresh();
    else setStatus('anonymous');
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const request = useCallback(
    async <T,>(path: string, opts: Omit<RequestOptions, 'accessToken'> = {}): Promise<T> => {
      const accessToken = token.current ?? (await refresh());
      try {
        return await apiRequest<T>(path, { ...opts, accessToken });
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'ACCESS_TOKEN_EXPIRED') {
          const fresh = await refresh();
          if (fresh) return apiRequest<T>(path, { ...opts, accessToken: fresh });
        }
        if (err instanceof ApiRequestError && err.code === 'SESSION_EXPIRED') clear();
        throw err;
      }
    },
    [refresh, clear],
  );

  const logout = useCallback(async (all = false) => {
    await apiRequest(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST' }).catch(
      () => undefined,
    );
    // Full navigation instead of clear() + router.push: clearing state first would let
    // RequireAuth bounce to /signin, and a reload also re-renders the SSR header.
    if (timer.current) clearTimeout(timer.current);
    token.current = null;
    window.location.assign('/');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, setSession: apply, setUser: setUserState, request, logout }),
    [status, user, apply, request, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Client guard for account pages: bounces anonymous users to sign-in with a return-to. */
export function RequireAuth({ children, returnTo }: { children: ReactNode; returnTo: string }) {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'anonymous') router.replace(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
  }, [status, router, returnTo]);
  if (status !== 'authenticated') {
    return <p className="p-8 text-center text-slate-500">Loading your account…</p>;
  }
  return <>{children}</>;
}
