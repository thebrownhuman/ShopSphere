'use client';

import type { AuthUser, OtpRequestResponse, SessionInfo } from '@shopsphere/types';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, ErrorBanner, Field, StrengthMeter, errorMessage } from '@/components/form';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Editing = null | 'name' | 'email' | 'phone' | 'password' | 'totp';

function Row({ label, value, action }: { label: string; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-4 last:border-0">
      <div>
        <p className="font-semibold">{label}</p>
        <div className="text-sm text-slate-600">{value}</div>
      </div>
      {action}
    </div>
  );
}

/** Login & Security: profile, contacts, password, 2FA, devices. Sensitive changes need step-up. */
export default function SecurityPage() {
  const { user, setUser, request, logout } = useAuth();
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  // Step-up: a pending action is retried after the user re-authenticates.
  const pending = useRef<(() => Promise<void>) | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setSessions((await request<SessionInfo[]>('/me/sessions')) ?? []);
    } catch {
      setSessions([]);
    }
  }, [request]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'REAUTH_REQUIRED') {
        pending.current = fn;
        setReauthOpen(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;
  const close = () => setEditing(null);

  return (
    <>
      <nav className="mb-2 text-sm">
        <Link href="/account" className="text-brand hover:underline">
          Your Account
        </Link>{' '}
        › Login &amp; Security
      </nav>
      <h1 className="mb-4 text-2xl font-bold">Login &amp; Security</h1>
      <ErrorBanner error={error} />
      {notice && (
        <div
          role="status"
          className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {notice}
        </div>
      )}

      {reauthOpen && (
        <ReauthPanel
          user={user}
          onCancel={() => setReauthOpen(false)}
          onDone={() => {
            setReauthOpen(false);
            const retry = pending.current;
            pending.current = null;
            if (retry) void run(retry);
          }}
        />
      )}

      <section className="mb-6 rounded-lg border border-slate-200 bg-white">
        <Row
          label="Name"
          value={editing === 'name' ? null : user.name}
          action={
            editing !== 'name' && (
              <Button variant="secondary" onClick={() => setEditing('name')}>
                Edit
              </Button>
            )
          }
        />
        {editing === 'name' && (
          <NameForm
            initial={user.name ?? ''}
            busy={busy}
            onCancel={close}
            onSave={(name) =>
              run(async () => {
                setUser(await request<AuthUser>('/me', { method: 'PATCH', body: { name } }));
                close();
                setNotice('Name updated.');
              })
            }
          />
        )}
        <Row
          label="Email"
          value={user.email ?? 'Not added'}
          action={
            editing !== 'email' && (
              <Button variant="secondary" onClick={() => setEditing('email')}>
                {user.email ? 'Edit' : 'Add'}
              </Button>
            )
          }
        />
        {editing === 'email' && (
          <ChangeIdentifier
            kind="email"
            busy={busy}
            run={run}
            onCancel={close}
            onDone={(u) => {
              setUser(u);
              close();
              setNotice('Email updated. We notified your previous address.');
            }}
          />
        )}
        <Row
          label="Mobile number"
          value={user.phone ?? 'Not added'}
          action={
            editing !== 'phone' && (
              <Button variant="secondary" onClick={() => setEditing('phone')}>
                {user.phone ? 'Edit' : 'Add'}
              </Button>
            )
          }
        />
        {editing === 'phone' && (
          <ChangeIdentifier
            kind="phone"
            busy={busy}
            run={run}
            onCancel={close}
            onDone={(u) => {
              setUser(u);
              close();
              setNotice('Mobile number updated. We notified your previous number.');
            }}
          />
        )}
        <Row
          label="Password"
          value={user.hasPassword ? '••••••••' : 'Not set (you sign in with OTP)'}
          action={
            editing !== 'password' && (
              <Button variant="secondary" onClick={() => setEditing('password')}>
                {user.hasPassword ? 'Change' : 'Set'}
              </Button>
            )
          }
        />
        {editing === 'password' && (
          <PasswordForm
            busy={busy}
            onCancel={close}
            onSave={(newPassword) =>
              run(async () => {
                await request('/me/password', { method: 'POST', body: { newPassword } });
                setUser({ ...user, hasPassword: true });
                close();
                setNotice('Password saved. Other devices were signed out.');
                await loadSessions();
              })
            }
          />
        )}
        <Row
          label="Two-step verification (authenticator app)"
          value={user.totpEnabled ? 'On' : 'Off'}
          action={
            user.totpEnabled ? (
              <Button
                variant="danger"
                busy={busy}
                onClick={() =>
                  run(async () => {
                    setUser(await request<AuthUser>('/me/totp/disable', { method: 'POST' }));
                    setNotice('Two-step verification turned off.');
                  })
                }
              >
                Turn off
              </Button>
            ) : (
              editing !== 'totp' && (
                <Button variant="secondary" onClick={() => setEditing('totp')}>
                  Turn on
                </Button>
              )
            )
          }
        />
        {editing === 'totp' && (
          <TotpSetup
            busy={busy}
            run={run}
            onCancel={close}
            onDone={(u) => {
              setUser(u);
              close();
              setNotice('Two-step verification is on.');
            }}
          />
        )}
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold">
          Where you are signed in
        </h2>
        <ul>
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 last:border-0"
            >
              <div className="text-sm">
                <p className="font-medium">
                  {s.userAgent?.slice(0, 80) ?? 'Unknown device'}{' '}
                  {s.current && (
                    <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-slate-500">
                  Last active {new Date(s.lastUsedAt).toLocaleString()} · {s.ip ?? 'unknown IP'}
                </p>
              </div>
              {!s.current && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    run(async () => {
                      await request(`/me/sessions/${s.id}`, { method: 'DELETE' });
                      await loadSessions();
                    })
                  }
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="px-4 py-3">
          <Button variant="danger" onClick={() => void logout(true)}>
            Sign out of all devices
          </Button>
        </div>
      </section>
    </>
  );
}

function NameForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (n: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="border-b border-slate-100 px-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(name);
      }}
    >
      <Field
        id="edit-name"
        label="Full name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" busy={busy} disabled={!name.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (p: string) => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState('');
  return (
    <form
      className="border-b border-slate-100 px-4 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(pw);
      }}
    >
      <Field
        id="edit-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        autoFocus
      />
      <StrengthMeter password={pw} />
      <div className="flex gap-2">
        <Button type="submit" busy={busy} disabled={pw.length < 8}>
          Save password
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type Runner = (fn: () => Promise<void>) => Promise<void>;

/** M1.13: step-up (via runner), OTP to the new value, then swap. */
function ChangeIdentifier({
  kind,
  busy,
  run,
  onDone,
  onCancel,
}: {
  kind: 'email' | 'phone';
  busy: boolean;
  run: Runner;
  onDone: (u: AuthUser) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (!sent) {
        await request<OtpRequestResponse>('/me/identifier/change/request', {
          method: 'POST',
          body: { identifier: value },
        });
        setSent(true);
      } else {
        onDone(
          await request<AuthUser>('/me/identifier/change/confirm', {
            method: 'POST',
            body: { identifier: value, code },
          }),
        );
      }
    });
  };
  return (
    <form className="border-b border-slate-100 px-4 pb-4" onSubmit={submit}>
      <Field
        id={`new-${kind}`}
        label={kind === 'email' ? 'New email' : 'New mobile number'}
        inputMode={kind === 'email' ? 'email' : 'tel'}
        value={value}
        disabled={sent}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      {sent && (
        <Field
          id={`${kind}-otp`}
          label={`Code sent to ${value}`}
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
        />
      )}
      <div className="flex gap-2">
        <Button type="submit" busy={busy}>
          {sent ? 'Verify and save' : 'Send code'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function TotpSetup({
  busy,
  run,
  onDone,
  onCancel,
}: {
  busy: boolean;
  run: Runner;
  onDone: (u: AuthUser) => void;
  onCancel: () => void;
}) {
  const { request } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  return (
    <div className="border-b border-slate-100 px-4 pb-4">
      {!setup ? (
        <div className="flex gap-2">
          <Button
            busy={busy}
            onClick={() =>
              void run(async () => setSetup(await request('/me/totp/setup', { method: 'POST' })))
            }
          >
            Generate secret
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () =>
              onDone(
                await request<AuthUser>('/me/totp/enable', { method: 'POST', body: { code } }),
              ),
            );
          }}
        >
          <p className="mb-2 text-sm">
            Add this key to your authenticator app (Google Authenticator, Authy…):
          </p>
          <code
            className="mb-4 block break-all rounded bg-slate-100 p-2 text-sm"
            data-testid="totp-secret"
          >
            {setup.secret}
          </code>
          <Field
            id="totp-code"
            label="Code from the app"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="flex gap-2">
            <Button type="submit" busy={busy}>
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ReauthPanel({
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
