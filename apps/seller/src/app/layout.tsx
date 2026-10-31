import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SellerProvider } from '@/lib/seller-context';
import { Shell } from './shell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Seller Central', template: '%s | ShopSphere Seller Central' },
  robots: { index: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <SellerProvider>
          <Shell>{children}</Shell>
        </SellerProvider>
      </body>
    </html>
  );
}
