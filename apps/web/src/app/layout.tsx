import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSessionHint } from '@/lib/session-cookie';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ShopSphere',
  description: 'ShopSphere: simulated multi-vendor marketplace',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // SSR greeting from the signed session cookie; no API round-trip needed.
  const session = await getSessionHint();
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="bg-brand px-4 py-3 text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <Link href="/" className="text-lg font-bold">
              ShopSphere
            </Link>
            <Link
              href={session ? '/account' : '/signin'}
              className="rounded px-2 py-1 text-sm hover:bg-white/10"
              data-testid="account-link"
            >
              <span className="block text-xs opacity-80">
                Hello, {session ? (session.name ?? 'there') : 'Sign in'}
              </span>
              <span className="font-semibold">Account &amp; Lists</span>
            </Link>
          </div>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
