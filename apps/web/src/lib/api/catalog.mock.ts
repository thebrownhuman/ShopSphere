import type {
  CategoryCrumb,
  CategoryNode,
  DealItem,
  DeliveryEstimate,
  Facet,
  FacetValue,
  HomeResponse,
  ImageRef,
  Offer,
  OffersResponse,
  ProductDetail,
  ProductSummary,
  SearchQuery,
  SearchResult,
  Sku,
  SpecGroup,
  Suggestion,
  VariantAxis,
} from './catalog.types';

/*
 * Deterministic in-memory catalog for building the UI before the catalog API exists.
 * Images are generated SVG placeholders from /img (no product photography of any kind).
 */

// ---------- helpers ----------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]!;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
/** Round rupees to a shelf price ending in 9, returned in paise. */
const shelf = (rupees: number) => (Math.max(1, Math.round(rupees / 10)) * 10 - 1) * 100;

export function img(label: string, hue: number, w = 600, h = 600, alt = label): ImageRef {
  return {
    url: `/img/${hue % 360}/${encodeURIComponent(label)}?w=${w}&h=${h}`,
    alt,
    width: w,
    height: h,
  };
}

// ---------- category + product templates ----------

interface AxisDef {
  key: string;
  label: string;
  kind: 'swatch' | 'chip';
  values: Array<{ value: string; label: string; swatch?: string; priceDelta?: number }>;
}

interface LeafDef {
  slug: string;
  name: string;
  parent: string;
  hue: number;
  brands: string[];
  models: string[];
  noun: string;
  priceRange: [number, number];
  axis?: AxisDef;
  specs: (r: () => number) => SpecGroup['rows'];
  bullets: string[];
}

const COLOURS = {
  black: { value: 'black', label: 'Black', swatch: '#1f2937' },
  silver: { value: 'silver', label: 'Silver', swatch: '#cbd5e1' },
  blue: { value: 'blue', label: 'Midnight Blue', swatch: '#1e3a8a' },
  white: { value: 'white', label: 'White', swatch: '#f8fafc' },
  green: { value: 'green', label: 'Sage Green', swatch: '#4d7c0f' },
  red: { value: 'red', label: 'Crimson Red', swatch: '#b91c1c' },
};
const sizeAxis = (vals: string[]): AxisDef => ({
  key: 'size',
  label: 'Size',
  kind: 'chip',
  values: vals.map((v) => ({ value: slugify(v), label: v })),
});
const colourAxis = (keys: Array<keyof typeof COLOURS>): AxisDef => ({
  key: 'colour',
  label: 'Colour',
  kind: 'swatch',
  values: keys.map((k, i) => ({ ...COLOURS[k], priceDelta: i * 500 })),
});

const PARENTS: Array<{ slug: string; name: string; hue: number }> = [
  { slug: 'electronics', name: 'Electronics', hue: 215 },
  { slug: 'mobiles', name: 'Mobiles', hue: 260 },
  { slug: 'fashion', name: 'Fashion', hue: 330 },
  { slug: 'home-kitchen', name: 'Home & Kitchen', hue: 30 },
  { slug: 'grocery', name: 'Grocery', hue: 110 },
  { slug: 'beauty', name: 'Beauty', hue: 300 },
  { slug: 'sports', name: 'Sports & Fitness', hue: 160 },
  { slug: 'books', name: 'Books', hue: 45 },
];

