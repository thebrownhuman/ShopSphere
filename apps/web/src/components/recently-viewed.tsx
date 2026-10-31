'use client';

import { useEffect, useState } from 'react';
import type { ProductSummary } from '@/lib/api/catalog.types';
import { readRecentlyViewed } from '@/lib/recently-viewed';
import { ProductCarousel } from './home/product-carousel';

/** Recently viewed row; reads browser storage after mount, renders nothing when empty. */
export function RecentlyViewed({ title, excludeId }: { title: string; excludeId?: string }) {
  const [items, setItems] = useState<ProductSummary[]>([]);
  useEffect(() => setItems(readRecentlyViewed().filter((p) => p.id !== excludeId)), [excludeId]);
  return <ProductCarousel title={title} items={items} />;
}
