/** Rating aggregate math (M6.2). Pure so the job, the stats endpoint and tests agree. */

export type Histogram = [number, number, number, number, number];

export interface RatingAggregate {
  /** Average x10, rounded half up (4.25 → 43). 0 with no reviews. */
  ratingX10: number;
  count: number;
}

export function emptyHistogram(): Histogram {
  return [0, 0, 0, 0, 0];
}

/** Builds a histogram (index 0 = 1 star) from `{rating, count}` group rows; ignores bad stars. */
export function toHistogram(rows: { rating: number; count: number }[]): Histogram {
  const h = emptyHistogram();
  for (const r of rows) {
    if (Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5) h[r.rating - 1] += r.count;
  }
  return h;
}

/** Integer math only: round(sum * 10 / count) without float drift. */
export function aggregate(h: Histogram): RatingAggregate {
  const count = h.reduce((a, b) => a + b, 0);
  if (count === 0) return { ratingX10: 0, count: 0 };
  const sum = h.reduce((acc, n, i) => acc + n * (i + 1), 0);
  return { ratingX10: Math.floor((sum * 20 + count) / (2 * count)), count };
}
