'use client';

import type { AuthResponse } from '@shopsphere/types';
import { Button, SectionCard } from '@shopsphere/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/field';
import { api, ApiCallError, setToken } from '@/lib/api';
import { useAdmin } from '@/lib/admin-context';

/** Staff sign in with email + password (identity module); /admin/me then checks staff roles. */
function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAdmin();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        json: { identifier, password, keepSignedIn: false },
      });
      if (res.status !== 'authenticated') {
        setError('This account needs a second factor; use an admin account without 2FA here.');
        return;
      }
      setToken(res.accessToken);
      try {
        await api('/admin/me');
      } catch {
        setToken(null);
        setError('This account has no staff access.');
        return;
      }
      await refresh();
      const back = params.get('returnTo');
      router.replace(back && back.startsWith('/') && !back.startsWith('//') ? back : '/');
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm">
      <SectionCard title="Staff sign in">
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </SectionCard>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