const LEAVES: LeafDef[] = [
  {
    slug: 'headphones',
    name: 'Headphones',
    parent: 'electronics',
    hue: 200,
    brands: ['Sony', 'boAt', 'JBL', 'Sennheiser', 'Noise', 'OnePlus'],
    models: ['Rockerz 550', 'Tune 770NC', 'HD 450BT', 'Airwave Max', 'Bullets Z2', 'Studio Pro'],
    noun: 'Wireless Bluetooth Over-Ear Headphones',
    priceRange: [999, 24990],
    axis: colourAxis(['black', 'white', 'blue']),
    specs: (r) => [
      { label: 'Connectivity', value: 'Bluetooth 5.3' },
      { label: 'Battery life', value: `${20 + Math.floor(r() * 40)} hours` },
      { label: 'Noise cancellation', value: r() > 0.5 ? 'Active (ANC)' : 'Passive' },
      { label: 'Weight', value: `${180 + Math.floor(r() * 120)} g` },
    ],
    bullets: [
      'Deep bass with 40 mm dynamic drivers tuned for clarity at every volume',
      'Fast charge: 10 minutes gives up to 5 hours of playback',
      'Dual-device pairing: switch between phone and laptop without re-pairing',
      'Soft memory-foam ear cushions for all-day comfort',
      'Built-in microphones for clear calls with environmental noise reduction',
    ],
  },
  {
    slug: 'smartphones',
    name: 'Smartphones',
    parent: 'mobiles',
    hue: 250,
    brands: ['Samsung', 'Apple', 'OnePlus', 'Xiaomi', 'realme', 'vivo'],
    models: ['Galaxy M35', 'Nord CE4', 'Redmi Note 13', 'Narzo 70', 'T3 Ultra', 'Edge 50'],
    noun: '5G Smartphone',
    priceRange: [9999, 79999],
    axis: {
      key: 'ram',
      label: 'RAM & Storage',
      kind: 'chip',
      values: [
        { value: '8-128', label: '8 GB + 128 GB' },
        { value: '8-256', label: '8 GB + 256 GB', priceDelta: 3000 },
        { value: '12-256', label: '12 GB + 256 GB', priceDelta: 6000 },
      ],
    },
    specs: (r) => [
      { label: 'Display', value: `6.${6 + Math.floor(r() * 3)}" AMOLED, 120 Hz` },
      { label: 'Battery', value: `${5000 + Math.floor(r() * 4) * 500} mAh` },
      { label: 'Rear camera', value: `${pick(r, [50, 64, 108, 200])} MP + 8 MP + 2 MP` },
      { label: 'Network', value: '5G, Dual SIM' },
    ],
    bullets: [
      'Bright 120 Hz AMOLED display with smooth scrolling and vivid colour',
      'Long-lasting battery with fast wired charging in the box',
      'Pro-grade triple camera with night mode and 4K video',
      'Latest 5G chipset for gaming and multitasking',
      'Two OS upgrades and four years of security patches',
    ],
  },
  {
    slug: 'laptops',
    name: 'Laptops',
    parent: 'electronics',
    hue: 225,
    brands: ['HP', 'Dell', 'Lenovo', 'ASUS', 'Acer', 'Apple'],
    models: ['Pavilion 15', 'Inspiron 14', 'IdeaPad Slim 5', 'Vivobook 16', 'Aspire 7', 'Air M3'],
    noun: 'Thin and Light Laptop',
    priceRange: [32990, 129990],
    specs: (r) => [
      {
        label: 'Processor',
        value: pick(r, ['Intel Core i5 13th Gen', 'AMD Ryzen 7 7730U', 'Intel Core Ultra 5']),
      },
      { label: 'RAM', value: pick(r, ['8 GB', '16 GB']) },
      { label: 'Storage', value: pick(r, ['512 GB SSD', '1 TB SSD']) },
      { label: 'Display', value: '15.6" FHD IPS, anti-glare' },
    ],
    bullets: [
      'All-day battery with rapid charge to 50% in 30 minutes',
      'Full HD anti-glare display with narrow bezels',
      'Backlit keyboard and precision glass touchpad',
      'Wi-Fi 6 and USB-C with power delivery',
      'Pre-installed Windows 11 Home and Office Home 2024',
    ],
  },
  {
    slug: 'televisions',
    name: 'Televisions',
    parent: 'electronics',
    hue: 190,
    brands: ['Sony', 'Samsung', 'LG', 'TCL', 'Xiaomi'],
    models: ['Bravia 2', 'Crystal 4K', 'UR75', 'P745', 'X Pro'],
    noun: '4K Ultra HD Smart LED Television',
    priceRange: [17990, 89990],
    axis: sizeAxis(['43 inch', '50 inch', '55 inch']),
    specs: () => [
      { label: 'Resolution', value: '4K Ultra HD (3840 x 2160)' },
      { label: 'Refresh rate', value: '60 Hz' },
      { label: 'Smart TV', value: 'Google TV, built-in Chromecast' },
      { label: 'Sound', value: '20 W, Dolby Audio' },
    ],
    bullets: [
      '4K HDR picture with dynamic colour enhancement',
      'Smart TV with all major streaming apps and voice remote',
      'Dolby Audio for clear dialogue and room-filling sound',
      '3 HDMI and 2 USB ports for consoles and set-top boxes',
      'One-year comprehensive warranty plus one year on panel',
    ],
  },
  {
    slug: 'smartwatches',
    name: 'Smartwatches',
    parent: 'electronics',
    hue: 175,
    brands: ['Noise', 'boAt', 'Fire-Boltt', 'Amazfit', 'Samsung'],
    models: ['ColorFit Pro 5', 'Wave Sigma', 'Phoenix Ultra', 'Bip 5', 'Galaxy Fit 3'],
    noun: 'Smartwatch with Bluetooth Calling',
    priceRange: [1299, 24999],
    axis: colourAxis(['black', 'silver', 'green']),
    specs: (r) => [
      { label: 'Display', value: `1.${80 + Math.floor(r() * 20)}" AMOLED` },
      { label: 'Battery life', value: `Up to ${5 + Math.floor(r() * 10)} days` },
      { label: 'Water resistance', value: 'IP68' },
    ],
    bullets: [
      'Bright AMOLED display with always-on mode',
      'Bluetooth calling with built-in mic and speaker',
      'Heart-rate, SpO2 and sleep tracking',
      '100+ sports modes with auto workout detection',
      'IP68 water and dust resistance',
    ],
  },
  {
    slug: 'mens-tshirts',
    name: "Men's T-shirts",
    parent: 'fashion',
    hue: 345,
    brands: ["Levi's", 'Allen Solly', 'U.S. Polo Assn.', 'Puma', 'HRX'],
    models: ['Classic Crew', 'Polo Fit', 'Graphic Tee', 'Dri-Fit Active', 'Oversized'],
    noun: "Men's Regular Fit Cotton T-shirt",
    priceRange: [399, 1999],
    axis: sizeAxis(['S', 'M', 'L', 'XL']),
    specs: () => [
      { label: 'Fabric', value: '100% cotton' },
      { label: 'Fit', value: 'Regular' },
      { label: 'Care', value: 'Machine wash' },
    ],
    bullets: [
      'Soft breathable cotton for everyday comfort',
      'Regular fit with ribbed crew neck',
      'Colour-fast dyes that hold up wash after wash',
      'Pairs with jeans, chinos or shorts',
      'Easy returns within 10 days',
    ],
  },
  {
    slug: 'womens-kurtas',
    name: "Women's Kurtas",
    parent: 'fashion',
    hue: 320,
    brands: ['Biba', 'W', 'Libas', 'Aurelia'],
    models: ['Anarkali', 'Straight Printed', 'A-Line Embroidered', 'Festive Silk'],
    noun: "Women's Cotton Kurta",
    priceRange: [599, 3499],
    axis: sizeAxis(['S', 'M', 'L', 'XL']),
    specs: () => [
      { label: 'Fabric', value: 'Cotton blend' },
      { label: 'Length', value: 'Calf length' },
      { label: 'Sleeve', value: 'Three-quarter' },
    ],
    bullets: [
      'Breathable cotton blend for warm days',
      'Hand-block inspired print',
      'Side slits for easy movement',
      'Pairs with palazzos or leggings',
      'Easy returns within 10 days',
    ],
  },
  {
    slug: 'footwear',
    name: 'Footwear',
    parent: 'fashion',
    hue: 15,
    brands: ['Nike', 'Adidas', 'Puma', 'Bata', 'Campus'],
    models: ['Revolution 7', 'Duramo SL', 'Softride', 'Power Walker', 'North Plus'],
    noun: "Men's Running Shoes",
    priceRange: [999, 8999],
    axis: sizeAxis(['UK 7', 'UK 8', 'UK 9', 'UK 10']),
    specs: () => [
      { label: 'Upper', value: 'Engineered mesh' },
      { label: 'Sole', value: 'Rubber' },
      { label: 'Closure', value: 'Lace-up' },
    ],
    bullets: [
      'Lightweight breathable mesh upper',
      'Cushioned midsole for daily runs',
      'Durable rubber outsole with grip pattern',
      'Padded collar and tongue',
      'Easy returns within 10 days',
    ],
  },
  {
    slug: 'kitchen-appliances',
    name: 'Kitchen Appliances',
    parent: 'home-kitchen',
    hue: 35,
    brands: ['Prestige', 'Philips', 'Bajaj', 'Pigeon', 'Butterfly'],
    models: ['Mixer Grinder 750W', 'Air Fryer 4.2L', 'Induction Cooktop', 'Electric Kettle 1.5L'],
    noun: 'Kitchen Appliance',
    priceRange: [699, 9999],
    specs: () => [
      { label: 'Power', value: '750 W' },
      { label: 'Warranty', value: '2 years' },
    ],
    bullets: [
      'Powerful motor for everyday Indian cooking',
      'Food-grade stainless steel parts',
      'Overload protection and safety lock',
      'Easy to clean, dishwasher-safe jars',
      'Two-year manufacturer warranty',
    ],
  },
  {
    slug: 'furniture',
    name: 'Furniture',
    parent: 'home-kitchen',
    hue: 25,
    brands: ['Wakefit', 'Nilkamal', 'Sleepyhead'],
    models: ['Engineered Wood Study Table', 'Ergonomic Office Chair', 'Orthopaedic Mattress'],
    noun: 'Home Furniture',
    priceRange: [2999, 24999],
    specs: () => [
      { label: 'Material', value: 'Engineered wood' },
      { label: 'Assembly', value: 'DIY, tools included' },
    ],
    bullets: [
      'Sturdy build tested for daily use',
      'Easy self-assembly with included tools',
      'Moisture-resistant laminate finish',
      'Compact footprint for Indian homes',
      'One-year warranty',
    ],
  },
  {
    slug: 'staples',
    name: 'Staples',
    parent: 'grocery',
    hue: 90,
    brands: ['Tata Sampann', 'Aashirvaad', 'Fortune', 'India Gate'],
    models: ['Basmati Rice 5 kg', 'Whole Wheat Atta 10 kg', 'Toor Dal 1 kg', 'Sunflower Oil 1 L'],
    noun: 'Grocery Staple',
    priceRange: [149, 999],
    specs: () => [{ label: 'Shelf life', value: '9 months' }],
    bullets: [
      'Sourced from trusted farms',
      'Hygienically packed',
      'No added preservatives',
      'Resealable pack',
      'FSSAI certified',
    ],
  },
  {
    slug: 'skincare',
    name: 'Skincare',
    parent: 'beauty',
    hue: 290,
    brands: ['Lakme', 'Mamaearth', 'Nivea', 'Minimalist'],
    models: [
      'Vitamin C Face Serum',
      'Daily Moisturiser SPF 30',
      'Niacinamide 10%',
      'Gentle Face Wash',
    ],
    noun: 'Skincare',
    priceRange: [199, 1299],
    specs: () => [{ label: 'Skin type', value: 'All skin types' }],
    bullets: [
      'Dermatologically tested',
      'Lightweight non-greasy formula',
      'Free of parabens and sulphates',
      'Suitable for daily use',
      'Cruelty-free',
    ],
  },
  {
    slug: 'fitness',
    name: 'Fitness Equipment',
    parent: 'sports',
    hue: 150,
    brands: ['Nivia', 'Cosco', 'Boldfit'],
    models: [
      'Yoga Mat 6 mm',
      'Adjustable Dumbbells 10 kg',
      'Resistance Bands Set',
      'Skipping Rope',
    ],
    noun: 'Fitness Equipment',
    priceRange: [299, 4999],
    specs: () => [{ label: 'Material', value: 'TPE / steel' }],
    bullets: [
      'Durable build for home workouts',
      'Non-slip grip',
      'Compact and easy to store',
      'Suitable for beginners and pros',
      'Six-month warranty',
    ],
  },
  {
    slug: 'fiction',
    name: 'Fiction Books',
    parent: 'books',
    hue: 50,
    brands: ['Penguin', 'HarperCollins', 'Rupa'],
    models: ['The Monsoon Letters', 'City of Lamps', 'A Train to Nowhere', 'The Spice Garden'],
    noun: 'Paperback Novel',
    priceRange: [199, 699],
    specs: () => [
      { label: 'Format', value: 'Paperback' },
      { label: 'Language', value: 'English' },
    ],
    bullets: [
      'Paperback edition',
      'Printed on acid-free paper',
      'A gripping read for the weekend',
      'Ideal as a gift',
      'Ships in protective packaging',
    ],
  },
];

