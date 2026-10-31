import { Badge, Price, RatingStars, cx } from '@shopsphere/ui';
import Link from 'next/link';
import type { ProductSummary } from '@/lib/api/catalog.types';
import { deliveryLabel } from '@/lib/delivery';
import { CatalogImage } from './catalog-image';

/**
 * PRD §4 product tile: 1:1 image, 2-line title, rating + count, price + struck MRP + % off,
 * Plus badge, delivery date. The whole tile is one link; quick Add to cart arrives with M3.
 */
export function ProductTile({
  product,
  priority = false,
  compact = false,
  sizes = '(min-width: 1440px) 16vw, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw',
}: {
  product: ProductSummary;
  priority?: boolean;
  compact?: boolean;
  sizes?: string;
}) {
  const p = product;
  return (
    <article className="group relative flex h-full flex-col bg-white" data-testid="product-tile">
      <div className="relative mb-2 aspect-square overflow-hidden rounded bg-slate-100">
        <CatalogImage
          image={p.image}
          sizes={sizes}
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          className={cx('h-full w-full object-contain', !p.inStock && 'opacity-60')}
        />
      </div>
      {p.sponsored && (
        <Badge tone="sponsored" className="mb-0.5 px-0">
          Sponsored
        </Badge>
      )}
      <h3 className={cx('text-sm leading-snug text-slate-900', 'line-clamp-2')}>
        <Link
          href={`/p/${p.slug}`}
          className="after:absolute after:inset-0 hover:text-accent-darker focus-visible:outline-none group-focus-within:underline"
        >
          {p.title}
        </Link>
      </h3>
      <div className="mt-1">
        <RatingStars rating={p.rating} count={p.ratingCount} />
      </div>
      <div className="mt-1">
        <Price price={p.price} mrp={p.mrp} size={compact ? 'sm' : 'md'} />
      </div>
      {!compact && (
        <div className="mt-1 space-y-0.5 text-xs text-slate-700">
          {p.plus && (
            <Badge tone="plus" aria-label="ShopSphere Plus: fulfilled by ShopSphere">
              ✓ Plus
            </Badge>
          )}
          {p.inStock ? (
            <p>
              FREE delivery <span className="font-semibold">{deliveryLabel(p.deliveryDays)}</span>
            </p>
          ) : (
            <p className="font-medium text-deal">Currently unavailable</p>
          )}
        </div>
      )}
    </article>
  );
}

export function ProductTileSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 bg-white">
      <span className="block aspect-square animate-pulse rounded bg-slate-200" />
      <span className="block h-4 w-11/12 animate-pulse rounded bg-slate-200" />
      <span className="block h-4 w-2/3 animate-pulse rounded bg-slate-200" />
      <span className="block h-5 w-1/2 animate-pulse rounded bg-slate-200" />
    </div>
  );
}
