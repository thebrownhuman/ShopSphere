'use client';

import type { AuthResponse, IdentifyResponse, OtpRequestResponse } from '@shopsphere/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBanner, Field, StrengthMeter, errorMessage } from '@/components/form';
import { Turnstile } from '@/components/turnstile';
import { API_URL, ApiRequestError, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Step = 'identifier' | 'otp' | 'password' | 'name' | 'mfa' | 'reset';

function safeReturnTo(value: string | null): string {
  return value && /^\/(?!\/)[^\\\s]*$/.test(value) ? value : '/';
}

/** Identifier → OTP or password → name (new users) → optional 2FA, then back to returnTo. */
export function SignInFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const { setSession, status } = useAuth();
  const returnTo = safeReturnTo(params.get('returnTo'));

  const [step, setStep] = useState<Step>(params.get('mfa') ? 'mfa' : 'identifier');
  const [identifier, setIdentifier] = useState('');
  const [info, setInfo] = useState<IdentifyResponse | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [signupToken, setSignupToken] = useState('');
  const [mfaToken, setMfaToken] = useState(params.get('mfa') ?? '');
  const [captchaNeeded, setCaptchaNeeded] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string>();
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get('error') ? 'Google sign-in failed. Try another option.' : null,
  );
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && step === 'identifier') router.replace(returnTo);
  }, [status, step, router, returnTo]);

  useEffect(() => {
    apiRequest<{ enabled: boolean }>('/auth/google/status')
      .then((r) => setGoogleEnabled(r.enabled))
      .catch(() => setGoogleEnabled(false));
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const onCaptcha = useCallback((t: string) => setCaptchaToken(t), []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiRequestError) {
        const details = err.body?.details as { captchaRequired?: boolean } | undefined;
        if (err.code === 'CAPTCHA_REQUIRED' || details?.captchaRequired) setCaptchaNeeded(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function handle(res: AuthResponse) {
    if (res.status === 'authenticated') {
      setSession(res);
      router.replace(returnTo);
      router.refresh();
    } else if (res.status === 'signup_required') {
      setSignupToken(res.signupToken);
      setStep('name');
    } else {
      setMfaToken(res.mfaToken);
      setCode('');
      setStep('mfa');
    }
  }

  const sendOtp = () =>
    apiRequest<OtpRequestResponse>('/auth/otp/request', {
      method: 'POST',
      body: { identifier },
    }).then((r) => setResendIn(r.resendAfterSeconds));

  const submitIdentifier = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await apiRequest<IdentifyResponse>('/auth/identify', {
        method: 'POST',
        body: { identifier },
      });
      setInfo(res);
      if (res.exists && res.hasPassword) {
        setStep('password');
      } else {
        await sendOtp();
        setStep('otp');
      }
    });
  };

  const submitOtp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () =>
      handle(
        await apiRequest<AuthResponse>('/auth/otp/verify', {
          method: 'POST',
          body: { identifier, code, keepSignedIn },
        }),
      ),
    );
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () =>
      handle(
        await apiRequest<AuthResponse>('/auth/login', {
          method: 'POST',
          body: { identifier, password, keepSignedIn, captchaToken },
        }),
      ),
    );
  };

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    void run(async () =>
      handle(
        await apiRequest<AuthResponse>('/auth/signup', {
          method: 'POST',
          body: { signupToken, name, password: password || undefined },
        }),
      ),
    );
  };

  const submitMfa = (e: FormEvent) => {
    e.preventDefault();
    void run(async () =>
      handle(
        await apiRequest<AuthResponse>('/auth/mfa/verify', {
          method: 'POST',
          body: { mfaToken, code },
        }),
      ),
    );
  };

  const startReset = () =>
    run(async () => {
      const r = await apiRequest<OtpRequestResponse>('/auth/password/forgot', {
        method: 'POST',
        body: { identifier },
      });
      setResendIn(r.resendAfterSeconds);
      setCode('');
      setPassword('');
      setStep('reset');
    });

  const submitReset = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiRequest('/auth/password/reset', {
        method: 'POST',
        body: { identifier, code, newPassword: password },
      });
      setPassword('');
      setStep('password');
      setError(null);
      setInfo((i) => (i ? { ...i, hasPassword: true } : i));
    });
  };

  const isNew = info !== null && !info.exists;
  const heading: Record<Step, string> = {
    identifier: 'Sign in or create an account',
    otp: isNew ? 'Verify to create your account' : 'Enter the code we sent',
    password: 'Enter your password',
    name: 'Almost there',
    mfa: 'Two-step verification',
    reset: 'Reset your password',
  };

  const keepBox = (
    <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={keepSignedIn}
        onChange={(e) => setKeepSignedIn(e.target.checked)}
        className="h-4 w-4"
      />
      Keep me signed in for 30 days
    </label>
  );

  const editIdentifier = (
    <p className="mb-4 text-sm text-slate-600">
      {identifier}{' '}
      <button
        type="button"
        className="text-brand hover:underline"
        onClick={() => setStep('identifier')}
      >
        Change
      </button>
    </p>
  );

  return (
    <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-xl font-bold">{heading[step]}</h1>
      <p className="mb-5 text-sm text-slate-500">
        {step === 'identifier' && 'Use your mobile number or email.'}
        {step === 'otp' && 'It is valid for 5 minutes.'}
        {step === 'name' && 'Tell us your name to finish creating your account.'}
        {step === 'mfa' && 'Enter the 6-digit code from your authenticator app.'}
        {step === 'reset' && 'Enter the code we sent and choose a new password.'}
      </p>
      <ErrorBanner error={error} />

      {step === 'identifier' && (
        <form onSubmit={submitIdentifier} noValidate>
          <Field
            id="identifier"
            label="Mobile number or email"
            autoComplete="username"
            inputMode="email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            autoFocus
          />
          <Button type="submit" busy={busy} className="w-full">
            Continue
          </Button>
          {googleEnabled && (
            <>
              <div className="my-4 text-center text-xs uppercase text-slate-400">or</div>
              <a
                href={`${API_URL}/auth/google?returnTo=${encodeURIComponent(returnTo)}`}
                className="flex min-h-11 w-full items-center justify-center rounded border border-slate-300 font-semibold hover:bg-slate-50"
              >
                Continue with Google
              </a>
            </>
          )}
          <p className="mt-4 text-xs text-slate-500">
            By continuing you agree to ShopSphere&apos;s Terms of Use and Privacy Notice
            (simulation).
          </p>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={submitOtp} noValidate>
          {editIdentifier}
          <Field
            id="otp"
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
          />
          {keepBox}
          <Button type="submit" busy={busy} className="w-full">
            {isNew ? 'Verify and continue' : 'Sign in'}
          </Button>
          <div className="mt-3 flex justify-between text-sm">
            <button
              type="button"
              disabled={resendIn > 0 || busy}
              className="text-brand hover:underline disabled:text-slate-400 disabled:no-underline"
              onClick={() => void run(sendOtp)}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
            </button>
            {info?.hasPassword && (
              <button
                type="button"
                className="text-brand hover:underline"
                onClick={() => setStep('password')}
              >
                Use password
              </button>
            )}
          </div>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={submitPassword} noValidate>
          {editIdentifier}
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
          {captchaNeeded && <Turnstile onToken={onCaptcha} />}
          {keepBox}
          <Button
            type="submit"
            busy={busy}
            className="w-full"
            disabled={captchaNeeded && !captchaToken}
          >
            Sign in
          </Button>
          <div className="mt-3 flex justify-between text-sm">
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() =>
                void run(async () => {
                  await sendOtp();
                  setCode('');
                  setStep('otp');
                })
              }
            >
              Get an OTP instead
            </button>
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => void startReset()}
            >
              Forgot password?
            </button>
          </div>
        </form>
      )}

      {step === 'name' && (
        <form onSubmit={submitName} noValidate>
          <Field
            id="name"
            label="Full name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <Field
            id="new-password"
            label="Password (optional)"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="At least 8 characters. Skip to sign in with OTP only."
            error={password && password.length < 8 ? 'Use at least 8 characters' : undefined}
          />
          {password && <StrengthMeter password={password} />}
          <Button
            type="submit"
            busy={busy}
            className="w-full"
            disabled={!name.trim() || (password.length > 0 && password.length < 8)}
          >
            Create account
          </Button>
        </form>
      )}

      {step === 'mfa' && (
        <form onSubmit={submitMfa} noValidate>
          <Field
            id="totp"
            label="Authenticator code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
          />
          <Button type="submit" busy={busy} className="w-full">
            Verify
          </Button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={submitReset} noValidate>
          {editIdentifier}
          <Field
            id="reset-otp"
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Field
            id="reset-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <StrengthMeter password={password} />
          <p className="mb-4 text-xs text-slate-500">
            You will be signed out of all other devices.
          </p>
          <Button type="submit" busy={busy} className="w-full" disabled={password.length < 8}>
            Reset password
          </Button>
        </form>
      )}
    </div>
  );
}
