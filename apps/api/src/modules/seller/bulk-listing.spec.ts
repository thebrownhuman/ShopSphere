import type { SellerAttribute } from '@shopsphere/types';
import { parseCsv, planBulk, rupeesToPaise, templateRows, toCsv } from './bulk-listing';

const attrs: SellerAttribute[] = [
  { key: 'color', label: 'Colour', type: 'COLOR', isVariant: true },
  { key: 'size', label: 'Size', type: 'TEXT', isVariant: true },
  { key: 'fabric', label: 'Fabric', type: 'TEXT', isVariant: false },
];
const cats = new Map([['fashion/tshirts', { id: '11111111-1111-1111-1111-111111111111', attrs }]]);
const HEADER =
  'category_path,group_id,title,brand,description,bullets,sku_code,price,mrp,stock,image_urls,attr:color,attr:size,attr:fabric';

describe('bulk listing', () => {
  it('parses quoted CSV with BOM, CRLF and doubled quotes', () => {
    const rows = parseCsv(String.fromCharCode(0xfeff) + 'a,b\r\n"x, y","say ""hi"""\r\n\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('converts rupees to paise exactly', () => {
    expect(rupeesToPaise('1299')).toBe(129900);
    expect(rupeesToPaise('1,299.5')).toBe(129950);
    expect(rupeesToPaise('0.07')).toBe(7);
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('-5')).toBeNull();
    expect(rupeesToPaise('')).toBeNull();
  });

  it('groups variants and reports row-level errors', () => {
    const csv = [
      HEADER,
      'fashion/tshirts,t1,Cotton Tee,Acme,,Soft|Breathable,TEE-RED-M,499,999,10,,Red,M,Cotton',
      'fashion/tshirts,t1,,,,,TEE-RED-L,499,999,5,,Red,L,',
      'fashion/tshirts,t2,Polo,Acme,,,POLO-1,abc,999,x,,Blue,M,',
      'fashion/tshirts,t2,,,,,POLO-2,599,999,3,,Blue,L,',
      'nope/unknown,,Thing,Acme,,,THING-1,10,10,1,,,,',
      'fashion/tshirts,,Mug,Acme,,,MUG-1,800,500,1,,,,',
    ].join('\n');
    const plan = planBulk(parseCsv(csv), cats);
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0];
    expect(g.rows).toEqual([1, 2]);
    expect(g.req.title).toBe('Cotton Tee');
    expect(g.req.bullets).toEqual(['Soft', 'Breathable']);
    expect(g.req.specs).toEqual({ fabric: 'Cotton' });
    expect(g.req.variants.map((v) => [v.skuCode, v.price, v.stock, v.attributes])).toEqual([
      ['TEE-RED-M', 49900, 10, { color: 'Red', size: 'M' }],
      ['TEE-RED-L', 49900, 5, { color: 'Red', size: 'L' }],
    ]);

    const byRow = Object.fromEntries(plan.results.map((r) => [r.row, r]));
    expect(byRow[1].status).toBe('OK');
    expect(byRow[3].status).toBe('ERROR');
    expect(byRow[3].errors.map((e) => e.column).sort()).toEqual(['price', 'stock']);
    expect(byRow[4].status).toBe('SKIPPED');
    expect(byRow[5].errors[0].column).toBe('category_path');
    expect(byRow[6].errors).toEqual([
      { column: 'mrp', message: 'MRP cannot be below the selling price' },
    ]);
  });

  it('flags duplicate variants and missing header columns', () => {
    const dup = planBulk(
      parseCsv(
        [
          HEADER,
          'fashion/tshirts,g,Tee,Acme,,,A-1,1,1,1,,Red,M,',
          'fashion/tshirts,g,,,,,A-2,1,1,1,,Red,M,',
        ].join('\n'),
      ),
      cats,
    );
    expect(dup.results[1].errors[0].message).toBe('Duplicate variant');
    const bad = planBulk([['title', 'price']], cats);
    expect(bad.results[0].row).toBe(0);
    expect(bad.results[0].errors.map((e) => e.column)).toContain('category_path');
  });

  it('builds a template whose example row passes validation', () => {
    const rows = templateRows('fashion/tshirts', attrs);
    rows[1][11] = 'Red';
    const plan = planBulk(parseCsv(toCsv(rows)), cats);
    expect(plan.results[0]).toMatchObject({ status: 'OK' });
  });
});
