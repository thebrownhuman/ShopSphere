'use client';

import type {
  ReviewEligibility,
  ReviewMediaUploadResponse,
  ReviewSort,
  ReviewStats,
  ReviewView,
  ReviewVoteResponse,
} from '@shopsphere/types';
import { RatingStars, SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError } from '@/lib/api';
import { fileToBase64, getReviewStats, getReviews, type ReviewFilters } from '@/lib/api/reviews';
import { useAuth } from '@/lib/auth';

const SORTS: { value: ReviewSort; label: string }[] = [
  { value: 'helpful', label: 'Most helpful' },
  { value: 'recent', label: 'Most recent' },
  { value: 'rating_desc', label: 'Highest rating' },
  { value: 'rating_asc', label: 'Lowest rating' },
];

const DEFAULT_FILTERS: ReviewFilters = {
  stars: [],
  withImages: false,
  verified: false,
  sort: 'helpful',
};

/**
 * PDP reviews (M6.2/M6.4): histogram, AI summary, filters, sort, helpful votes, abuse reports and
 * the write-a-review form for verified buyers. Fetched live so a new review shows at once.
 */
export function ReviewsSection({ productId, slug }: { productId: string; slug: string }) {
  const { status, request } = useAuth();
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<ReviewView[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [elig, setElig] = useState<ReviewEligibility | null>(null);
  const [voted, setVoted] = useState<Set<string>>(new Set());
  const [writing, setWriting] = useState(false);

  const loadStats = useCallback(() => {
    getReviewStats(productId).then(setStats, () => setStats(null));
  }, [productId]);

  const loadPage = useCallback(
    (f: ReviewFilters) => {
      getReviews(productId, f).then(
        (p) => {
          setItems(p.items);
          setTotal(p.total);
          setCursor(p.nextCursor);
        },
        () => setItems([]),
      );
    },
    [productId],
  );

  useEffect(loadStats, [loadStats]);
  useEffect(() => loadPage(filters), [loadPage, filters]);
  useEffect(() => {
    if (status !== 'authenticated') return;
    request<ReviewEligibility>(`/products/${productId}/reviews/eligibility`).then(
      (e) => {
        setElig(e);
        setVoted(new Set(e.votedReviewIds));
      },
      () => setElig(null),
    );
  }, [status, request, productId]);

  async function more() {
    if (!cursor) return;
    const p = await getReviews(productId, filters, cursor);
    setItems((prev) => [...prev, ...p.items]);
    setCursor(p.nextCursor);
  }

  async function toggleVote(r: ReviewView) {
    const on = !voted.has(r.id);
    const res = await request<ReviewVoteResponse>(`/reviews/${r.id}/vote`, {
      method: on ? 'PUT' : 'DELETE',
    });
    setVoted((prev) => {
      const next = new Set(prev);
      if (on) next.add(r.id);
      else next.delete(r.id);
      return next;
    });
    setItems((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, helpfulCount: res.helpfulCount } : x)),
    );
  }

  const toggleStar = (s: number) =>
    setFilters((f) => ({
      ...f,
      stars: f.stars.includes(s) ? f.stars.filter((x) => x !== s) : [...f.stars, s].sort(),
    }));

  return (
    <SectionCard title="Customer reviews" headingId="reviews">
      <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Histogram stats={stats} onStar={toggleStar} selected={filters.stars} />
          <div className="border-t border-slate-200 pt-4 text-sm">
            <h3 className="font-bold">Review this product</h3>
            <p className="mt-1 text-slate-700">Share your thoughts with other customers.</p>
            {status !== 'authenticated' ? (
              <Link
                href={`/signin?returnTo=${encodeURIComponent(`/p/${slug}#reviews`)}`}
                className="mt-2 inline-block rounded-full border border-slate-300 px-4 py-1.5 hover:bg-slate-50"
              >
                Sign in to write a review
              </Link>
            ) : elig?.eligible ? (
              <button
                type="button"
                data-testid="write-review"
                className="mt-2 rounded-full border border-slate-300 px-4 py-1.5 hover:bg-slate-50"
                onClick={() => setWriting(true)}
              >
                Write a product review
              </button>
            ) : (
              <p className="mt-2 text-xs text-slate-600" data-testid="review-ineligible">
                {elig?.reason === 'ALREADY_REVIEWED'
                  ? 'Thanks — you have reviewed this product.'
                  : 'Only customers who received this product can review it.'}
              </p>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          {stats?.summary && <AiSummary summary={stats.summary} />}
          {writing && (
            <ReviewForm
              productId={productId}
              onCancel={() => setWriting(false)}
              onDone={() => {
                setWriting(false);
                setElig((e) => (e ? { ...e, eligible: false, reason: 'ALREADY_REVIEWED' } : e));
                loadStats();
                loadPage(filters);
              }}
            />
          )}
          <div
            className="flex flex-wrap items-center gap-2 text-sm"
            role="group"
            aria-label="Filter reviews"
          >
            {[5, 4, 3, 2, 1].map((s) => (
              <FilterChip key={s} on={filters.stars.includes(s)} onClick={() => toggleStar(s)}>
                {s} ★
              </FilterChip>
            ))}
            <FilterChip
              on={filters.withImages}
              onClick={() => setFilters((f) => ({ ...f, withImages: !f.withImages }))}
            >
              With photos
            </FilterChip>
            <FilterChip
              on={filters.verified}
              onClick={() => setFilters((f) => ({ ...f, verified: !f.verified }))}
            >
              Verified purchase
            </FilterChip>
            <label className="ml-auto flex items-center gap-2">
              <span className="text-slate-700">Sort by</span>
              <select
                className="rounded border border-slate-300 px-2 py-1"
                value={filters.sort}
                onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as ReviewSort }))}
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-600">
            {total} review{total === 1 ? '' : 's'}
          </p>
          <ul className="space-y-5">
            {items.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                voted={voted.has(r.id)}
                canAct={status === 'authenticated'}
                onVote={() => void toggleVote(r)}
                onReport={() =>
                  void request(`/reviews/${r.id}/report`, {
                    method: 'POST',
                    body: { reason: 'OTHER' },
                  })
                }
              />
            ))}
          </ul>
          {cursor && (
            <button
              type="button"
              className="text-sm text-brand-dark hover:underline"
              onClick={() => void more()}
            >
              See more reviews
            </button>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function FilterChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 ${on ? 'border-brand-dark bg-amber-50 font-semibold' : 'border-slate-300'}`}
    >
      {children}
    </button>
  );
}

function Histogram({
  stats,
  onStar,
  selected,
}: {
  stats: ReviewStats | null;
  onStar: (s: number) => void;
  selected: number[];
}) {
  if (!stats) return <p className="text-sm text-slate-600">Loading ratings…</p>;
  const max = Math.max(1, stats.ratingCount);
  return (
    <div>
      <div className="flex items-center gap-2">
        <RatingStars rating={stats.rating} size="md" />
        <span className="text-lg font-semibold" data-testid="review-rating">
          {stats.rating.toFixed(1)} out of 5
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-700" data-testid="review-count">
        {stats.ratingCount} global rating{stats.ratingCount === 1 ? '' : 's'}
      </p>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Rating breakdown</caption>
        <tbody>
          {[5, 4, 3, 2, 1].map((s) => {
            const n = stats.histogram[s - 1];
            const pct = Math.round((n / max) * 100);
            return (
              <tr key={s}>
                <th scope="row" className="w-14 py-1 text-left font-normal">
                  <button
                    type="button"
                    className={`hover:underline ${selected.includes(s) ? 'font-semibold' : ''}`}
                    onClick={() => onStar(s)}
                  >
                    {s} star
                  </button>
                </th>
                <td className="py-1">
                  <div className="h-4 rounded bg-slate-100" aria-hidden>
                    <div className="h-4 rounded bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                </td>
                <td className="w-10 py-1 text-right text-slate-700">{pct}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AiSummary({ summary }: { summary: NonNullable<ReviewStats['summary']> }) {
  return (
    <section
      aria-labelledby="ai-summary"
      className="rounded-lg bg-slate-50 p-4 text-sm"
      data-testid="ai-summary"
    >
      <h3 id="ai-summary" className="font-bold">
        Customers say
      </h3>
      <p className="mt-1 leading-relaxed">{summary.summary}</p>
      {summary.themes.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {summary.themes.map((t) => (
            <li
              key={t.label}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                t.sentiment === 'positive'
                  ? 'border-green-600 text-green-800'
                  : t.sentiment === 'negative'
                    ? 'border-red-600 text-red-800'
                    : 'border-slate-400 text-slate-700'
              }`}
            >
              {t.sentiment === 'positive' ? '✓ ' : t.sentiment === 'negative' ? '✕ ' : ''}
              {t.label} ({t.mentions})
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {summary.source === 'claude' ? 'AI-generated' : 'Auto-generated'} from the text of{' '}
        {summary.reviewCount} customer review{summary.reviewCount === 1 ? '' : 's'}.
      </p>
    </section>
  );
}

