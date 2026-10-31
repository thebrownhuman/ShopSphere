/**
 * Seed catalog definition (M2.4). Everything is synthetic: brands are invented, images are
 * generated placeholders (M2.24). Prices are rupees here and converted to paise on insert.
 */

export interface VariantDim {
  key: string;
  label: string;
  type?: 'COLOR' | 'TEXT';
  values: string[];
  /** Price multiplier per value index (e.g. storage tiers). */
  priceStep?: number;
}

export interface SpecDef {
  label: string;
  /** Key when the spec is filterable in search. */
  key?: string;
  values: string[];
}

export interface LeafDef {
  slug: string;
  name: string;
  gstBp?: number;
  brands: string[];
  nouns: string[];
  adjectives: string[];
  /** Rupees. */
  price: [number, number];
  variants: VariantDim[];
  specs: SpecDef[];
  bullets: string[];
  returnDays?: number;
  /** Relative share of the product count. */
  weight?: number;
}

export interface RootDef {
  slug: string;
  name: string;
  gstBp: number;
  children: LeafDef[];
}

const COLORS = [
  'Black',
  'White',
  'Blue',
  'Red',
  'Green',
  'Silver',
  'Grey',
  'Pink',
  'Gold',
  'Purple',
];
const FASHION_COLORS = [
  'Black',
  'White',
  'Navy',
  'Beige',
  'Red',
  'Green',
  'Grey',
  'Brown',
  'Pink',
  'Yellow',
];
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'];
const SHOE_SIZES = ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10'];

const color = (values = COLORS): VariantDim => ({
  key: 'color',
  label: 'Colour',
  type: 'COLOR',
  values,
});