// ---------- generated catalog ----------

interface MockSku extends Sku {
  price: number;
  mrp: number;
}

interface MockProduct {
  detail: Omit<ProductDetail, 'alsoViewed'>;
  skus: MockSku[];
  leaf: LeafDef;
  hue: number;
  plus: boolean;
  createdIndex: number;
  salesRank: number;
}

const HERO_SLUG = 'sony-wh-1000xm5-wireless-noise-cancelling-headphones';

function buildProduct(leaf: LeafDef, i: number): MockProduct {
  const r = rng(`${leaf.slug}:${i}`);
  const brand = leaf.brands[i % leaf.brands.length]!;
  const model = leaf.models[Math.floor(i / leaf.brands.length + i) % leaf.models.length]!;
  const isHero = leaf.slug === 'headphones' && i === 0;
  const title = isHero
    ? 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones with 30 hr Battery'
    : `${brand} ${model} ${leaf.noun}`;
  const slug = isHero ? HERO_SLUG : `${slugify(`${brand} ${model} ${leaf.noun}`)}-${i}`;
  const id = `p_${hash(slug).toString(36)}`;
  const [lo, hi] = leaf.priceRange;
  const base = isHero ? 26990 : lo + (hi - lo) * r() * r();
  const discount = isHero ? 0.23 : pick(r, [0.05, 0.12, 0.2, 0.3, 0.45, 0.6]);
  const hue = (leaf.hue + Math.floor(r() * 50) - 25 + 360) % 360;
  const axisValues = leaf.axis
    ? isHero
      ? leaf.axis.values
      : leaf.axis.values.slice(0, 1 + Math.floor(r() * leaf.axis.values.length))
    : [undefined];
  const skus: MockSku[] = axisValues.map((v, vi) => {
    const delta = isHero ? [0, 500, 2000][vi]! : (v?.priceDelta ?? 0);
    const price = shelf(base + delta);
    const label = v ? `${brand} ${model} · ${v.label}` : `${brand} ${model}`;
    const skuHue = (hue + vi * 40) % 360;
    return {
      id: `${id}_${v?.value ?? 'std'}`,
      attributes: v && leaf.axis ? { [leaf.axis.key]: v.value } : {},
      price,
      mrp: shelf(isHero ? 34990 : (base + delta) / (1 - discount)),
      images: ['Front', 'Side', 'Back', 'Detail'].map((view, k) =>
        img(
          `${label}`,
          skuHue + k * 6,
          600,
          600,
          `${title}${v ? `, ${v.label}` : ''}, ${view.toLowerCase()} view`,
        ),
      ),
    };
  });
  const rating = isHero ? 4.4 : Math.round((3.2 + r() * 1.7) * 10) / 10;
  const axes: VariantAxis[] =
    leaf.axis && skus.length > 1
      ? [
          {
            ...leaf.axis,
            values: axisValues
              .filter(Boolean)
              .map((v) => ({ value: v!.value, label: v!.label, swatch: v!.swatch })),
          },
        ]
      : [];
  return {
    leaf,
    hue,
    plus: isHero || r() > 0.35,
    createdIndex: Math.floor(r() * 1000),
    salesRank: isHero ? 0 : Math.floor(r() * 1000),
    skus,
    detail: {
      id,
      slug,
      title,
      brand: { name: brand, slug: slugify(brand) },
      categoryPath: [
        { slug: leaf.parent, name: PARENTS.find((p) => p.slug === leaf.parent)!.name },
        { slug: leaf.slug, name: leaf.name },
      ],
      rating,
      ratingCount: isHero ? 18432 : Math.floor(20 + r() * r() * 40000),
      boughtLastMonth: isHero ? 2000 : Math.floor(r() * 5) * 500,
      bullets: leaf.bullets,
      description: `${title}. ${leaf.bullets.slice(0, 3).join('. ')}. Backed by ShopSphere's easy return policy and genuine-product guarantee.`,
      specs: [
        {
          group: 'General',
          rows: [
            { label: 'Brand', value: brand },
            { label: 'Model', value: isHero ? 'WH-1000XM5' : model },
            {
              label: 'Model number',
              value: `${slugify(brand).toUpperCase().slice(0, 3)}-${(hash(slug) % 90000) + 10000}`,
            },
          ],
        },
        { group: 'Key specifications', rows: leaf.specs(r) },
        {
          group: 'Warranty',
          rows: [{ label: 'Warranty summary', value: '1 year manufacturer warranty' }],
        },
      ],
      variantAxes: axes,
      skus: skus.map(({ id: skuId, attributes, images }) => ({ id: skuId, attributes, images })),
      defaultSkuId: skus[0]!.id,
      returnPolicy: leaf.parent === 'grocery' ? 'Non-returnable' : '10-day replacement',
    },
  };
}

