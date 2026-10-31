import { Injectable } from '@nestjs/common';
import type { BulkReport, BulkUploadRequest } from '@shopsphere/types';
import ExcelJS from 'exceljs';
import { CategoryTreeService } from '../catalog/category-tree.service';
import { AppError } from '../shared/errors/app-error';
import { PrismaService } from '../shared/prisma/prisma.service';
import { CategoryLookup, MAX_ROWS, parseCsv, planBulk, templateRows, toCsv } from './bulk-listing';
import { ListingService } from './listing.service';

const MAX_BYTES = 5 * 1024 * 1024;

/** Bulk listing upload (M5.3): CSV or XLSX in, row-level validation report out. */
@Injectable()
export class BulkListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoryTreeService,
    private readonly listings: ListingService,
  ) {}

  async template(categoryId: string): Promise<{ fileName: string; csv: string }> {
    const attrs = await this.listings.attributes(categoryId);
    const { byId } = await this.categories.load();
    const cat = byId.get(categoryId)!;
    return {
      fileName: `listing-template-${cat.slug}.csv`,
      csv: toCsv(templateRows(cat.path, attrs)),
    };
  }

  async upload(
    seller: { sellerId: string; accountId: string; isFirstParty: boolean },
    req: BulkUploadRequest,
  ): Promise<BulkReport> {
    const table = await readSheet(req.fileName, Buffer.from(req.dataBase64, 'base64'));
    if (table.length - 1 > MAX_ROWS) {
      throw new AppError('UPLOAD_INVALID', `Max ${MAX_ROWS} rows per file`, 422);
    }
    if (table.length < 2) throw new AppError('UPLOAD_INVALID', 'The file has no data rows', 422);

    const cols = table[0].map((h) => h.trim().toLowerCase());
    const pathCol = cols.indexOf('category_path');
    const lookups = new Map<string, CategoryLookup | null>();
    if (pathCol >= 0) {
      const { byId } = await this.categories.load();
      const byPath = new Map([...byId.values()].map((c) => [c.path.toLowerCase(), c]));
      for (const row of table.slice(1)) {
        const path = (row[pathCol] ?? '').trim().toLowerCase();
        if (lookups.has(path)) continue;
        const cat = byPath.get(path);
        // attributes() rejects non-leaf categories; those rows report "Unknown or non-leaf".
        const attrs = cat ? await this.listings.attributes(cat.id).catch(() => null) : null;
        lookups.set(path, cat && attrs ? { id: cat.id, attrs } : null);
      }
    }
    const plan = planBulk(table, lookups);
    const results = new Map(plan.results.map((r) => [r.row, r]));

    // SKU codes already in the catalog fail their row (and so their group).
    const codes = plan.groups.flatMap((g) => g.req.variants.map((v) => v.skuCode?.toUpperCase()));
    const taken = new Set(
      (
        await this.prisma.sku.findMany({
          where: { code: { in: codes.filter((c): c is string => !!c) } },
          select: { code: true },
        })
      ).map((s) => s.code),
    );
    let productsCreated = 0;
    let skusCreated = 0;
    const created: string[] = [];
    for (const g of plan.groups) {
      const clash = g.req.variants.findIndex(
        (v) => v.skuCode && taken.has(v.skuCode.toUpperCase()),
      );
      if (clash >= 0) {
        failGroup(results, g.rows, g.rows[clash], 'sku_code', 'SKU code already exists');
        continue;
      }
      if (req.dryRun) continue;
      try {
        const attrs = [...lookups.values()].find((v) => v?.id === g.req.categoryId)!.attrs;
        const res = await this.prisma.$transaction((tx) =>
          this.listings.insert(tx, seller, g.req, attrs),
        );
        created.push(res.productId);
        productsCreated += 1;
        skusCreated += res.skus.length;
      } catch (err) {
        const message = err instanceof AppError ? err.message : 'Could not save this product';
        failGroup(results, g.rows, g.rows[0], 'group_id', message);
      }
    }
    if (created.length) await this.listings.index(created);

    const rows = [...results.values()].sort((a, b) => a.row - b.row);
    return {
      fileName: req.fileName,
      dryRun: !!req.dryRun,
      totalRows: table.length - 1,
      validRows: rows.filter((r) => r.status === 'OK').length,
      errorRows: rows.filter((r) => r.status !== 'OK').length,
      productsCreated,
      skusCreated,
      rows,
    };
  }
}

function failGroup(
  results: Map<number, BulkReport['rows'][number]>,
  rows: number[],
  culprit: number,
  column: string,
  message: string,
) {
  for (const r of rows) {
    const res = results.get(r)!;
    res.status = r === culprit ? 'ERROR' : 'SKIPPED';
    res.errors =
      r === culprit
        ? [{ column, message }]
        : [{ column: 'group_id', message: 'Another row in this group has errors' }];
  }
}

/** CSV (UTF-8) or XLSX (first worksheet) → string cells. */
export async function readSheet(fileName: string, buf: Buffer): Promise<string[][]> {
  if (buf.length === 0) throw new AppError('UPLOAD_INVALID', 'The file is empty', 422);
  if (buf.length > MAX_BYTES) throw new AppError('UPLOAD_INVALID', 'Max file size is 5 MB', 422);
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return parseCsv(buf.toString('utf8'));
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
    } catch {
      throw new AppError('UPLOAD_INVALID', 'Could not read the XLSX file', 422);
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new AppError('UPLOAD_INVALID', 'The workbook has no sheets', 422);
    const width = ws.getRow(1).cellCount;
    const out: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(row.getCell(c).text ?? '');
      out.push(cells);
    });
    return out.filter((r) => r.some((f) => f.trim() !== ''));
  }
  throw new AppError('UPLOAD_INVALID', 'Upload a .csv or .xlsx file', 422);
}
