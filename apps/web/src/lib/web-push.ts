'use client';

import type { Requester } from './api/checkout';
import { pushApi } from './api/returns';

/** Browser support for web push (M6.9): service worker + Push API + Notification. */
export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks permission, subscribes this browser with the API's VAPID key and registers it. */
export async function enablePush(
  request: Requester,
): Promise<'enabled' | 'denied' | 'unavailable'> {
  if (!pushSupported()) return 'unavailable';
  const api = pushApi(request);
  const { publicKey } = await api.key();
  if (!publicKey) return 'unavailable';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.subscribe({ endpoint: json.endpoint, keys: json.keys });
  return 'enabled';
}

export async function disablePush(request: Requester): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await pushApi(request).unsubscribe(sub.endpoint);
  await sub.unsubscribe();
}