const PRODUCTS: MockProduct[] = LEAVES.flatMap((leaf) =>
  Array.from({ length: leaf.slug === 'headphones' ? 18 : 10 }, (_, i) => buildProduct(leaf, i)),
);
const BY_SLUG = new Map(PRODUCTS.map((p) => [p.detail.slug, p]));
const BY_ID = new Map(PRODUCTS.map((p) => [p.detail.id, p]));

function summary(p: MockProduct, skuIndex = 0): ProductSummary {
  const sku = p.skus[skuIndex]!;
  const stock = stockFor(sku.id);
  return {
    id: p.detail.id,
    slug: p.detail.slug,
    skuId: sku.id,
    title: p.detail.title,
    brand: p.detail.brand.name,
    image: sku.images[0]!,
    rating: p.detail.rating,
    ratingCount: p.detail.ratingCount,
    price: sku.price,
    mrp: sku.mrp,
    plus: p.plus,
    inStock: stock > 0,
    deliveryDays: p.plus ? 1 : 2 + (hash(p.detail.id) % 4),
  };
}

function stockFor(skuId: string): number {
  if (skuId.startsWith(BY_SLUG.get(HERO_SLUG)!.detail.id)) return skuId.endsWith('blue') ? 3 : 40;
  const h = hash(`stock:${skuId}`) % 20;
  return h === 0 ? 0 : h < 4 ? h : 10 + h * 5;
}

