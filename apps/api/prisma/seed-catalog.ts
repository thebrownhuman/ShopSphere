import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { CATALOG, LeafDef, SELLERS } from './catalog-data';

/** Deterministic PRNG so every seed run builds the same catalog shape. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261031);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const sample = <T>(xs: T[], n: number): T[] => {
  const copy = [...xs];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
};
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Rupees → paise, ending in 9 like real price points (₹1,299). */
function pricePoint(rupees: number): bigint {
  const r = Math.max(9, Math.round(rupees));
  const nice = r < 100 ? r - (r % 10) + 9 : r - (r % 100) + 99;
  return BigInt(nice) * 100n;
}

function logUniform(lo: number, hi: number): number {
  return Math.exp(Math.log(lo) + rand() * (Math.log(hi) - Math.log(lo)));
}

/** Variant combinations: a random subset of each dimension's values, at most 6 SKUs. */
function variantCombos(leaf: LeafDef): { attrs: Record<string, string>; mult: number }[] {
  let combos: { attrs: Record<string, string>; mult: number }[] = [{ attrs: {}, mult: 1 }];
  for (const dim of leaf.variants) {
    const n = Math.min(dim.values.length, dim.key === 'size' ? between(2, 4) : between(1, 3));
    const start = dim.priceStep ? between(0, Math.max(0, dim.values.length - n)) : 0;
    const values = dim.priceStep
      ? dim.values.slice(start, start + n).map((v, i) => [v, start + i] as const)
      : sample(dim.values, n).map((v) => [v, 0] as const);
    const next: typeof combos = [];
    for (const c of combos) {
      for (const [v, idx] of values) {
        next.push({
          attrs: { ...c.attrs, [dim.key]: v },
          mult: c.mult * (1 + (dim.priceStep ?? 0) * idx),
        });
      }
    }
    combos = next;
  }
  return combos.slice(0, 6);
}

const PLACEHOLDER = (seed: string, label: string, color?: string) =>
  `/media/ph/${seed}.svg?label=${encodeURIComponent(label)}${color ? `&color=${encodeURIComponent(color)}` : ''}`;

