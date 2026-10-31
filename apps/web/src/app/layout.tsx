import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ShopSphere',
  description: 'ShopSphere: simulated multi-vendor marketplace',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="bg-brand px-4 py-3 text-white">
          <span className="text-lg font-bold">ShopSphere</span>
        </header>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