// ---------- categories ----------

export async function getCategories(): Promise<CategoryNode[]> {
  return PARENTS.map((p) => ({
    id: `c_${p.slug}`,
    slug: p.slug,
    name: p.name,
    image: img(p.name, p.hue, 200, 200),
    children: LEAVES.filter((l) => l.parent === p.slug).map((l) => ({
      id: `c_${l.slug}`,
      slug: l.slug,
      name: l.name,
      image: img(l.name, l.hue, 200, 200),
    })),
  }));
}

// ---------- home ----------

function endOfToday(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}

export async function getHome(): Promise<HomeResponse> {
  const leaf = (slug: string) => PRODUCTS.filter((p) => p.leaf.slug === slug);
  const tile = (p: MockProduct) => ({
    label: p.detail.brand.name,
    href: `/p/${p.detail.slug}`,
    image: {
      ...p.skus[0]!.images[0]!,
      url: p.skus[0]!.images[0]!.url.replace('w=600&h=600', 'w=200&h=200'),
      width: 200,
      height: 200,
    },
  });
  const catTile = (slug: string) => {
    const l = LEAVES.find((x) => x.slug === slug)!;
    return { label: l.name, href: `/c/${l.slug}`, image: img(l.name, l.hue, 200, 200) };
  };
  const deals: DealItem[] = [...PRODUCTS]
    .map((p) => summary(p))
    .filter((s) => s.mrp - s.price > s.mrp * 0.25 && s.inStock)
    .slice(0, 12)
    .map((s) => ({ ...s, claimedPercent: 20 + (hash(s.id) % 75) }));
  const bestSellers = [...PRODUCTS]
    .filter((p) => p.leaf.parent === 'electronics')
    .sort((a, b) => a.salesRank - b.salesRank)
    .slice(0, 12)
    .map((p) => summary(p));
  const topRated = [...PRODUCTS]
    .sort((a, b) => b.detail.rating - a.detail.rating)
    .slice(0, 12)
    .map((p) => summary(p));
  const inspired = leaf('smartwatches')
    .concat(leaf('headphones').slice(4, 10))
    .map((p) => summary(p));

  return {
    sections: [
      {
        id: 'hero',
        type: 'hero',
        banners: [
          {
            id: 'b1',
            title: 'The Big Festive Sale',
            subtitle: 'Up to 70% off electronics, fashion and more',
            href: '/s?k=sale&discount=40',
            image: img('Big Festive Sale', 215, 1500, 400, 'The Big Festive Sale banner'),
          },
          {
            id: 'b2',
            title: 'Headphones from ₹999',
            subtitle: 'Noise cancelling, wireless, gaming',
            href: '/c/headphones',
            image: img('Headphones from ₹999', 195, 1500, 400, 'Headphones sale banner'),
          },
          {
            id: 'b3',
            title: '10% instant discount',
            subtitle: 'With ShopSphere Bank cards on orders above ₹5,000',
            href: '/s?k=smartphone',
            image: img('Bank offer 10% off', 265, 1500, 400, 'Bank offer banner'),
          },
          {
            id: 'b4',
            title: 'New launches in Smartwatches',
            subtitle: 'AMOLED, calling, 10-day battery',
            href: '/c/smartwatches',
            image: img('New smartwatches', 170, 1500, 400, 'Smartwatch launches banner'),
          },
          {
            id: 'b5',
            title: 'Fresh fashion, every day',
            subtitle: 'Kurtas, tees and sneakers under ₹999',
            href: '/s?category=fashion&price=-999',
            image: img('Fashion under ₹999', 330, 1500, 400, 'Fashion banner'),
          },
        ],
      },
      {
        id: 'quad',
        type: 'quad',
        cards: [
          {
            id: 'q1',
            title: 'Keep shopping for headphones',
            tiles: leaf('headphones').slice(0, 4).map(tile),
            cta: { label: 'See more', href: '/c/headphones' },
            audience: 'all',
          },
          {
            id: 'q2',
            title: 'Top picks for your home',
            tiles: ['kitchen-appliances', 'furniture', 'staples', 'fitness'].map(catTile),
            cta: { label: 'Explore Home & Kitchen', href: '/c/home-kitchen' },
            audience: 'all',
          },
          {
            id: 'q3',
            title: 'Up to 60% off | Fashion',
            tiles: ['mens-tshirts', 'womens-kurtas', 'footwear', 'skincare'].map(catTile),
            cta: { label: 'See all offers', href: '/s?category=fashion&discount=40' },
            audience: 'all',
          },
          {
            id: 'q4',
            title: 'Sign in for your best experience',
            tiles: [],
            cta: { label: 'Sign in securely', href: '/signin' },
            audience: 'guest',
          },
          {
            id: 'q5',
            title: 'Continue shopping',
            tiles: leaf('smartphones').slice(0, 4).map(tile),
            cta: { label: 'View your browsing history', href: '/s?category=mobiles' },
            audience: 'signed-in',
          },
        ],
      },
      {
        id: 'deals',
        type: 'deals',
        title: "Today's Deals",
        endsAt: endOfToday(),
        href: '/s?discount=25',
        items: deals,
      },
      {
        id: 'best-electronics',
        type: 'carousel',
        title: 'Best sellers in Electronics',
        href: '/c/electronics',
        items: bestSellers,
      },
      { id: 'inspired', type: 'carousel', title: 'Inspired by your browsing', items: inspired },
      {
        id: 'top-rated',
        type: 'carousel',
        title: 'Top rated',
        href: '/s?rating=4&sort=rating',
        items: topRated,
      },
      { id: 'recent', type: 'recently-viewed', title: 'Your browsing history' },
    ],
  };
}

