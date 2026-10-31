import Image, { type ImageProps } from 'next/image';
import type { ImageRef } from '@/lib/api/catalog.types';

/**
 * next/image for catalog assets. Served as-is (unoptimized) when the optimizer adds nothing:
 * generated SVG placeholders, and API/CDN media, which the image pipeline (M2.3) already
 * resizes to WebP buckets. Same-origin raster images still go through the optimizer.
 */
export function CatalogImage({
  image,
  ...rest
}: { image: ImageRef } & Omit<ImageProps, 'src' | 'alt' | 'width' | 'height'> & {
    width?: number;
    height?: number;
  }) {
  return (
    <Image
      src={image.url}
      alt={image.alt}
      width={image.width}
      height={image.height}
      unoptimized={/^https?:\/\/|^\/img\/|\.svg(\?|$)/.test(image.url)}
      {...rest}
    />
  );
}
