import type { QuestionPage, ReviewPage, ReviewSort, ReviewStats } from '@shopsphere/types';
import { apiGet } from '../api';

/** Public review / Q&A reads (M6.2, M6.3). Signed-in calls go through `useAuth().request`. */
export interface ReviewFilters {
  stars: number[];
  withImages: boolean;
  verified: boolean;
  sort: ReviewSort;
}

export function getReviewStats(productId: string): Promise<ReviewStats> {
  return apiGet(`/products/${productId}/reviews/stats`);
}

export function getReviews(
  productId: string,
  f: ReviewFilters,
  cursor?: string | null,
): Promise<ReviewPage> {
  const qs = new URLSearchParams({ sort: f.sort, limit: '10' });
  if (f.stars.length) qs.set('stars', f.stars.join(','));
  if (f.withImages) qs.set('withImages', 'true');
  if (f.verified) qs.set('verified', 'true');
  if (cursor) qs.set('cursor', cursor);
  return apiGet(`/products/${productId}/reviews?${qs}`);
}

export function getQuestions(
  productId: string,
  q: string,
  cursor?: string | null,
): Promise<QuestionPage> {
  const qs = new URLSearchParams({ limit: '5' });
  if (q.trim()) qs.set('q', q.trim());
  if (cursor) qs.set('cursor', cursor);
  return apiGet(`/products/${productId}/questions?${qs}`);
}

/** Reads a File as bare base64 (no data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
