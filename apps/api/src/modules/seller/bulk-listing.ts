import type { BulkRowResult, ListingRequest, SellerAttribute } from '@shopsphere/types';
import { validateListing } from './listing.service';

/**
 * Bulk listing sheet (M5.3). One row per SKU; rows sharing `group_id` become one product with
 * variants (product-level columns are read from the group's first row). Attribute columns are
 * `attr:<key>`; money columns are rupees ("1299" or "1299.50"); list columns split on "|".
 */
export const BASE_COLUMNS = [
  'category_path',
  'group_id',
  'title',
  'brand',
  'description',
  'bullets',
  'sku_code',
  'price',
  'mrp',
  'stock',
  'image_urls',
] as const;
export const MAX_ROWS = 1000;
const BOM_RE = new RegExp(`^${String.fromCharCode(0xfeff)}`);

export interface CategoryLookup {
  id: string;
  attrs: SellerAttribute[];
}

export interface BulkGroup {
  rows: number[];
  req: ListingRequest;
}

export interface BulkPlan {
  results: BulkRowResult[];
  groups: BulkGroup[];
}

/** Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF/LF, leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(BOM_RE, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function toCsv(rows: string[][]): string {
  const esc = (f: string) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/** "1,299.50" → 129950 paise. Null when not a positive amount with at most 2 decimals. */
export function rupeesToPaise(v: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v.trim().replace(/,/g, ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

/** Validates every row and groups valid rows into listing requests. A group with any bad row is skipped. */
export function planBulk(
  table: string[][],
  categories: Map<string, CategoryLookup | null>,
): BulkPlan {
  const [header = [], ...data] = table;
  const cols = header.map((h) => h.trim().toLowerCase());
  const results: BulkRowResult[] = [];
  const missing = BASE_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length) {
    return {
      results: [
        {
          row: 0,
          status: 'ERROR',
          skuCode: null,
          errors: missing.map((c) => ({ column: c, message: 'Missing column in header row' })),
        },
      ],
      groups: [],
    };
  }
  const get = (r: string[], c: string) => (r[cols.indexOf(c)] ?? '').trim();
  const attrCols = cols.filter((c) => c.startsWith('attr:'));

  const byGroup = new Map<string, { row: number; cells: string[]; cat: CategoryLookup | null }[]>();
  data.forEach((cells, i) => {
    const row = i + 1;
    const path = get(cells, 'category_path').toLowerCase();
    const key = `${path}::${get(cells, 'group_id') || `__row${row}`}`;
    const list = byGroup.get(key) ?? [];
    list.push({ row, cells, cat: categories.get(path) ?? null });
    byGroup.set(key, list);
  });

  const groups: BulkGroup[] = [];
  for (const members of byGroup.values()) {
    const rowErrors = new Map<number, BulkRowResult['errors']>();
    const err = (row: number, column: string, message: string) =>
      rowErrors.set(row, [...(rowErrors.get(row) ?? []), { column, message }]);
    const first = members[0].cells;
    const cat = members[0].cat;
    const req: ListingRequest = {
      categoryId: cat?.id ?? '',
      title: get(first, 'title'),
      brand: get(first, 'brand'),
      description: get(first, 'description'),
      bullets: splitList(get(first, 'bullets')),
      specs: {},
      variants: [],
    };
    const variantKeys = new Set(cat?.attrs.filter((a) => a.isVariant).map((a) => a.key) ?? []);
    for (const m of members) {
      if (!cat) err(m.row, 'category_path', 'Unknown or non-leaf category');
      const price = rupeesToPaise(get(m.cells, 'price'));
      const mrp = rupeesToPaise(get(m.cells, 'mrp'));
      const stockRaw = get(m.cells, 'stock');
      if (price === null) err(m.row, 'price', 'Enter rupees, e.g. 1299 or 1299.50');
      if (mrp === null) err(m.row, 'mrp', 'Enter rupees, e.g. 1499');
      if (!/^\d+$/.test(stockRaw)) err(m.row, 'stock', 'Whole number required');
      const attributes: Record<string, string> = {};
      for (const c of attrCols) {
        const key = c.slice(5);
        const v = get(m.cells, c);
        if (!v) continue;
        if (variantKeys.has(key)) attributes[key] = v;
        else if (cat?.attrs.some((a) => a.key === key)) req.specs![key] ||= v;
        else if (cat) err(m.row, c, `Not an attribute of this category`);
      }
      const sku = get(m.cells, 'sku_code');
      req.variants.push({
        attributes,
        skuCode: sku || undefined,
        price: price ?? 0,
        mrp: mrp ?? 0,
        stock: /^\d+$/.test(stockRaw) ? Number(stockRaw) : 0,
        images: splitList(get(m.cells, 'image_urls')),
      });
    }
    if (cat) {
      for (const issue of validateListing(req, cat.attrs)) {
        const vm = /^variants\[(\d+)\]\.(\w+)/.exec(issue.field);
        const row = vm ? members[Number(vm[1])].row : members[0].row;
        const column = vm ? columnFor(vm[2]) : columnFor(issue.field.split('.')[0]);
        // Parse errors already explain this cell (e.g. "abc" price also fails "positive amount").
        if (!rowErrors.get(row)?.some((e) => e.column === column)) err(row, column, issue.message);
      }
    }
    const groupOk = rowErrors.size === 0;
    for (const m of members) {
      const errors = rowErrors.get(m.row) ?? [];
      results.push({
        row: m.row,
        status: errors.length ? 'ERROR' : groupOk ? 'OK' : 'SKIPPED',
        errors: errors.length
          ? errors
          : groupOk
            ? []
            : [{ column: 'group_id', message: 'Another row in this group has errors' }],
        skuCode: get(m.cells, 'sku_code') || null,
      });
    }
    if (groupOk) groups.push({ rows: members.map((m) => m.row), req });
  }
  results.sort((a, b) => a.row - b.row);
  return { results, groups };
}

function splitList(v: string): string[] {
  return v
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

function columnFor(field: string): string {
  if (['price', 'mrp', 'stock', 'title', 'brand'].includes(field)) return field;
  if (field === 'skuCode') return 'sku_code';
  if (field === 'specs' || field === 'attributes') return 'attr:*';
  if (field === 'variants') return 'group_id';
  return field.startsWith('attr') ? field : `attr:${field}`;
}

/** Template sheet for a category: header plus one example row. */
export function templateRows(categoryPath: string, attrs: SellerAttribute[]): string[][] {
  const header = [...BASE_COLUMNS, ...attrs.map((a) => `attr:${a.key}`)];
  const example = [
    categoryPath,
    'tee-01',
    'Example product title',
    'Example Brand',
    'Short description',
    'First bullet|Second bullet',
    '',
    '499',
    '999',
    '25',
    '',
    ...attrs.map(() => ''),
  ];
  return [header, example];
}
