import { API_URL, ApiRequestError } from '../api';
import { serializeSearchQuery } from '../search-params';
import type {
  CategoryNode,
  DeliveryEstimate,
  HomeResponse,
  OffersResponse,
  ProductDetail,
  SearchQuery,
  SearchResult,
  Suggestion,
} from './catalog.types';

/**
 * Single entry point for catalog/search data. Pages and components never call fetch directly,
 * so the mock (NEXT_PUBLIC_CATALOG_MOCK=1) and the real API are interchangeable.
 *
 * Caching (plan M2.22): descriptive content is ISR-cached for 5 minutes; price, stock and delivery
 * (offers + delivery estimate) are always fetched with `no-store` and only ever on the client.
 */

export const CATALOG_MOCK = process.env.NEXT_PUBLIC_CATALOG_MOCK === '1';
const CONTENT_REVALIDATE_SECONDS = 300;

type FetchOpts = { live?: boolean; signal?: AbortSignal };

async function get<T>(path: string, { live, signal }: FetchOpts = {}): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { accept: 'application/json' },
    signal,
    ...(live ? { cache: 'no-store' } : { next: { revalidate: CONTENT_REVALIDATE_SECONDS } }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiRequestError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

// The mock is loaded lazily so its fixtures never ship in the default client bundle.
const mock = () => import('./catalog.mock');

export async function getHome(): Promise<HomeResponse> {
  if (CATALOG_MOCK) return (await mock()).getHome();
  return (await get<HomeResponse>('/home')) ?? { sections: [] };
}

export async function getCategories(): Promise<CategoryNode[]> {
  if (CATALOG_MOCK) return (await mock()).getCategories();
  return (await get<CategoryNode[]>('/categories')) ?? [];
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  if (CATALOG_MOCK) return (await mock()).getProduct(slug);
  return get<ProductDetail>(`/products/${encodeURIComponent(slug)}`);
}

/** Slugs for sitemap.xml. */
export async function listProductSlugs(): Promise<Array<{ slug: string; updatedAt: string }>> {
  if (CATALOG_MOCK) return (await mock()).listProductSlugs();
  return (await get<Array<{ slug: string; updatedAt: string }>>('/products/slugs')) ?? [];
}

export async function getOffers(
  productId: string,
  skuId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<OffersResponse> {
  if (CATALOG_MOCK) return (await mock()).getOffers(productId, skuId);
  const res = await get<OffersResponse>(
    `/products/${encodeURIComponent(productId)}/offers?sku=${encodeURIComponent(skuId)}`,
    { live: true, ...opts },
  );
  return res ?? { productId, skuId, buyBox: null, others: [], bankOffers: [] };
}

export async function getDeliveryEstimate(
  skuId: string,
  pincode: string,
  opts: { signal?: AbortSignal } = {},
): Promise<DeliveryEstimate | null> {
  if (CATALOG_MOCK) return (await mock()).getDeliveryEstimate(skuId, pincode);
  const qs = new URLSearchParams({ sku: skuId, pincode });
  return get<DeliveryEstimate>(`/delivery-estimate?${qs}`, { live: true, ...opts });
}

export async function search(query: SearchQuery): Promise<SearchResult> {
  if (CATALOG_MOCK) return (await mock()).search(query);
  // The API takes the same filter vocabulary as the site URL, except `k` -> `q`.
  const qs = new URLSearchParams(serializeSearchQuery(query));
  const k = qs.get('k');
  qs.delete('k');
  if (k) qs.set('q', k);
  return (await get<SearchResult>(`/search?${qs}`, { live: true }))!;
}

export async function suggest(
  prefix: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Suggestion[]> {
  if (CATALOG_MOCK) return (await mock()).suggest(prefix);
  return (
    (await get<Suggestion[]>(`/search/suggest?q=${encodeURIComponent(prefix)}`, {
      live: true,
      ...opts,
    })) ?? []
  );
}