// ---------- PDP ----------

export async function getProduct(slug: string): Promise<ProductDetail | null> {
  const p = BY_SLUG.get(slug);
  if (!p) return null;
  const r = rng(`coview:${slug}`);
  const alsoViewed = PRODUCTS.filter((o) => o.leaf.slug === p.leaf.slug && o !== p)
    .sort(() => r() - 0.5)
    .slice(0, 10)
    .map((o) => summary(o));
  return { ...p.detail, alsoViewed };
}

export async function listProductSlugs() {
  return PRODUCTS.map((p) => ({ slug: p.detail.slug, updatedAt: '2026-10-01T00:00:00.000Z' }));
}

const SELLERS = [
  { id: 's_retail', name: 'ShopSphere Retail', rating: 4.6 },
  { id: 's_appario', name: 'Kaveri Traders', rating: 4.4 },
  { id: 's_cloudtail', name: 'Ganga Electronics', rating: 4.1 },
  { id: 's_lotus', name: 'Lotus Mart', rating: 3.9 },
];

export async function getOffers(productId: string, skuId: string): Promise<OffersResponse> {
  const p = BY_ID.get(productId);
  const sku = p?.skus.find((s) => s.id === skuId);
  if (!p || !sku) return { productId, skuId, buyBox: null, others: [], bankOffers: [] };
  const n = 1 + (hash(`sellers:${skuId}`) % 3);
  const stock = stockFor(skuId);
  const offers: Offer[] = SELLERS.slice(0, n).map((s, i) => ({
    id: `o_${skuId}_${s.id}`,
    skuId,
    sellerId: s.id,
    sellerName: s.name,
    sellerRating: s.rating,
    price: i === 0 ? sku.price : sku.price + i * 100 * (1 + (hash(s.id) % 9)) * 10,
    mrp: sku.mrp,
    stockQty: i === 0 ? stock : 5 + i * 7,
    maxPerOrder: p.leaf.parent === 'grocery' ? 10 : 5,
    fulfilment: i === 0 && p.plus ? 'SHOPSPHERE' : 'SELLER',
  }));
  // Buy box v1: cheapest in-stock offer, ties broken by seller rating.
  const live = offers
    .filter((o) => o.stockQty > 0)
    .sort((a, b) => a.price - b.price || b.sellerRating - a.sellerRating);
  const buyBox = live[0] ?? null;
  return {
    productId,
    skuId,
    buyBox,
    others: live.slice(1),
    bankOffers: [
      '10% instant discount up to ₹1,500 on ShopSphere Bank credit cards, min. order ₹5,000',
      '5% cashback on ShopSphere Pay UPI, up to ₹100',
      'No-cost EMI on select cards for 3 and 6 months',
    ],
  };
}