export const CATALOG: RootDef[] = [
  {
    slug: 'electronics',
    name: 'Electronics',
    gstBp: 1800,
    children: [
      {
        slug: 'headphones',
        name: 'Headphones',
        brands: ['Sonora', 'BassLine', 'Auralis', 'Koda', 'Zentra', 'Echofy'],
        nouns: [
          'Wireless Headphones',
          'Over-Ear Headphones',
          'On-Ear Headphones',
          'Noise Cancelling Headphones',
          'Gaming Headset',
        ],
        adjectives: ['Pro', 'Max', 'Lite', 'Air', 'Studio', 'Bass+', 'X2', 'Neo'],
        price: [799, 24_999],
        variants: [color(['Black', 'White', 'Blue', 'Silver'])],
        specs: [
          {
            label: 'Connectivity',
            key: 'connectivity',
            values: ['Bluetooth 5.3', 'Bluetooth 5.0', 'Wired 3.5 mm', 'USB-C'],
          },
          { label: 'Battery Life', values: ['20 hours', '30 hours', '40 hours', '60 hours'] },
          { label: 'Noise Cancellation', key: 'anc', values: ['Active', 'Passive', 'Hybrid ANC'] },
          { label: 'Driver Size', values: ['30 mm', '40 mm', '50 mm'] },
        ],
        bullets: [
          'Deep bass with tuned drivers',
          'Fast charging: 10 min for 5 hours',
          'Soft memory-foam ear cushions',
          'Built-in mic for calls',
          'Foldable design with travel pouch',
        ],
        weight: 1.5,
      },
      {
        slug: 'earbuds',
        name: 'True Wireless Earbuds',
        brands: ['Sonora', 'BassLine', 'Auralis', 'Pebble Audio', 'Echofy'],
        nouns: ['TWS Earbuds', 'Wireless Earbuds', 'Sports Earbuds'],
        adjectives: ['Buds', 'Pods', 'Go', 'Air 3', 'Pro 2', 'Mini'],
        price: [699, 14_999],
        variants: [color(['Black', 'White', 'Blue', 'Green'])],
        specs: [
          {
            label: 'Connectivity',
            key: 'connectivity',
            values: ['Bluetooth 5.3', 'Bluetooth 5.2'],
          },
          { label: 'Playback', values: ['24 hours', '36 hours', '50 hours'] },
          { label: 'Water Resistance', values: ['IPX4', 'IPX5', 'IP55'] },
          { label: 'Noise Cancellation', key: 'anc', values: ['Active', 'Passive', 'Hybrid ANC'] },
        ],
        bullets: [
          'Low-latency game mode',
          'Touch controls',
          'Quad-mic ENC for clear calls',
          'Type-C fast charging case',
          'Sweat and splash resistant',
        ],
        weight: 1.2,
      },
      {
        slug: 'speakers',
        name: 'Speakers',
        brands: ['BassLine', 'Zentra', 'Koda', 'Thunderbox'],
        nouns: ['Bluetooth Speaker', 'Party Speaker', 'Soundbar', 'Smart Speaker'],
        adjectives: ['Boom', 'Go', 'Max', 'Mini', 'Pulse', 'Arc'],
        price: [999, 29_999],
        variants: [color(['Black', 'Blue', 'Red', 'Grey'])],
        specs: [
          { label: 'Output Power', key: 'power', values: ['10 W', '20 W', '40 W', '100 W'] },
          { label: 'Battery Life', values: ['8 hours', '12 hours', '24 hours'] },
        ],
        bullets: [
          'Room-filling 360° sound',
          'TWS pairing for stereo',
          'Built-in mic and voice assistant',
          'Rugged fabric finish',
          'USB and AUX input',
        ],
      },
      {
        slug: 'televisions',
        name: 'Televisions',
        brands: ['Vistra', 'Lumina', 'Orion', 'Kaveri', 'Nexa'],
        nouns: ['Smart LED TV', '4K Ultra HD Smart TV', 'QLED Smart TV', 'Full HD Smart TV'],
        adjectives: ['Series 5', 'Series 7', 'Vision', 'Cinema', 'Neo'],
        price: [10_999, 1_49_999],
        variants: [
          {
            key: 'screen',
            label: 'Screen Size',
            values: ['32 inch', '43 inch', '50 inch', '55 inch', '65 inch'],
            priceStep: 0.35,
          },
        ],
        specs: [
          {
            label: 'Resolution',
            key: 'resolution',
            values: ['HD Ready', 'Full HD', '4K Ultra HD'],
          },
          { label: 'Display Type', key: 'display', values: ['LED', 'QLED', 'OLED'] },
          { label: 'Refresh Rate', values: ['60 Hz', '120 Hz'] },
          {
            label: 'Operating System',
            values: ['Android TV', 'Google TV', 'webOS-like', 'Tizen-like'],
          },
        ],
        bullets: [
          'Dolby Audio surround sound',
          'Built-in Chromecast',
          'Three HDMI and two USB ports',
          'Bezel-less design',
          'Voice remote with OTT hotkeys',
        ],
        returnDays: 10,
      },
      {
        slug: 'laptops',
        name: 'Laptops',
        brands: ['Nimbus', 'Vertex', 'Altair', 'Corebook', 'Zephyr'],
        nouns: ['Thin and Light Laptop', 'Gaming Laptop', '2-in-1 Laptop', 'Business Laptop'],
        adjectives: ['14', '15 Pro', 'Air', 'X360', 'Creator', 'G15'],
        price: [24_999, 1_89_999],
        variants: [
          { key: 'ram', label: 'RAM', values: ['8 GB', '16 GB', '32 GB'], priceStep: 0.2 },
          { key: 'storage', label: 'Storage', values: ['512 GB SSD', '1 TB SSD'], priceStep: 0.12 },
        ],
        specs: [
          {
            label: 'Processor',
            key: 'processor',
            values: ['Core i5 13th Gen', 'Core i7 13th Gen', 'Ryzen 5 7000', 'Ryzen 7 7000'],
          },
          { label: 'Display', values: ['14 inch FHD', '15.6 inch FHD 144 Hz', '16 inch 2.5K'] },
          { label: 'Graphics', values: ['Integrated', 'RTX 3050', 'RTX 4060'] },
          { label: 'Weight', values: ['1.3 kg', '1.6 kg', '2.2 kg'] },
        ],
        bullets: [
          'Backlit keyboard',
          'Fast charging 50% in 30 min',
          'Wi-Fi 6 and Bluetooth 5.2',
          'FHD webcam with privacy shutter',
          'MS Office Home & Student included',
        ],
        returnDays: 10,
      },
      {
        slug: 'smartwatches',
        name: 'Smartwatches',
        brands: ['Pulsefit', 'Chrono', 'Fitrix', 'Koda'],
        nouns: ['Smartwatch', 'Fitness Band', 'Calling Smartwatch'],
        adjectives: ['Active', 'Pro', 'Ultra', 'Lite', 'Sport'],
        price: [1_299, 34_999],
        variants: [color(['Black', 'Silver', 'Pink', 'Blue'])],
        specs: [
          { label: 'Display', values: ['1.43 inch AMOLED', '1.85 inch LCD', '1.96 inch AMOLED'] },
          { label: 'Battery Life', values: ['7 days', '10 days', '14 days'] },
          { label: 'Calling', key: 'calling', values: ['Bluetooth Calling', 'No Calling'] },
        ],
        bullets: [
          '24x7 heart-rate and SpO2 monitoring',
          '100+ sports modes',
          'IP68 water resistance',
          'Sleep and stress tracking',
          'Customisable watch faces',
        ],
      },
    ],
  },
  {
    slug: 'mobiles-tablets',
    name: 'Mobiles & Tablets',
    gstBp: 1800,
    children: [
      {
        slug: 'smartphones',
        name: 'Smartphones',
        brands: ['Nova', 'Kaveri', 'Zentra', 'Orion', 'Pixelon', 'Volta'],
        nouns: ['5G Smartphone', 'Smartphone'],
        adjectives: ['A15', 'Note 13', 'Edge', 'Pro 5G', 'Neo', 'Prime', 'Ultra', 'Lite'],
        price: [7_999, 1_29_999],
        variants: [
          color(['Black', 'Blue', 'Green', 'Silver']),
          {
            key: 'storage',
            label: 'Storage',
            values: ['128 GB', '256 GB', '512 GB'],
            priceStep: 0.15,
          },
        ],
        specs: [
          { label: 'RAM', key: 'ram', values: ['4 GB', '6 GB', '8 GB', '12 GB'] },
          {
            label: 'Display',
            values: ['6.5 inch HD+', '6.7 inch FHD+ AMOLED', '6.8 inch 120 Hz AMOLED'],
          },
          {
            label: 'Rear Camera',
            values: ['50 MP Dual', '64 MP Triple', '108 MP Triple', '200 MP'],
          },
          { label: 'Battery', values: ['5000 mAh', '5500 mAh', '6000 mAh'] },
          {
            label: 'Processor',
            values: ['Dimensity 7200', 'Snapdragon 7 Gen 3', 'Snapdragon 8 Gen 2', 'Helio G99'],
          },
        ],
        bullets: [
          '5G ready with dual SIM',
          'Fast charging in the box',
          'Optical image stabilisation',
          'In-display fingerprint sensor',
          '2 years of OS updates',
        ],
        returnDays: 7,
        weight: 1.8,
      },
      {
        slug: 'tablets',
        name: 'Tablets',
        brands: ['Nova', 'Pixelon', 'Nimbus', 'Volta'],
        nouns: ['Tablet', 'Wi-Fi Tablet', 'LTE Tablet'],
        adjectives: ['Tab S', 'Pad 6', 'Tab Lite', 'Pad Pro'],
        price: [9_999, 79_999],
        variants: [
          color(['Grey', 'Silver', 'Blue']),
          {
            key: 'storage',
            label: 'Storage',
            values: ['64 GB', '128 GB', '256 GB'],
            priceStep: 0.15,
          },
        ],
        specs: [
          { label: 'Display', values: ['10.1 inch', '11 inch 2K', '12.4 inch AMOLED'] },
          { label: 'Connectivity', key: 'connectivity', values: ['Wi-Fi', 'Wi-Fi + LTE'] },
        ],
        bullets: [
          'Quad speakers',
          'Stylus support',
          'All-day battery',
          'Kids mode',
          'Split-screen multitasking',
        ],
      },
      {
        slug: 'mobile-accessories',
        name: 'Mobile Accessories',
        brands: ['Ampere', 'Volta', 'Shieldz', 'Pebble Audio'],
        nouns: ['Power Bank', 'Fast Charger', 'USB-C Cable', 'Phone Case', 'Tempered Glass'],
        adjectives: ['20000 mAh', '65 W', 'Braided', 'Rugged', 'Slim'],
        price: [199, 3_999],
        variants: [color(['Black', 'White', 'Blue'])],
        specs: [
          { label: 'Compatibility', values: ['Universal', 'USB-C phones', 'iPhone and Android'] },
        ],
        bullets: [
          'BIS certified',
          'Overcharge protection',
          'Compact and travel friendly',
          '6 month warranty',
          'Premium build',
        ],
        weight: 1.2,
      },
    ],
  },
  {
    slug: 'fashion',
    name: 'Fashion',
    gstBp: 1200,
    children: [
      {
        slug: 'mens-tshirts',
        name: "Men's T-Shirts",
        gstBp: 500,
        brands: ['Urbanloom', 'Threadline', 'Kosha', 'Northpeak', 'Rangrez'],
        nouns: ['Round Neck T-Shirt', 'Polo T-Shirt', 'Oversized T-Shirt', 'Graphic T-Shirt'],
        adjectives: ['Cotton', 'Slim Fit', 'Regular Fit', 'Printed', 'Solid'],
        price: [299, 1_999],
        variants: [color(FASHION_COLORS), { key: 'size', label: 'Size', values: SIZES }],
        specs: [
          { label: 'Fabric', key: 'fabric', values: ['100% Cotton', 'Cotton Blend', 'Polyester'] },
          { label: 'Fit', key: 'fit', values: ['Slim', 'Regular', 'Oversized'] },
        ],
        bullets: [
          'Bio-washed for softness',
          'Machine wash',
          'Breathable fabric',
          'Colour-fast',
          'Ribbed collar',
        ],
        returnDays: 10,
        weight: 1.5,
      },
      {
        slug: 'womens-kurtas',
        name: "Women's Kurtas",
        gstBp: 500,
        brands: ['Rangrez', 'Kosha', 'Saanjh', 'Anokhi Threads'],
        nouns: ['Straight Kurta', 'Anarkali Kurta', 'A-Line Kurti', 'Kurta Set'],
        adjectives: ['Printed', 'Embroidered', 'Rayon', 'Cotton', 'Festive'],
        price: [399, 3_499],
        variants: [color(FASHION_COLORS), { key: 'size', label: 'Size', values: SIZES }],
        specs: [
          { label: 'Fabric', key: 'fabric', values: ['Rayon', 'Cotton', 'Georgette'] },
          { label: 'Sleeve', values: ['3/4 Sleeve', 'Full Sleeve', 'Sleeveless'] },
        ],
        bullets: [
          'Hand-block inspired prints',
          'Comfortable all-day wear',
          'Side slits',
          'Dry clean or gentle wash',
          'Pairs with palazzos',
        ],
        returnDays: 10,
        weight: 1.3,
      },
      {
        slug: 'sarees',
        name: 'Sarees',
        gstBp: 500,
        brands: ['Saanjh', 'Anokhi Threads', 'Banarasi Looms', 'Kosha'],
        nouns: ['Silk Saree', 'Cotton Saree', 'Georgette Saree', 'Chiffon Saree'],
        adjectives: ['Woven', 'Printed', 'Zari', 'Handloom', 'Festive'],
        price: [499, 9_999],
        variants: [color(FASHION_COLORS)],
        specs: [
          {
            label: 'Fabric',
            key: 'fabric',
            values: ['Silk Blend', 'Cotton', 'Georgette', 'Chiffon'],
          },
        ],
        bullets: [
          'Comes with unstitched blouse piece',
          '5.5 m saree length',
          'Rich pallu',
          'Dry clean recommended',
          'Gift-ready packaging',
        ],
        returnDays: 10,
      },
      {
        slug: 'sneakers',
        name: 'Sneakers',
        brands: ['Stride', 'Northpeak', 'Kickit', 'Urbanloom'],
        nouns: ['Running Shoes', 'Casual Sneakers', 'Walking Shoes', 'High-Top Sneakers'],
        adjectives: ['Air', 'Flex', 'Cloud', 'Street', 'Trail'],
        price: [699, 8_999],
        variants: [
          color(['Black', 'White', 'Grey', 'Navy']),
          { key: 'size', label: 'Size', values: SHOE_SIZES },
        ],
        specs: [
          { label: 'Sole', values: ['EVA', 'Rubber', 'Phylon'] },
          { label: 'Closure', values: ['Lace-Up', 'Slip-On'] },
        ],
        bullets: [
          'Cushioned midsole',
          'Breathable mesh upper',
          'Anti-skid outsole',
          'Lightweight',
          'Padded collar',
        ],
        returnDays: 10,
        weight: 1.2,
      },
      {
        slug: 'sunglasses',
        name: 'Sunglasses',
        brands: ['Solace', 'Glint', 'Northpeak'],
        nouns: ['Aviator Sunglasses', 'Wayfarer Sunglasses', 'Round Sunglasses'],
        adjectives: ['Polarized', 'UV400', 'Classic', 'Retro'],
        price: [399, 5_999],
        variants: [color(['Black', 'Gold', 'Silver', 'Brown'])],
        specs: [{ label: 'Lens', values: ['Polarized', 'UV400', 'Mirrored'] }],
        bullets: [
          '100% UV protection',
          'Lightweight frame',
          'Hard case included',
          'Unisex design',
          'Scratch-resistant lens',
        ],
        weight: 0.6,
      },
    ],
  },
  {
    slug: 'home-kitchen',
    name: 'Home & Kitchen',
    gstBp: 1800,
    children: [
      {
        slug: 'cookware',
        name: 'Cookware',
        gstBp: 1200,
        brands: ['Tava & Co', 'Handi', 'Ironclad', 'Kitchenkraft'],
        nouns: ['Non-Stick Kadhai', 'Pressure Cooker', 'Tawa', 'Cookware Set', 'Fry Pan'],
        adjectives: ['Induction Base', 'Hard Anodised', 'Granite', 'Triply', 'Cast Iron'],
        price: [399, 6_999],
        variants: [
          { key: 'capacity', label: 'Capacity', values: ['2 L', '3 L', '5 L'], priceStep: 0.2 },
        ],
        specs: [
          {
            label: 'Material',
            key: 'material',
            values: ['Aluminium', 'Stainless Steel', 'Cast Iron'],
          },
        ],
        bullets: [
          'Induction and gas compatible',
          'PFOA free coating',
          'Cool-touch handles',
          'Easy to clean',
          'ISI certified',
        ],
        weight: 1.2,
      },
      {
        slug: 'bedsheets',
        name: 'Bedsheets',
        gstBp: 1200,
        brands: ['Neend', 'Softcraft', 'Kosha Home'],
        nouns: ['Double Bedsheet', 'King Bedsheet', 'Fitted Bedsheet'],
        adjectives: ['Cotton', '210 TC', 'Floral', 'Geometric', 'Jaipuri'],
        price: [399, 3_999],
        variants: [color(['Blue', 'Pink', 'Green', 'Beige', 'Grey'])],
        specs: [{ label: 'Thread Count', values: ['144 TC', '210 TC', '300 TC'] }],
        bullets: [
          'Includes 2 pillow covers',
          'Colour-fast dyes',
          'Soft breathable cotton',
          'Machine washable',
          'Fits up to 8 inch mattress',
        ],
      },
      {
        slug: 'home-decor',
        name: 'Home Décor',
        brands: ['Ghar Sajja', 'Diya Studio', 'Kosha Home'],
        nouns: ['Wall Clock', 'Table Lamp', 'Photo Frame Set', 'Showpiece', 'Artificial Plant'],
        adjectives: ['Modern', 'Vintage', 'Handcrafted', 'Minimal', 'Boho'],
        price: [249, 4_999],
        variants: [color(['Black', 'White', 'Gold', 'Brown'])],
        specs: [
          { label: 'Material', key: 'material', values: ['Wood', 'Metal', 'Ceramic', 'Plastic'] },
        ],
        bullets: [
          'Elegant finish',
          'Gift ready',
          'Easy to mount or place',
          'Durable build',
          'Fits any room',
        ],
      },
      {
        slug: 'storage-containers',
        name: 'Storage Containers',
        brands: ['Kitchenkraft', 'Dabba', 'Freshlock'],
        nouns: ['Airtight Container Set', 'Lunch Box', 'Water Bottle', 'Spice Rack'],
        adjectives: ['BPA Free', 'Steel', 'Glass', 'Insulated'],
        price: [149, 1_999],
        variants: [
          {
            key: 'pack',
            label: 'Pack',
            values: ['Pack of 3', 'Pack of 6', 'Pack of 12'],
            priceStep: 0.6,
          },
        ],
        specs: [
          { label: 'Material', key: 'material', values: ['Plastic', 'Stainless Steel', 'Glass'] },
        ],
        bullets: [
          'Leak proof',
          'Microwave safe (lid off)',
          'Stackable',
          'Dishwasher safe',
          'Food grade',
        ],
      },
    ],
  },
  {
    slug: 'appliances',
    name: 'Appliances',
    gstBp: 1800,
    children: [
      {
        slug: 'refrigerators',
        name: 'Refrigerators',
        brands: ['Himalaya Cool', 'Frostline', 'Orion', 'Kaveri'],
        nouns: [
          'Single Door Refrigerator',
          'Double Door Refrigerator',
          'Side-by-Side Refrigerator',
        ],
        adjectives: ['Frost Free', 'Direct Cool', 'Inverter', 'Convertible'],
        price: [12_999, 1_09_999],
        variants: [
          {
            key: 'capacity',
            label: 'Capacity',
            values: ['190 L', '260 L', '340 L', '600 L'],
            priceStep: 0.3,
          },
        ],
        specs: [
          {
            label: 'Energy Rating',
            key: 'energy',
            values: ['2 Star', '3 Star', '4 Star', '5 Star'],
          },
          { label: 'Compressor', values: ['Inverter', 'Reciprocatory'] },
        ],
        bullets: [
          'Stabiliser-free operation',
          'Toughened glass shelves',
          'Large vegetable crisper',
          '10 year compressor warranty',
          'Quick ice mode',
        ],
        returnDays: 10,
      },
      {
        slug: 'washing-machines',
        name: 'Washing Machines',
        brands: ['Frostline', 'Aqualux', 'Orion', 'Kaveri'],
        nouns: [
          'Front Load Washing Machine',
          'Top Load Washing Machine',
          'Semi-Automatic Washing Machine',
        ],
        adjectives: ['Fully Automatic', 'Inverter', 'Steam Wash', 'Smart'],
        price: [9_999, 64_999],
        variants: [
          {
            key: 'capacity',
            label: 'Capacity',
            values: ['6.5 kg', '7 kg', '8 kg', '9 kg'],
            priceStep: 0.12,
          },
        ],
        specs: [
          { label: 'Energy Rating', key: 'energy', values: ['3 Star', '4 Star', '5 Star'] },
          { label: 'Wash Programs', values: ['8', '12', '15'] },
        ],
        bullets: [
          'In-built heater',
          'Child lock',
          'Quick wash 15 min',
          'Anti-allergen program',
          'Delay start',
        ],
        returnDays: 10,
      },
      {
        slug: 'air-conditioners',
        name: 'Air Conditioners',
        gstBp: 2800,
        brands: ['Himalaya Cool', 'Frostline', 'Polar', 'Aircraft'],
        nouns: ['Split AC', 'Window AC', 'Inverter Split AC'],
        adjectives: ['Copper', '5-in-1 Convertible', 'Wi-Fi', 'Turbo Cool'],
        price: [24_999, 74_999],
        variants: [
          {
            key: 'tonnage',
            label: 'Capacity',
            values: ['1 Ton', '1.5 Ton', '2 Ton'],
            priceStep: 0.18,
          },
        ],
        specs: [{ label: 'Energy Rating', key: 'energy', values: ['3 Star', '5 Star'] }],
        bullets: [
          '100% copper condenser',
          'Cools at 52 °C',
          'Anti-viral filter',
          'Auto clean',
          'Low-noise operation',
        ],
        returnDays: 10,
      },
      {
        slug: 'kitchen-appliances',
        name: 'Kitchen Appliances',
        brands: ['Kitchenkraft', 'Mixwell', 'Brewmaster', 'Tava & Co'],
        nouns: [
          'Mixer Grinder',
          'Air Fryer',
          'Electric Kettle',
          'Induction Cooktop',
          'Microwave Oven',
        ],
        adjectives: ['750 W', 'Digital', 'Smart', 'Compact', 'Turbo'],
        price: [699, 14_999],
        variants: [color(['Black', 'White', 'Red', 'Silver'])],
        specs: [{ label: 'Power', key: 'power', values: ['500 W', '750 W', '1200 W', '1800 W'] }],
        bullets: [
          'ISI marked',
          'Overheat protection',
          '2 year warranty',
          'Easy-clean design',
          'Multiple presets',
        ],
        weight: 1.4,
      },
    ],
  },
  {
    slug: 'beauty',
    name: 'Beauty & Personal Care',
    gstBp: 1800,
    children: [
      {
        slug: 'skincare',
        name: 'Skincare',
        brands: ['Kesar Glow', 'Dewdrop', 'Ayurveda Lane', 'Puremist'],
        nouns: ['Face Wash', 'Moisturiser', 'Sunscreen SPF 50', 'Vitamin C Serum', 'Face Mask'],
        adjectives: ['Hydrating', 'Oil-Control', 'Brightening', 'Ayurvedic', 'Gentle'],
        price: [149, 1_499],
        variants: [
          { key: 'size', label: 'Size', values: ['50 ml', '100 ml', '200 ml'], priceStep: 0.5 },
        ],
        specs: [
          {
            label: 'Skin Type',
            key: 'skin',
            values: ['All Skin Types', 'Oily Skin', 'Dry Skin', 'Sensitive Skin'],
          },
        ],
        bullets: [
          'Dermatologically tested',
          'Paraben free',
          'Cruelty free',
          'Suitable for daily use',
          'Made in India',
        ],
        returnDays: 0,
        weight: 1.3,
      },
      {
        slug: 'grooming',
        name: 'Grooming',
        brands: ['Edge Men', 'Trimline', 'Ampere'],
        nouns: ['Beard Trimmer', 'Hair Dryer', 'Shaving Kit', 'Hair Straightener'],
        adjectives: ['Cordless', 'Pro', 'Titanium', 'Quick Dry'],
        price: [499, 4_999],
        variants: [color(['Black', 'Blue', 'Grey'])],
        specs: [{ label: 'Run Time', values: ['60 min', '90 min', '120 min'] }],
        bullets: [
          'Skin-friendly blades',
          'USB-C charging',
          'Travel lock',
          'Washable head',
          '2 year warranty',
        ],
      },
    ],
  },
  {
    slug: 'sports-fitness',
    name: 'Sports & Fitness',
    gstBp: 1200,
    children: [
      {
        slug: 'fitness-equipment',
        name: 'Fitness Equipment',
        gstBp: 1800,
        brands: ['Ironfit', 'Kasrat', 'Flexon'],
        nouns: ['Yoga Mat', 'Dumbbell Set', 'Resistance Bands', 'Skipping Rope', 'Gym Gloves'],
        adjectives: ['Anti-Slip', 'PVC', 'Adjustable', 'Pro', 'Home Gym'],
        price: [199, 9_999],
        variants: [color(['Black', 'Blue', 'Purple', 'Green'])],
        specs: [{ label: 'Material', key: 'material', values: ['PVC', 'TPE', 'Rubber', 'Steel'] }],
        bullets: [
          'Durable build',
          'Ideal for home workouts',
          'Non-slip grip',
          'Easy to carry',
          'Suitable for beginners',
        ],
      },
      {
        slug: 'cricket',
        name: 'Cricket',
        brands: ['Willowcraft', 'Sixer', 'Kasrat'],
        nouns: [
          'Kashmir Willow Bat',
          'English Willow Bat',
          'Cricket Ball',
          'Batting Gloves',
          'Cricket Kit',
        ],
        adjectives: ['Tennis', 'Leather', 'Junior', 'Pro'],
        price: [299, 14_999],
        variants: [{ key: 'size', label: 'Size', values: ['Size 4', 'Size 6', 'Short Handle'] }],
        specs: [{ label: 'Grade', values: ['Grade 1', 'Grade 2', 'Grade 3'] }],
        bullets: [
          'Pre-knocked',
          'Thick edges',
          'Comfortable grip',
          'Ideal for matches',
          'Comes with cover',
        ],
      },
    ],
  },
  {
    slug: 'books',
    name: 'Books',
    gstBp: 0,
    children: [
      {
        slug: 'fiction',
        name: 'Fiction',
        brands: ['Inkwell Press', 'Monsoon Books', 'Chaupal Publishing'],
        nouns: ['Novel', 'Short Stories', 'Thriller', 'Romance Novel'],
        adjectives: [
          'The Last Monsoon',
          'City of Lamps',
          'Midnight Express',
          'River Song',
          'Paper Kites',
        ],
        price: [149, 899],
        variants: [
          { key: 'format', label: 'Format', values: ['Paperback', 'Hardcover'], priceStep: 0.6 },
        ],
        specs: [
          { label: 'Language', key: 'language', values: ['English', 'Hindi'] },
          { label: 'Pages', values: ['224', '312', '400'] },
        ],
        bullets: [
          'Bestselling author',
          'Gripping storyline',
          'Premium paper',
          'Perfect gift',
          'Award nominee',
        ],
        returnDays: 7,
      },
      {
        slug: 'exam-prep',
        name: 'Exam Preparation',
        brands: ['Toppers Academy', 'Vidya Prakashan', 'Inkwell Press'],
        nouns: ['JEE Guide', 'NEET Practice Book', 'UPSC Handbook', 'CAT Workbook'],
        adjectives: ['2027 Edition', 'Solved Papers', 'Complete', 'Quick Revision'],
        price: [199, 1_299],
        variants: [{ key: 'format', label: 'Format', values: ['Paperback'] }],
        specs: [{ label: 'Language', key: 'language', values: ['English', 'Hindi'] }],
        bullets: [
          'Latest syllabus',
          'Previous year papers',
          'Chapter-wise practice',
          'Detailed solutions',
          'Mock tests included',
        ],
      },
    ],
  },
  {
    slug: 'grocery',
    name: 'Grocery',
    gstBp: 500,
    children: [
      {
        slug: 'staples',
        name: 'Staples',
        brands: ['Annapurna Farms', 'Desi Harvest', 'Kisan Select'],
        nouns: ['Basmati Rice', 'Atta', 'Toor Dal', 'Sugar', 'Mustard Oil'],
        adjectives: ['Premium', 'Organic', 'Classic', 'Everyday'],
        price: [79, 1_499],
        variants: [
          { key: 'weight', label: 'Weight', values: ['1 kg', '5 kg', '10 kg'], priceStep: 1.2 },
        ],
        specs: [{ label: 'Diet', key: 'diet', values: ['Vegetarian'] }],
        bullets: [
          'Farm sourced',
          'Hygienically packed',
          'No added preservatives',
          'Rich in taste',
          'FSSAI certified',
        ],
        returnDays: 0,
        weight: 1.2,
      },
      {
        slug: 'snacks-beverages',
        name: 'Snacks & Beverages',
        gstBp: 1200,
        brands: ['Chatpata', 'Chai Point Co', 'Munchies'],
        nouns: ['Namkeen', 'Masala Chai', 'Green Tea', 'Instant Coffee', 'Cookies'],
        adjectives: ['Classic', 'Spicy', 'Assam', 'Masala', 'Butter'],
        price: [49, 799],
        variants: [
          { key: 'pack', label: 'Pack', values: ['200 g', '500 g', '1 kg'], priceStep: 1 },
        ],
        specs: [{ label: 'Diet', key: 'diet', values: ['Vegetarian'] }],
        bullets: [
          'Crunchy and fresh',
          'Resealable pack',
          'Made with real spices',
          'Great for tea time',
          'FSSAI certified',
        ],
        returnDays: 0,
      },
    ],
  },
  {
    slug: 'toys-baby',
    name: 'Toys & Baby',
    gstBp: 1200,
    children: [
      {
        slug: 'toys',
        name: 'Toys',
        brands: ['Khilona', 'Brightblocks', 'Funskool Jr'],
        nouns: ['Building Blocks', 'Remote Control Car', 'Soft Toy', 'Board Game', 'Puzzle'],
        adjectives: ['Educational', 'Deluxe', 'Mini', 'Mega', 'Classic'],
        price: [199, 4_999],
        variants: [color(['Red', 'Blue', 'Yellow', 'Green'])],
        specs: [{ label: 'Age', key: 'age', values: ['3+ years', '5+ years', '8+ years'] }],
        bullets: [
          'Non-toxic materials',
          'Develops motor skills',
          'Great gift',
          'BIS certified',
          'Durable build',
        ],
      },
      {
        slug: 'baby-care',
        name: 'Baby Care',
        brands: ['Little Lotus', 'Nanhe', 'Softcraft Baby'],
        nouns: ['Diaper Pants', 'Baby Wipes', 'Baby Lotion', 'Feeding Bottle'],
        adjectives: ['Gentle', 'Ultra Soft', 'Rash Free', 'Natural'],
        price: [99, 1_999],
        variants: [{ key: 'size', label: 'Size', values: ['Small', 'Medium', 'Large'] }],
        specs: [{ label: 'Age', key: 'age', values: ['0-6 months', '6-12 months', '12+ months'] }],
        bullets: [
          'Dermatologically tested',
          'Hypoallergenic',
          'Paraben free',
          'Gentle on skin',
          'Paediatrician recommended',
        ],
        returnDays: 0,
      },
    ],
  },
];

