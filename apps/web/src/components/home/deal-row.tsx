'use client';

import { ProgressBar } from '@shopsphere/ui';
import { useEffect, useState } from 'react';
import type { DealItem } from '@/lib/api/catalog.types';
import { clock } from '@/lib/delivery';
import { ProductCarousel } from './product-carousel';

function Countdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt);
  // Rendered only after mount so SSR and hydration never disagree on the time.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-sm font-normal text-slate-700">
      Ends in{' '}
      <span className="font-mono font-semibold text-deal" role="timer" aria-live="off">
        {now ? clock(end, now) : '--:--:--'}
      </span>
    </span>
  );
}

/** Today's Deals with countdown and "% claimed" bars (PRD §4). */
export function DealRow({
  title,
  endsAt,
  href,
  items,
}: {
  title: string;
  endsAt: string;
  href: string;
  items: DealItem[];
}) {
  const claimed = new Map(items.map((d) => [d.id, d.claimedPercent]));
  return (
    <ProductCarousel
      title={title}
      href={href}
      items={items}
      extra={<Countdown endsAt={endsAt} />}
      renderBelow={(p) => {
        const c = claimed.get(p.id) ?? 0;
        return (
          <div className="mt-1">
            <ProgressBar value={c} label={`${c}% claimed`} />
            <p className="mt-0.5 text-xs text-slate-700">{c}% claimed</p>
          </div>
        );
      }}
    />
  );
}
