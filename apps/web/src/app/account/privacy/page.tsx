'use client';

import type { PrivacyExport, PrivacyOverview } from '@shopsphere/types';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReauthPanel } from '@/components/account/reauth-panel';
import { Button, ErrorBanner, errorMessage } from '@/components/form';
import { ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

/** Privacy & data (M7.3): DPDP data export and account deletion. */
export default function PrivacyDataPage() {
  const { user, request, logout } = useAuth();
  const [data, setData] = useState<PrivacyOverview | null>(null);
  const [download, setDownload] = useState<PrivacyExport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const pending = useRef<(() => Promise<void>) | null>(null);

  const load = useCallback(async () => {
    const o = await request<PrivacyOverview>('/me/privacy');
    setData(o);
    if (o.export?.status === 'READY') setDownload(await request<PrivacyExport>('/me/export'));
    return o;
  }, [request]);

  useEffect(() => {
    void load().catch((e) => setError(errorMessage(e)));
  }, [load]);

  // Poll while the archive is being built.
  useEffect(() => {
    if (data?.export?.status !== 'PENDING') return;
    const t = setInterval(() => void load().catch(() => undefined), 3000);
    return () => clearInterval(t);
  }, [data?.export?.status, load]);

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
  const exp = data?.export;
  const deletion = data?.deletion;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-2 text-sm">
        <Link href="/account" className="text-brand-dark underline">
          Your Account
        </Link>{' '}
        › Privacy &amp; data
      </nav>
      <h1 className="mb-4 text-2xl font-bold">Privacy &amp; data</h1>
      <ErrorBanner error={error} />
      <div role="status" aria-live="polite">
        {notice && (
          <p className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            {notice}
          </p>
        )}
      </div>

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

      <section
        aria-labelledby="export-h"
        className="mb-6 rounded-lg border border-slate-200 bg-white p-4"
      >
        <h2 id="export-h" className="text-lg font-semibold">
          Download your data
        </h2>
        <p className="mt-1 text-sm text-slate-700">
          Get a copy of your profile, addresses, orders, returns, reviews, support tickets and
          sign-in history as JSON files in a zip archive. We email you when it is ready; the link on
          this page works for 7 days.
        </p>
        <div className="mt-3" data-testid="export-status">
          {exp?.status === 'PENDING' && <p className="text-sm">Preparing your archive…</p>}
          {exp?.status === 'FAILED' && (
            <p className="text-sm text-red-700">The last export failed. Please try again.</p>
          )}
          {download?.downloadUrl && (
            <p className="text-sm">
              Archive from {fmt(download.requestedAt)} is ready:{' '}
              <a href={download.downloadUrl} className="font-semibold text-brand-dark underline">
                Download zip
              </a>{' '}
              (available until {fmt(download.expiresAt!)})
            </p>
          )}
        </div>
        <Button
          className="mt-3"
          busy={busy}
          disabled={exp?.status === 'PENDING'}
          data-testid="request-export"
          onClick={() =>
            void run(async () => {
              await request('/me/export', { method: 'POST' });
              setNotice('We are preparing your data. We will email you when it is ready.');
              await load();
            })
          }
        >
          Request my data
        </Button>
      </section>

      <section aria-labelledby="delete-h" className="rounded-lg border border-red-200 bg-white p-4">
        <h2 id="delete-h" className="text-lg font-semibold">
          Delete your account
        </h2>
        {deletion ? (
          <>
            <p className="mt-1 text-sm" data-testid="deletion-scheduled">
              Your account will be deleted on <b>{fmt(deletion.scheduledFor)}</b>. You can cancel
              until then.
            </p>
            <Button
              className="mt-3"
              variant="secondary"
              busy={busy}
              data-testid="cancel-deletion"
              onClick={() =>
                void run(async () => {
                  await request('/me/delete-account', { method: 'DELETE' });
                  setNotice('Account deletion cancelled.');
                  await load();
                })
              }
            >
              Keep my account
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-700">
              We sign you out on every other device now and erase your personal data after{' '}
              {data?.graceDays ?? 14} days. Orders and invoices are kept, anonymised, because GST
              law requires them. Store balance left in your account is forfeited. Download your data
              first if you want a copy.
            </p>
            {confirming ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  busy={busy}
                  data-testid="confirm-deletion"
                  onClick={() =>
                    void run(async () => {
                      await request('/me/delete-account', { method: 'POST' });
                      setConfirming(false);
                      setNotice('Account deletion scheduled. We have emailed you the details.');
                      await load();
                    })
                  }
                >
                  Yes, delete my account
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                className="mt-3"
                variant="danger"
                data-testid="delete-account"
                onClick={() => setConfirming(true)}
              >
                Delete account
              </Button>
            )}
          </>
        )}
        <p className="mt-4 text-sm">
          <button type="button" className="text-brand-dark underline" onClick={() => void logout()}>
            Sign out
          </button>
        </p>
      </section>
    </>
  );
}
