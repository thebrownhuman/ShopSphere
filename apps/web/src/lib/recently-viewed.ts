import type { ProductSummary } from './api/catalog.types';

/** Guest recently-viewed list (PRD §4: last 20). Server-side history for signed-in users comes later. */
const KEY = 'ss_recently_viewed';
const MAX = 20;

export function readRecentlyViewed(): ProductSummary[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProductSummary[]) : [];
  } catch {
    return [];
  }
}

export function recordView(item: ProductSummary): void {
  try {
    const next = [item, ...readRecentlyViewed().filter((p) => p.id !== item.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: recently viewed is best-effort.
  }
}
