import sharp from 'sharp';
import { renderImage, renditionKey, WIDTHS } from './resize';

describe('renderImage', () => {
  it('renders square WebP and AVIF at every width, padding non-square input', async () => {
    const original = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: { r: 200, g: 30, b: 30 } },
    })
      .png()
      .toBuffer();
    const out = await renderImage(original);
    expect(out).toHaveLength(WIDTHS.length * 2);
    for (const r of out) {
      const meta = await sharp(r.body).metadata();
      expect(meta.width).toBe(r.width);
      expect(meta.height).toBe(r.width);
      expect(meta.format).toBe(r.format === 'webp' ? 'webp' : 'heif');
    }
  }, 30_000);

  it('does not upscale small sources', async () => {
    const small = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#00f' },
    })
      .jpeg()
      .toBuffer();
    const large = (await renderImage(small)).find((r) => r.width === 1200 && r.format === 'webp')!;
    expect((await sharp(large.body).metadata()).width).toBe(200);
  });

  it('builds rendition keys under the image prefix', () => {
    expect(renditionKey('products/abc', { width: 300, format: 'avif' })).toBe(
      'products/abc/300.avif',
    );
  });

  it('rejects non-images', async () => {
    await expect(renderImage(Buffer.from('not an image'))).rejects.toThrow();
  });
});
