'use client';

import { SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useAdmin } from '@/lib/admin-context';

const TILES = [
  { href: '/users', title: 'Users', text: 'Find customers, suspend accounts, grant staff roles.' },
  { href: '/sellers', title: 'Sellers', text: 'KYC approval queue and seller suspension.' },
  { href: '/catalog', title: 'Catalog moderation', text: 'Block or restore product listings.' },
  { href: '/orders', title: 'Orders', text: 'Order lookup, payments and manual refunds.' },
  { href: '/promotions', title: 'Promotions', text: 'Coupons, lightning deals, bank offers.' },
  { href: '/home-cms', title: 'Home page', text: 'Order sections, schedule banners, preview.' },
  { href: '/audit', title: 'Audit log', text: 'Every admin action, who did it and when.' },
];

export default function Dashboard() {
  const { me } = useAdmin();
  return (
    <SectionCard title={`Welcome${me?.name ? `, ${me.name}` : ''}`}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <li key={t.href}>
            <Link href={t.href} className="block rounded border p-4 hover:border-brand">
              <span className="font-semibold">{t.title}</span>
              <span className="mt-1 block text-sm text-slate-600">{t.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
