import type { ProductSummary } from '@/lib/api/catalog.types';

export const tile: ProductSummary = {
  id: 'p1',
  slug: 'sony-wh-1000xm5',
  skuId: 'p1_black',
  title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
  brand: 'Sony',
  image: {
    url: '/img/200/Sony?w=600&h=600',
    alt: 'Sony WH-1000XM5, front view',
    width: 600,
    height: 600,
  },
  rating: 4.4,
  ratingCount: 18432,
  price: 2699000,
  mrp: 3499000,
  plus: true,
  inStock: true,
  deliveryDays: 1,
};
