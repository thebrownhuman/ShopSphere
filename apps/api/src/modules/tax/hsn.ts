/**
 * HSN codes for invoices (simulation). The catalogue has no per-product HSN, so the code comes
 * from the most specific category in the chain that has one, falling back to the top level.
 */
const HSN_BY_SLUG: Record<string, string> = {
  headphones: '8518',
  earbuds: '8518',
  speakers: '8518',
  televisions: '8528',
  laptops: '8471',
  smartwatches: '8517',
  smartphones: '8517',
  tablets: '8471',
  'mobile-accessories': '8544',
  electronics: '8543',
  'mobiles-tablets': '8517',
  fashion: '6109',
  'home-kitchen': '7323',
  appliances: '8516',
  beauty: '3304',
  'sports-fitness': '9506',
  books: '4901',
  grocery: '2106',
  'toys-baby': '9503',
};

/** Generic "other goods" code when nothing in the chain is mapped. */
export const DEFAULT_HSN = '9999';

/** `slugs` ordered leaf → root (CategoryTreeService.chain order). */
export function resolveHsn(slugs: string[]): string {
  for (const s of slugs) if (HSN_BY_SLUG[s]) return HSN_BY_SLUG[s];
  return DEFAULT_HSN;
}