function ReviewCard({
  review: r,
  voted,
  canAct,
  onVote,
  onReport,
}: {
  review: ReviewView;
  voted: boolean;
  canAct: boolean;
  onVote: () => void;
  onReport: () => void;
}) {
  const [reported, setReported] = useState(false);
  return (
    <li className="text-sm" data-testid="review-card">
      <p className="font-medium">{r.authorName}</p>
      <div className="mt-1 flex items-center gap-2">
        <RatingStars rating={r.rating} />
        <span className="font-bold">{r.title}</span>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Reviewed on {new Date(r.createdAt).toLocaleDateString('en-IN', { dateStyle: 'long' })}
        {r.verifiedBuyer && (
          <span className="ml-2 font-semibold text-amber-700">Verified Purchase</span>
        )}
      </p>
      <p className="mt-2 whitespace-pre-line leading-relaxed">{r.body}</p>
      {r.images.length > 0 && (
        <div className="mt-2 flex gap-2">
          {r.images.map((img) => (
            <img
              key={img.id}
              src={img.url}
              alt="Customer photo"
              className="h-20 w-20 rounded object-cover"
            />
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-600">
        {r.helpfulCount > 0 &&
          `${r.helpfulCount} ${r.helpfulCount === 1 ? 'person' : 'people'} found this helpful`}
      </p>
      {canAct && (
        <div className="mt-1 flex gap-3 text-xs">
          <button
            type="button"
            aria-pressed={voted}
            onClick={onVote}
            className="rounded-full border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            {voted ? 'Helpful ✓' : 'Helpful'}
          </button>
          <button
            type="button"
            disabled={reported}
            onClick={() => {
              setReported(true);
              onReport();
            }}
            className="text-slate-600 hover:underline disabled:no-underline"
          >
            {reported ? 'Reported' : 'Report'}
          </button>
        </div>
      )}
    </li>
  );
}

function ReviewForm({
  productId,
  onCancel,
  onDone,
}: {
  productId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { request } = useAuth();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<ReviewMediaUploadResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files).slice(0, 5 - photos.length)) {
      try {
        const uploaded = await request<ReviewMediaUploadResponse>('/reviews/media', {
          method: 'POST',
          body: {
            fileName: file.name,
            contentType: file.type,
            dataBase64: await fileToBase64(file),
          },
        });
        setPhotos((p) => [...p, uploaded]);
      } catch (e) {
        setError(e instanceof ApiRequestError ? e.message : 'Photo upload failed');
      }
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rating === 0) return setError('Choose a star rating');
    setBusy(true);
    setError(null);
    try {
      await request(`/products/${productId}/reviews`, {
        method: 'POST',
        body: { rating, title, body, imageIds: photos.map((p) => p.id) },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not submit your review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Write a review"
      onSubmit={(e) => void submit(e)}
      className="space-y-3 rounded-lg border border-slate-200 p-4 text-sm"
    >
      <fieldset>
        <legend className="font-semibold">Overall rating</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <label key={s} className="cursor-pointer text-2xl">
              <input
                type="radio"
                name="rating"
                value={s}
                className="sr-only"
                checked={rating === s}
                onChange={() => setRating(s)}
                aria-label={`${s} star${s === 1 ? '' : 's'}`}
              />
              <span aria-hidden className={s <= rating ? 'text-amber-500' : 'text-slate-300'}>
                ★
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="font-semibold">Headline</span>
        <input
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          minLength={3}
          maxLength={120}
          required
        />
      </label>
      <label className="block">
        <span className="font-semibold">Your review</span>
        <textarea
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          minLength={10}
          maxLength={5000}
          required
        />
      </label>
      <label className="block">
        <span className="font-semibold">Add photos (up to 5)</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="mt-1 block"
          onChange={(e) => void addPhotos(e.target.files)}
          disabled={photos.length >= 5}
        />
      </label>
      {photos.length > 0 && (
        <div className="flex gap-2">
          {photos.map((p) => (
            <img
              key={p.id}
              src={p.url}
              alt="Your photo"
              className="h-14 w-14 rounded object-cover"
            />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-amber-400 px-4 py-1.5 font-medium hover:bg-amber-500 disabled:opacity-60"
        >
          Submit review
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-slate-300 px-4 py-1.5"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
