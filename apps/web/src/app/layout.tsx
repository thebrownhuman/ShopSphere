import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { CheckoutHeader, ChromeGate } from '@/components/checkout/chrome';
import { CookieConsent } from '@/components/cookie-consent';
import { SiteHeader } from '@/components/header/site-header';
import { SiteFooter } from '@/components/site-footer';
import { getCategories } from '@/lib/api/catalog';
import { SITE_URL } from '@/lib/site';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'ShopSphere: Online Shopping for Electronics, Fashion & More',
    template: '%s | ShopSphere',
  },
  description:
    'Shop mobiles, electronics, fashion, home and grocery with fast delivery from ShopSphere warehouses and trusted sellers.',
  openGraph: { siteName: 'ShopSphere', type: 'website', locale: 'en_IN' },
};

export const viewport: Viewport = { themeColor: '#172337', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // No cookies() here: the layout must stay static so home/category/PDP can be ISR-cached.
  const categories = await getCategories().catch(() => []);
  return (
    <html lang="en-IN">
      <body id="top" className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <Providers>
          <ChromeGate checkout={<CheckoutHeader />}>
            <SiteHeader categories={categories} />
          </ChromeGate>
          <CookieConsent />
          <div id="main" tabIndex={-1} className="outline-none">
            {children}
          </div>
          <ChromeGate>
            <SiteFooter />
          </ChromeGate>
        </Providers>
      </body>
    </html>
  );
}
