'use client';

import { Button } from '@shopsphere/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { pushApi } from '@/lib/api/returns';
import { useAuth } from '@/lib/auth';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/web-push';

type Channel = 'email' | 'sms' | 'whatsapp' | 'push';
type Category = 'ORDER_UPDATES' | 'PAYMENT_ALERTS';
type Prefs = Record<Category, Record<Channel, boolean>>;

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'push', label: 'Browser' },
];
const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'ORDER_UPDATES', label: 'Order updates' },
  { key: 'PAYMENT_ALERTS', label: 'Payment alerts' },
];

/** Account → Notifications (M4.31 preferences + M6.9 WhatsApp and web push). */
export default function NotificationsPage() {
  const { request } = useAuth();
  const qc = useQueryClient();
  const { data: prefs } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: () => request<Prefs>('/account/notification-preferences'),
  });
  const [push, setPush] = useState<'on' | 'off' | 'unsupported' | 'loading'>('loading');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) return setPush('unsupported');
    void currentSubscription().then((s) => setPush(s ? 'on' : 'off'));
  }, []);

  const toggle = async (c: Category, ch: Channel, value: boolean) => {
    const next = await request<Prefs>('/account/notification-preferences', {
      method: 'PUT',
      body: { [c]: { [ch]: value } },
    });
    qc.setQueryData(['notification-prefs'], next);
  };

  const enable = async () => {
    setNote(null);
    const r = await enablePush(request).catch(() => 'unavailable' as const);
    if (r === 'enabled') {
      setPush('on');
      const { delivered } = await pushApi(request).test();
      setNote(delivered ? 'Test notification sent.' : 'Subscribed.');
    } else {
      setNote(
        r === 'denied'
          ? 'Notifications are blocked for this site in your browser settings.'
          : 'Browser notifications are not available right now.',
      );
    }
  };

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Notifications</h1>
      <section className="mb-6 rounded bg-white p-4">
        <h2 className="mb-3 font-bold">How we reach you</h2>
        {prefs ? (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left font-normal text-slate-600" />
                {CHANNELS.map((ch) => (
                  <th key={ch.key} className="px-2 font-normal text-slate-600">
                    {ch.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((c) => (
                <tr key={c.key}>
                  <th className="py-2 text-left font-medium">{c.label}</th>
                  {CHANNELS.map((ch) => (
                    <td key={ch.key} className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`${c.label} by ${ch.label}`}
                        checked={prefs[c.key][ch.key]}
                        onChange={(e) => void toggle(c.key, ch.key, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-600">Loading…</p>
        )}
        <p className="mt-3 text-xs text-slate-600">
          WhatsApp messages go to your verified mobile number. Order confirmations and refunds are
          always emailed as receipts.
        </p>
      </section>
      <section className="rounded bg-white p-4">
        <h2 className="mb-2 font-bold">Browser notifications</h2>
        {push === 'unsupported' ? (
          <p className="text-sm">This browser does not support notifications.</p>
        ) : push === 'on' ? (
          <div className="flex items-center gap-3 text-sm">
            <span>On for this browser.</span>
            <Button
              variant="ghost"
              onClick={() => void disablePush(request).then(() => setPush('off'))}
            >
              Turn off
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => void enable()} disabled={push === 'loading'}>
            Turn on browser notifications
          </Button>
        )}
        {note && (
          <p role="status" className="mt-2 text-sm text-slate-700">
            {note}
          </p>
        )}
      </section>
    </>
  );
}
