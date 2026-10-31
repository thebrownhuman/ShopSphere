'use client';

import type { AuthResponse } from '@shopsphere/types';
import { Button, SectionCard } from '@shopsphere/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/field';
import { api, ApiCallError, setToken } from '@/lib/api';
import { useSeller } from '@/lib/seller-context';

type Step = 'identify' | 'otp' | 'signup';

/** Sign in or create an account with an email/phone OTP (identity module, M1). */
function SignIn() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useSeller();
  const [step, setStep] = useState<Step>('identify');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [signupToken, setSignupToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function done(res: AuthResponse) {
    if (res.status === 'authenticated') {
      setToken(res.accessToken);
      await refresh();
      const back = params.get('returnTo');
      router.replace(back && back.startsWith('/') && !back.startsWith('//') ? back : '/');
    } else if (res.status === 'signup_required') {
      setSignupToken(res.signupToken);
      setStep('signup');
    } else {
      setError('Two-factor accounts must sign in on the storefront first.');
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (step === 'identify') {
        await api('/auth/otp/request', { method: 'POST', json: { identifier } });
        setStep('otp');
      } else if (step === 'otp') {
        await done(
          await api<AuthResponse>('/auth/otp/verify', {
            method: 'POST',
            json: { identifier, code, keepSignedIn: true },
          }),
        );
      } else {
        await done(
          await api<AuthResponse>('/auth/signup', { method: 'POST', json: { signupToken, name } }),
        );
      }
    });
  };

  return (
    <div className="mx-auto max-w-md">
      <SectionCard title="Sell on ShopSphere">
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-slate-600">
            Sign in with your ShopSphere account, or create one. We&apos;ll send you a one-time
            code.
          </p>
          <Field
            label="Mobile number or email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={step !== 'identify'}
            autoComplete="username"
            required
          />
          {step === 'otp' && (
            <Field
              label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          )}
          {step === 'signup' && (
            <Field
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          {error && <Alert>{error}</Alert>}
          <Button type="submit" block disabled={busy}>
            {step === 'identify' ? 'Send code' : step === 'otp' ? 'Verify' : 'Create account'}
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