export async function getDeliveryEstimate(
  skuId: string,
  pincode: string,
): Promise<DeliveryEstimate | null> {
  if (!/^[1-9]\d{5}$/.test(pincode)) return null;
  const p = [...BY_ID.values()].find((x) => x.skus.some((s) => s.id === skuId));
  if (!p) return null;
  // Stub zone table: metro prefixes are same zone as a warehouse.
  const metro = ['11', '40', '56', '60', '70', '50', '41', '38'].includes(pincode.slice(0, 2));
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(14, 0, 0, 0);
  const missed = now >= cutoff;
  if (missed) cutoff.setDate(cutoff.getDate() + 1);
  const days = (p.plus ? 1 : 3) + (metro ? 0 : 2) + (missed ? 1 : 0);
  const deliverBy = new Date(now);
  deliverBy.setDate(deliverBy.getDate() + days);
  const sku = p.skus.find((s) => s.id === skuId)!;
  return {
    skuId,
    pincode,
    serviceable: !pincode.startsWith('9'),
    deliverBy: `${deliverBy.getFullYear()}-${String(deliverBy.getMonth() + 1).padStart(2, '0')}-${String(deliverBy.getDate()).padStart(2, '0')}`,
    free: p.plus || sku.price >= 49900,
    cutoffAt: cutoff.toISOString(),
  };
}

// ---------- search ----------

