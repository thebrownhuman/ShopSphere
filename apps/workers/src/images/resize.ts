import sharp from 'sharp';

/** Rendition widths; keep in sync with IMAGE_WIDTHS in apps/api catalog/media.ts. */
export const WIDTHS = [100, 300, 600, 1200] as const;
export type Format = 'webp' | 'avif';

export interface Rendition {
  width: number;
  format: Format;
  contentType: string;
  body: Buffer;
}

/**
 * M2.3: square-pads the original onto white (1:1 product tiles), then renders WebP and AVIF
 * at each width. Never upscales past the source size.
 */
export async function renderImage(original: Buffer): Promise<Rendition[]> {
  const meta = await sharp(original).metadata();
  if (!meta.width || !meta.height) throw new Error('not a readable image');
  const side = Math.max(meta.width, meta.height);
  const square = await sharp(original)
    .rotate()
    .resize(side, side, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: '#ffffff' })
    .toBuffer();
  const out: Rendition[] = [];
  for (const width of WIDTHS) {
    const resized = sharp(square).resize(Math.min(width, side), Math.min(width, side));
    out.push({
      width,
      format: 'webp',
      contentType: 'image/webp',
      body: await resized.clone().webp({ quality: 80 }).toBuffer(),
    });
    out.push({
      width,
      format: 'avif',
      contentType: 'image/avif',
      body: await resized.clone().avif({ quality: 55 }).toBuffer(),
    });
  }
  return out;
}

export function renditionKey(prefix: string, r: Pick<Rendition, 'width' | 'format'>): string {
  return `${prefix}/${r.width}.${r.format}`;
}