export const SELLERS = [
  {
    slug: 'shopsphere-bhiwandi',
    name: 'ShopSphere Retail (Bhiwandi FC)',
    firstParty: true,
    pincode: '421302',
    city: 'Bhiwandi',
    state: 'Maharashtra',
    rating: 47,
    cutoff: 15,
  },
  {
    slug: 'shopsphere-gurugram',
    name: 'ShopSphere Retail (Gurugram FC)',
    firstParty: true,
    pincode: '122001',
    city: 'Gurugram',
    state: 'Haryana',
    rating: 47,
    cutoff: 15,
  },
  {
    slug: 'shopsphere-bengaluru',
    name: 'ShopSphere Retail (Bengaluru FC)',
    firstParty: true,
    pincode: '562114',
    city: 'Hoskote',
    state: 'Karnataka',
    rating: 46,
    cutoff: 15,
  },
  {
    slug: 'gadget-galaxy',
    name: 'Gadget Galaxy',
    firstParty: false,
    pincode: '110006',
    city: 'New Delhi',
    state: 'Delhi',
    rating: 44,
    cutoff: 13,
  },
  {
    slug: 'mumbai-megastore',
    name: 'Mumbai Megastore',
    firstParty: false,
    pincode: '400002',
    city: 'Mumbai',
    state: 'Maharashtra',
    rating: 42,
    cutoff: 14,
  },
  {
    slug: 'chennai-traders',
    name: 'Chennai Traders',
    firstParty: false,
    pincode: '600001',
    city: 'Chennai',
    state: 'Tamil Nadu',
    rating: 41,
    cutoff: 12,
  },
  {
    slug: 'jaipur-crafts',
    name: 'Jaipur Crafts House',
    firstParty: false,
    pincode: '302001',
    city: 'Jaipur',
    state: 'Rajasthan',
    rating: 45,
    cutoff: 13,
  },
  {
    slug: 'kolkata-bazaar',
    name: 'Kolkata Bazaar',
    firstParty: false,
    pincode: '700001',
    city: 'Kolkata',
    state: 'West Bengal',
    rating: 38,
    cutoff: 12,
  },
  {
    slug: 'hyderabad-hub',
    name: 'Hyderabad Electronics Hub',
    firstParty: false,
    pincode: '500001',
    city: 'Hyderabad',
    state: 'Telangana',
    rating: 43,
    cutoff: 14,
  },
  {
    slug: 'pune-style',
    name: 'Pune Style Studio',
    firstParty: false,
    pincode: '411001',
    city: 'Pune',
    state: 'Maharashtra',
    rating: 40,
    cutoff: 13,
  },
  {
    slug: 'lucknow-mart',
    name: 'Lucknow Mart',
    firstParty: false,
    pincode: '226001',
    city: 'Lucknow',
    state: 'Uttar Pradesh',
    rating: 36,
    cutoff: 12,
  },
  {
    slug: 'ahmedabad-deals',
    name: 'Ahmedabad Deals',
    firstParty: false,
    pincode: '380001',
    city: 'Ahmedabad',
    state: 'Gujarat',
    rating: 41,
    cutoff: 14,
  },
];