const SYNONYMS: Record<string, string[]> = {
  tv: ['television'],
  television: ['tv'],
  headphone: ['headphones', 'earphones'],
  earphones: ['headphones'],
  mobile: ['smartphone'],
  phone: ['smartphone'],
  shoes: ['footwear', 'running'],
  tshirt: ['t-shirt'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ');
const stem = (w: string) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

function haystack(p: MockProduct): string {
  return norm(
    `${p.detail.title} ${p.detail.brand.name} ${p.leaf.name} ${PARENTS.find((x) => x.slug === p.leaf.parent)!.name}`,
  );
}
const HAY = new Map(PRODUCTS.map((p) => [p, haystack(p).split(/\s+/).map(stem)]));
const VOCAB = [...new Set([...HAY.values()].flat())].filter((w) => w.length > 2);

function matches(p: MockProduct, tokens: string[]): boolean {
  const words = HAY.get(p)!;
  return tokens.every((t) => {
    const alts = [t, ...(SYNONYMS[t] ?? [])].map(stem);
    return alts.some((a) => words.some((w) => w.startsWith(a)));
  });
}

function edits(a: string, b: string): number {
  const dp = Array.from(
    { length: a.length + 1 },
    (_, i) => [i, ...Array(b.length).fill(0)] as number[],
  );
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length]![b.length]!;
}

function correct(tokens: string[]): string[] | null {
  let changed = false;
  const out = tokens.map((t) => {
    if (VOCAB.includes(stem(t)) || SYNONYMS[t]) return t;
    const best = VOCAB.map((w) => [w, edits(stem(t), w)] as const)
      .filter(([, d]) => d <= 2)
      .sort((a, b) => a[1] - b[1])[0];
    if (best) changed = true;
    return best ? best[0] : t;
  });
  return changed ? out : null;
}

type Row = { p: MockProduct; s: ProductSummary };

function inCategory(p: MockProduct, slug?: string) {
  return !slug || p.leaf.slug === slug || p.leaf.parent === slug;
}

function applyFilters(rows: Row[], q: SearchQuery, skip?: string): Row[] {
  return rows.filter(({ p, s }) => {
    if (skip !== 'category' && !inCategory(p, q.category)) return false;
    if (skip !== 'brand' && q.brand.length && !q.brand.includes(p.detail.brand.slug)) return false;
    if (q.priceMin !== undefined && s.price < q.priceMin * 100) return false;
    if (q.priceMax !== undefined && s.price > q.priceMax * 100) return false;
    if (skip !== 'rating' && q.rating && p.detail.rating < q.rating) return false;
    if (skip !== 'discount' && q.discount && (s.mrp - s.price) / s.mrp < q.discount / 100)
      return false;
    if (skip !== 'delivery' && q.delivery === 'plus' && !s.plus) return false;
    if (skip !== 'delivery' && q.delivery === 'tomorrow' && s.deliveryDays > 1) return false;
    if (q.inStock && !s.inStock) return false;
    for (const [k, vals] of Object.entries(q.attrs)) {
      if (skip === k || !vals.length) continue;
      if (!p.skus.some((sku) => vals.includes(sku.attributes[k] ?? ''))) return false;
    }
    return true;
  });
}

function terms(
  key: string,
  label: string,
  rows: Row[],
  valueOf: (r: Row) => Array<[string, string]>,
  order?: string[],
): Facet {
  const counts = new Map<string, FacetValue>();
  for (const r of rows)
    for (const [value, l] of valueOf(r)) {
      const f = counts.get(value) ?? { value, label: l, count: 0 };
      f.count++;
      counts.set(value, f);
    }
  const values = [...counts.values()].sort((a, b) =>
    order
      ? order.indexOf(a.value) - order.indexOf(b.value)
      : b.count - a.count || a.label.localeCompare(b.label),
  );
  return { key, label, type: 'terms', values };
}

export async function search(q: SearchQuery): Promise<SearchResult> {
  let tokens = q.q ? norm(q.q).split(/\s+/).filter(Boolean) : [];
  const all: Row[] = PRODUCTS.map((p) => ({ p, s: summary(p) }));
  let base = tokens.length ? all.filter(({ p }) => matches(p, tokens)) : all;
  let didYouMean: string | undefined;
  if (!base.length && tokens.length) {
    const fixed = correct(tokens);
    if (fixed) {
      tokens = fixed;
      base = all.filter(({ p }) => matches(p, tokens));
      if (base.length) didYouMean = fixed.join(' ');
    }
  }

  const rows = applyFilters(base, q);
  const sorted = [...rows].sort((a, b) => {
    switch (q.sort) {
      case 'price_asc':
        return a.s.price - b.s.price;
      case 'price_desc':
        return b.s.price - a.s.price;
      case 'rating':
        return b.p.detail.rating - a.p.detail.rating;
      case 'newest':
        return b.p.createdIndex - a.p.createdIndex;
      default:
        // Featured: sales x rating x stock boost.
        return (
          b.p.detail.rating * (b.s.inStock ? 1 : 0.3) * (1000 - b.p.salesRank) -
          a.p.detail.rating * (a.s.inStock ? 1 : 0.3) * (1000 - a.p.salesRank)
        );
    }
  });

  const pageSize = 48;
  const page = Math.min(q.page, Math.max(1, Math.ceil(sorted.length / pageSize)));
  const items = sorted.slice((page - 1) * pageSize, page * pageSize).map((r) => r.s);
  if (items.length > 3 && q.page === 1 && !q.brand.length)
    items[2] = { ...items[2]!, sponsored: true };

  const facets: Facet[] = [];
  if (!q.category || !LEAVES.some((l) => l.slug === q.category)) {
    facets.push(
      terms('category', 'Category', applyFilters(base, q, 'category'), ({ p }) => [
        [p.leaf.slug, p.leaf.name],
      ]),
    );
  }
  facets.push(
    terms('brand', 'Brand', applyFilters(base, q, 'brand'), ({ p }) => [
      [p.detail.brand.slug, p.detail.brand.name],
    ]),
  );
  const prices = base.map((r) => r.s.price / 100);
  if (prices.length)
    facets.push({
      key: 'price',
      label: 'Price',
      type: 'range',
      min: Math.floor(Math.min(...prices)),
      max: Math.ceil(Math.max(...prices)),
    });
  facets.push(
    terms(
      'rating',
      'Customer Review',
      applyFilters(base, q, 'rating'),
      ({ p }) =>
        ([4, 3, 2] as const)
          .filter((n) => p.detail.rating >= n)
          .map((n) => [String(n), `${n}★ & up`]),
      ['4', '3', '2'],
    ),
    terms(
      'discount',
      'Discount',
      applyFilters(base, q, 'discount'),
      ({ s }) =>
        ([10, 25, 40, 60] as const)
          .filter((n) => (s.mrp - s.price) / s.mrp >= n / 100)
          .map((n) => [String(n), `${n}% off or more`]),
      ['10', '25', '40', '60'],
    ),
    terms('delivery', 'Delivery', applyFilters(base, q, 'delivery'), ({ s }) => [
      ...(s.plus ? ([['plus', 'ShopSphere Plus']] as Array<[string, string]>) : []),
      ...(s.deliveryDays <= 1
        ? ([['tomorrow', 'Get it by tomorrow']] as Array<[string, string]>)
        : []),
    ]),
  );
  const axes = new Map<string, AxisDef>();
  for (const { p } of base) if (p.leaf.axis) axes.set(p.leaf.axis.key, p.leaf.axis);
  for (const axis of axes.values()) {
    facets.push(
      terms(
        axis.key,
        axis.label,
        applyFilters(base, q, axis.key),
        ({ p }) =>
          p.skus.flatMap((sku) => {
            const v = axis.values.find((x) => x.value === sku.attributes[axis.key]);
            return v ? [[v.value, v.label] as [string, string]] : [];
          }),
        axis.values.map((v) => v.value),
      ),
    );
  }

  const related: CategoryCrumb[] = rows.length
    ? []
    : LEAVES.slice(0, 6).map((l) => ({ slug: l.slug, name: l.name }));
  return {
    total: sorted.length,
    page,
    pageSize,
    items,
    facets: facets.filter((f) => f.type === 'range' || f.values.length > 0),
    didYouMean,
    relatedCategories: related,
  };
}

const POPULAR = [
  'headphones',
  'headphones wireless',
  'headphones noise cancelling',
  'smartphone 5g',
  'smartwatch',
  'laptop',
  'television 55 inch',
  'running shoes',
  'kurta',
  'air fryer',
  'basmati rice',
  'face serum',
  'yoga mat',
];

export async function suggest(prefix: string): Promise<Suggestion[]> {
  const q = norm(prefix).trim();
  if (q.length < 2) return [];
  const queries = POPULAR.filter(
    (s) => s.startsWith(q) || s.split(' ').some((w) => w.startsWith(q)),
  )
    .slice(0, 5)
    .map((s) => ({ kind: 'query' as const, label: s, href: `/s?k=${encodeURIComponent(s)}` }));
  const cats = LEAVES.filter((l) => norm(l.name).includes(q))
    .slice(0, 2)
    .map((l) => ({ kind: 'category' as const, label: l.name, href: `/c/${l.slug}` }));
  const tokens = q.split(/\s+/);
  const prods = PRODUCTS.filter((p) => matches(p, tokens))
    .slice(0, 3)
    .map((p) => ({ kind: 'product' as const, label: p.detail.title, href: `/p/${p.detail.slug}` }));
  return [...queries, ...cats, ...prods];
}
