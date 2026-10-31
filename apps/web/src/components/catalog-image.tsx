import Image, { type ImageProps } from 'next/image';
import type { ImageRef } from '@/lib/api/catalog.types';

/**
 * next/image for catalog assets. Generated SVG placeholders are served as-is (the optimizer
 * would rasterise them for no gain); CDN images get responsive WebP/AVIF from the optimizer.
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
      unoptimized={image.url.startsWith('/img/')}
      {...rest}
    />
  );
}