async function insertChunks<T>(rows: T[], size: number, insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

export async function seedCatalog(
  prisma: PrismaClient,
  opts: { products: number; reset: boolean },
) {
  const existing = await prisma.product.count();
  if (existing > 0 && !opts.reset) {
    console.log(`catalog: ${existing} products present, skipping (SEED_RESET=1 to rebuild)`);
    return false;
  }
  const started = Date.now();
  await prisma.$executeRawUnsafe(
    `TRUNCATE offers, product_images, skus, products, brands, attribute_definitions, categories, sellers,
       home_sections, recently_viewed, co_views RESTART IDENTITY CASCADE`,
  );

  // Categories + attribute definitions
  const categories: Prisma.CategoryCreateManyInput[] = [];
  const attributes: Prisma.AttributeDefinitionCreateManyInput[] = [];
  const leaves: { def: LeafDef; id: string; root: string }[] = [];
  CATALOG.forEach((root, ri) => {
    const rootId = randomUUID();
    categories.push({
      id: rootId,
      slug: root.slug,
      name: root.name,
      path: root.slug,
      depth: 0,
      position: ri,
      gstRateBp: root.gstBp,
      image: PLACEHOLDER(`cat-${root.slug}`, root.name),
    });
    root.children.forEach((leaf, li) => {
      const id = randomUUID();
      categories.push({
        id,
        parentId: rootId,
        slug: leaf.slug,
        name: leaf.name,
        path: `${root.slug}/${leaf.slug}`,
        depth: 1,
        position: li,
        gstRateBp: leaf.gstBp ?? null,
        image: PLACEHOLDER(`cat-${leaf.slug}`, leaf.name),
      });
      leaves.push({ def: leaf, id, root: root.slug });
      leaf.variants.forEach((v, i) =>
        attributes.push({
          categoryId: id,
          key: v.key,
          label: v.label,
          type: v.type ?? 'TEXT',
          isVariant: true,
          filterable: true,
          position: i,
        }),
      );
      leaf.specs
        .filter((s) => s.key && !leaf.variants.some((v) => v.key === s.key))
        .forEach((s, i) =>
          attributes.push({
            categoryId: id,
            key: s.key!,
            label: s.label,
            filterable: true,
            position: 10 + i,
          }),
        );
    });
  });
  await prisma.category.createMany({ data: categories });
  await prisma.attributeDefinition.createMany({ data: attributes });

  // Sellers
  const sellers = SELLERS.map((s) => ({ ...s, id: randomUUID() }));
  await prisma.seller.createMany({
    data: sellers.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      isFirstParty: s.firstParty,
      ratingX10: s.rating,
      pincode: s.pincode,
      city: s.city,
      state: s.state,
      cutoffHour: s.cutoff,
    })),
  });
  const firstParty = sellers.filter((s) => s.firstParty);
  const thirdParty = sellers.filter((s) => !s.firstParty);

  // Brands
  const brandIds = new Map<string, string>();
  for (const l of leaves)
    for (const b of l.def.brands) if (!brandIds.has(b)) brandIds.set(b, randomUUID());
  await prisma.brand.createMany({
    data: [...brandIds].map(([name, id]) => ({ id, name, slug: slugify(name) })),
  });

  // Products, SKUs, offers, images
  const totalWeight = leaves.reduce((s, l) => s + (l.def.weight ?? 1), 0);
  const ranks = sample(
    Array.from({ length: opts.products }, (_, i) => i + 1),
    opts.products,
  );
  const products: Prisma.ProductCreateManyInput[] = [];
  const skus: Prisma.SkuCreateManyInput[] = [];
  const offers: Prisma.OfferCreateManyInput[] = [];
  const images: Prisma.ProductImageCreateManyInput[] = [];
  const now = Date.now();
  let n = 0;
  for (const leaf of leaves) {
    const count = Math.max(20, Math.round((opts.products * (leaf.def.weight ?? 1)) / totalWeight));
    for (let i = 0; i < count && n < opts.products; i++, n++) {
      const d = leaf.def;
      const id = randomUUID();
      const brand = pick(d.brands);
      const noun = pick(d.nouns);
      const adjective = pick(d.adjectives);
      const title = `${brand} ${adjective} ${noun}`;
      const rank = ranks[n];
      const ratingX10 = between(30, 48);
      const specValues = d.specs.map((s) => ({ label: s.label, value: pick(s.values) }));
      products.push({
        id,
        slug: `${slugify(title)}-${n.toString(36)}`,
        title,
        brandId: brandIds.get(brand)!,
        categoryId: leaf.id,
        description: `${title} from ${brand}. ${d.bullets.slice(0, 3).join('. ')}. Simulated listing for the ShopSphere demo catalog.`,
        bullets: sample(d.bullets, between(4, 5)),
        specs: [
          {
            group: 'General',
            items: [
              { label: 'Brand', value: brand },
              { label: 'Model', value: `${adjective} ${noun}` },
            ],
          },
          { group: 'Specifications', items: specValues },
        ],
        ratingX10,
        ratingCount: Math.round(logUniform(3, 40_000)),
        salesRank: rank,
        boughtLastMonth: Math.max(0, Math.round(5000 / Math.sqrt(rank)) * 10 - between(0, 30)),
        returnDays: d.returnDays ?? 7,
        createdAt: new Date(now - between(0, 365) * 86_400_000),
      });
      const base = logUniform(d.price[0], d.price[1]);
      const discount = rand() < 0.15 ? 0 : 0.05 + rand() * rand() * 0.7;
      const combos = variantCombos(d);
      const colorImages = new Map<string, string>();
      combos.forEach((c, si) => {
        const skuId = randomUUID();
        skus.push({
          id: skuId,
          productId: id,
          code: `SS-${n.toString(36).toUpperCase()}-${si}`,
          attributes: c.attrs,
          barcode: `890${String(n).padStart(6, '0')}${String(si).padStart(2, '0')}`,
          isDefault: si === 0,
          position: si,
        });
        const listPrice = pricePoint(base * c.mult);
        const mrp = pricePoint(Number(listPrice / 100n) / (1 - discount));
        const sellersForSku = [
          ...(rand() < 0.55 ? [pick(firstParty)] : []),
          ...sample(thirdParty, between(0, 2)),
        ];
        if (sellersForSku.length === 0) sellersForSku.push(pick(thirdParty));
        for (const s of sellersForSku) {
          const variance = 0.94 + rand() * 0.12;
          let price = pricePoint((Number(listPrice) / 100) * variance);
          if (price > mrp) price = mrp;
          const r = rand();
          const stock = r < 0.06 ? 0 : r < 0.18 ? between(1, 5) : between(6, 250);
          offers.push({
            skuId,
            sellerId: s.id,
            price,
            mrp,
            stockQty: stock,
            maxPerOrder: d.price[1] > 20_000 ? 2 : 5,
            fulfilment: s.firstParty || rand() < 0.3 ? 'SHOPSPHERE' : 'SELLER',
          });
        }
        const colour = c.attrs.color;
        if (colour && !colorImages.has(colour)) {
          colorImages.set(colour, skuId);
          images.push({
            productId: id,
            skuId,
            position: 0,
            alt: `${title} in ${colour}`,
            sourceUrl: PLACEHOLDER(`${id}-${slugify(colour)}`, `${brand} ${noun}`, colour),
          });
        }
      });
      for (let k = 0; k < 3; k++) {
        images.push({
          productId: id,
          position: 10 + k,
          alt: `${title} view ${k + 1}`,
          sourceUrl: PLACEHOLDER(
            `${id}-${k}`,
            k === 0 ? `${brand} ${noun}` : `${noun} ${['detail', 'in use', 'box'][k]}`,
          ),
        });
      }
    }
  }
  await insertChunks(products, 1000, (c) => prisma.product.createMany({ data: c }));
  await insertChunks(skus, 2000, (c) => prisma.sku.createMany({ data: c }));
  await insertChunks(offers, 3000, (c) => prisma.offer.createMany({ data: c }));
  await insertChunks(images, 3000, (c) => prisma.productImage.createMany({ data: c }));

  await seedHomeSections(prisma);
  console.log(
    `catalog: ${categories.length} categories, ${products.length} products, ${skus.length} skus, ` +
      `${offers.length} offers, ${images.length} images in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return true;
}

async function seedHomeSections(prisma: PrismaClient) {
  const banner = (id: string, title: string, subtitle: string, href: string) => ({
    id,
    title,
    subtitle,
    imageSeed: `banner-${id}`,
    href,
  });
  const sections: Prisma.HomeSectionCreateManyInput[] = [
    {
      type: 'HERO_CAROUSEL',
      title: 'Featured',
      position: 0,
      dataSource: {
        banners: [
          banner(
            'big-festive-sale',
            'Big Festive Sale',
            'Up to 70% off across categories',
            '/s?discount=40',
          ),
          banner(
            'audio-week',
            'Audio Week',
            'Headphones and earbuds from ₹699',
            '/s?category=headphones',
          ),
          banner(
            'smartphones-5g',
            'New 5G Smartphones',
            'Launch offers and no-cost EMI',
            '/s?category=smartphones&sort=newest',
          ),
          banner(
            'home-makeover',
            'Home Makeover',
            'Décor, bedsheets and more',
            '/s?category=home-kitchen',
          ),
          banner(
            'bank-offer',
            'ShopSphere Bank Offer',
            'Extra 10% instant discount (simulated)',
            '/s?plus=true',
          ),
        ],
      },
    },
    {
      type: 'QUAD_CARDS',
      title: 'Picked for you',
      position: 1,
      dataSource: {
        cards: [
          { title: 'Continue shopping', source: 'recently_viewed' },
          {
            title: 'Upgrade your audio',
            source: 'categories',
            categorySlugs: ['headphones', 'earbuds', 'speakers', 'smartwatches'],
            cta: { label: 'See more', href: '/s?category=electronics' },
          },
          {
            title: 'Festive fashion',
            source: 'categories',
            categorySlugs: ['womens-kurtas', 'sarees', 'mens-tshirts', 'sneakers'],
            cta: { label: 'Explore fashion', href: '/s?category=fashion' },
          },
          {
            title: 'Kitchen essentials',
            source: 'categories',
            categorySlugs: ['cookware', 'kitchen-appliances', 'storage-containers', 'staples'],
            cta: { label: 'Shop kitchen', href: '/s?category=home-kitchen' },
          },
        ],
      },
    },
    {
      type: 'QUAD_CARDS',
      title: 'Sign in',
      position: 2,
      audience: 'GUEST',
      dataSource: {
        cards: [
          {
            title: 'Sign in for your best experience',
            source: 'sign_in',
            cta: { label: 'Sign in securely', href: '/signin' },
          },
        ],
      },
    },
    {
      type: 'DEAL_ROW',
      title: "Today's Deals",
      position: 3,
      dataSource: {
        query: { discount: '40', inStock: 'true' },
        limit: 12,
        seeAllHref: '/s?discount=40',
      },
    },
    { type: 'RECENTLY_VIEWED', title: 'Your browsing history', position: 4, dataSource: {} },
    {
      type: 'PRODUCT_CAROUSEL',
      title: 'Inspired by your browsing',
      position: 5,
      audience: 'SIGNED_IN',
      dataSource: { personal: 'also_viewed_history', limit: 12 },
    },
    {
      type: 'PRODUCT_CAROUSEL',
      title: 'Best sellers in Electronics',
      position: 6,
      dataSource: {
        query: { category: 'electronics', inStock: 'true' },
        limit: 12,
        seeAllHref: '/s?category=electronics',
      },
    },
    {
      type: 'CATEGORY_TILES',
      title: 'Shop by category',
      position: 7,
      dataSource: { categorySlugs: CATALOG.map((r) => r.slug) },
    },
    {
      type: 'PRODUCT_CAROUSEL',
      title: 'Top rated in Fashion',
      position: 8,
      dataSource: {
        query: { category: 'fashion', sort: 'rating', inStock: 'true' },
        limit: 12,
        seeAllHref: '/s?category=fashion&sort=rating',
      },
    },
    {
      type: 'PRODUCT_CAROUSEL',
      title: 'Fulfilled by ShopSphere: fast delivery',
      position: 9,
      dataSource: {
        query: { plus: 'true', inStock: 'true' },
        limit: 12,
        seeAllHref: '/s?plus=true',
      },
    },
    {
      type: 'PRODUCT_CAROUSEL',
      title: 'New arrivals in Mobiles',
      position: 10,
      dataSource: {
        query: { category: 'mobiles-tablets', sort: 'newest' },
        limit: 12,
        seeAllHref: '/s?category=mobiles-tablets&sort=newest',
      },
    },
  ];
  await prisma.homeSection.createMany({ data: sections });
}
