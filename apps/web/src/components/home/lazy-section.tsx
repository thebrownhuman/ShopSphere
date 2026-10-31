'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ProductTileSkeleton } from '../product-tile';

/** Mounts below-the-fold rows when they approach the viewport; skeleton until then (PRD §4). */
export function LazySection({
  children,
  minHeight = 340,
}: {
  children: ReactNode;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (visible) return <>{children}</>;
  return (
    <div ref={ref} style={{ minHeight }} className="bg-white p-4" aria-busy="true">
      <span className="mb-4 block h-6 w-56 animate-pulse rounded bg-slate-200" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="w-40 shrink-0 sm:w-48">
            <ProductTileSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
