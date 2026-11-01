import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminProvider } from '@/lib/admin-context';
import { Shell } from './shell';
import './globals.css';

/** Per-request render: the nonce-based CSP (middleware.ts) needs a fresh nonce each time. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s | ShopSphere Admin' },
  robots: { index: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <AdminProvider>
          <Shell>{children}</Shell>
        </AdminProvider>
      </body>
    </html>
  );
}
