import { API_URL, ApiRequestError } from '../api';
import type {
  CategoriesResponse,
  DeliveryEstimateResponse,
  HomeResponse as ApiHomeResponse,
  ProductDetailResponse,
  ProductOffersResponse,
  SearchResponse,
  SuggestResponse,
} from '@shopsphere/types';
import {
  toCategories,
  toDelivery,
  toHome,
  toOffers,
  toProduct,
  toSearchParams,
  toSearchResult,
  toSuggestions,
} from './catalog.adapters';
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
 * so the mock (NEXT_PUBLIC_CATALOG_MOCK=1) and the real API are interchangeable. Backend DTOs are
 * mapped to the web view types in catalog.adapters.ts.
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
  const res = await get<ApiHomeResponse>('/home');
  return res ? toHome(res, API_URL) : { sections: [] };
}

export async function getCategories(): Promise<CategoryNode[]> {
  if (CATALOG_MOCK) return (await mock()).getCategories();
  const res = await get<CategoriesResponse>('/categories');
  return res ? toCategories(res.categories, API_URL) : [];
}

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  if (CATALOG_MOCK) return (await mock()).getProduct(slug);
  const res = await get<ProductDetailResponse>(`/products/${encodeURIComponent(slug)}`);
  return res ? toProduct(res, API_URL) : null;
}

/** Slugs for sitemap.xml. The API has no listing endpoint yet, so this is empty outside the mock. */
export async function listProductSlugs(): Promise<Array<{ slug: string; updatedAt: string }>> {
  if (CATALOG_MOCK) return (await mock()).listProductSlugs();
  return [];
}

export async function getOffers(
  productId: string,
  skuId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<OffersResponse> {
  if (CATALOG_MOCK) return (await mock()).getOffers(productId, skuId);
  const res = await get<ProductOffersResponse>(
    `/products/${encodeURIComponent(productId)}/offers?sku=${encodeURIComponent(skuId)}`,
    { live: true, ...opts },
  );
  return res ? toOffers(res) : { productId, skuId, buyBox: null, others: [], bankOffers: [] };
}

export async function getDeliveryEstimate(
  skuId: string,
  pincode: string,
  opts: { signal?: AbortSignal } = {},
): Promise<DeliveryEstimate | null> {
  if (CATALOG_MOCK) return (await mock()).getDeliveryEstimate(skuId, pincode);
  const qs = new URLSearchParams({ sku: skuId, pincode });
  const res = await get<DeliveryEstimateResponse>(`/delivery-estimate?${qs}`, {
    live: true,
    ...opts,
  });
  return res ? toDelivery(res) : null;
}

export async function search(query: SearchQuery): Promise<SearchResult> {
  if (CATALOG_MOCK) return (await mock()).search(query);
  const res = await get<SearchResponse>(`/search?${toSearchParams(query)}`, { live: true });
  if (!res) throw new ApiRequestError(404, null);
  return toSearchResult(res, API_URL);
}

export async function suggest(
  prefix: string,
  opts: { signal?: AbortSignal } = {},
): Promise<Suggestion[]> {
  if (CATALOG_MOCK) return (await mock()).suggest(prefix);
  const res = await get<SuggestResponse>(`/search/suggest?q=${encodeURIComponent(prefix)}`, {
    live: true,
    ...opts,
  });
  return res ? toSuggestions(res) : [];
}
