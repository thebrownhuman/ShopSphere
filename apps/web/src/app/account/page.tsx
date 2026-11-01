'use client';

import Link from 'next/link';
import { Button } from '@/components/form';
import { useAuth } from '@/lib/auth';

const TILES: { title: string; body: string; href?: string }[] = [
  { title: 'Your Orders', body: 'Track, return or buy things again' },
  {
    title: 'Login & Security',
    body: 'Name, email, mobile, password, 2FA, devices',
    href: '/account/security',
  },
  { title: 'Your Addresses', body: 'Edit delivery addresses', href: '/account/addresses' },
  { title: 'Payment options', body: 'Saved cards and UPI' },
  { title: 'Wishlists', body: 'Items you saved for later' },
  { title: 'ShopSphere Plus', body: 'Membership benefits' },
  { title: 'Gift card balance', body: 'Add or view gift cards' },
  {
    title: 'Notification preferences',
    body: 'Email, SMS, WhatsApp and browser',
    href: '/account/notifications',
  },
  {
    title: 'Privacy & data',
    body: 'Download your data or delete your account',
    href: '/account/privacy',
  },
  { title: 'Help & support', body: 'Help articles and your support tickets', href: '/help' },
];

/** "Your Account" hub. Tiles without a page yet arrive with their milestones. */
export default function AccountPage() {
  const { user, logout } = useAuth();
  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Your Account</h1>
          <p className="text-slate-600" data-testid="account-greeting">
            Hello, {user?.name ?? 'there'}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => {
          const inner = (
            <>
              <h2 className="font-semibold">{t.title}</h2>
              <p className="text-sm text-slate-600">{t.body}</p>
              {!t.href && <p className="mt-2 text-xs text-slate-400">Coming soon</p>}
            </>
          );
          return (
            <li key={t.title}>
              {t.href ? (
                <Link
                  href={t.href}
                  className="block h-full rounded-lg border border-slate-200 bg-white p-4 hover:border-brand hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  {inner}
                </Link>
              ) : (
                <div className="h-full rounded-lg border border-dashed border-slate-200 bg-white/60 p-4">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
