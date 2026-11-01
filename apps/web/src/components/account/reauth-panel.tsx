'use client';

import type { AuthUser } from '@shopsphere/types';
import { useState } from 'react';
import { Button, ErrorBanner, Field, errorMessage } from '@/components/form';
import { useAuth } from '@/lib/auth';

/** Step-up re-auth (password, one-time code or authenticator) before a sensitive change. */
export function ReauthPanel({
  user,
  onDone,
  onCancel,
}: {
  user: AuthUser;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [mode, setMode] = useState<'password' | 'otp' | 'totp'>(
    user.hasPassword ? 'password' : 'otp',
  );
  const [value, setValue] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      role="dialog"
      aria-labelledby="reauth-title"
      className="mb-6 rounded-lg border-2 border-brand bg-white p-4"
    >
      <h2 id="reauth-title" className="mb-1 font-semibold">
        Confirm it&apos;s you
      </h2>
      <p className="mb-3 text-sm text-slate-600">
        For your security, re-enter your credentials to make this change.
      </p>
      <ErrorBanner error={error} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void go(async () => {
            await request('/me/reauth', { method: 'POST', body: { [mode]: value } });
            onDone();
          });
        }}
      >
        {mode === 'otp' && !sentTo ? (
          <Button
            type="button"
            busy={busy}
            onClick={() =>
              void go(async () =>
                setSentTo(
                  (await request<{ sentTo: string }>('/me/reauth/otp', { method: 'POST' })).sentTo,
                ),
              )
            }
          >
            Send me a code
          </Button>
        ) : (
          <Field
            id="reauth-value"
            label={
              mode === 'password'
                ? 'Password'
                : mode === 'totp'
                  ? 'Authenticator code'
                  : `Code sent to ${sentTo}`
            }
            type={mode === 'password' ? 'password' : 'text'}
            inputMode={mode === 'password' ? undefined : 'numeric'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {(mode !== 'otp' || sentTo) && (
            <Button type="submit" busy={busy}>
              Confirm
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {mode !== 'otp' && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode('otp');
                setValue('');
              }}
            >
              Use a one-time code
            </Button>
          )}
          {mode !== 'totp' && user.totpEnabled && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setMode('totp');
                setValue('');
              }}
            >
              Use authenticator
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
