import type { ImageSet } from '@shopsphere/types';

/** Rendition widths produced by the image pipeline (M2.3). */
export const IMAGE_WIDTHS = { thumb: 100, small: 300, medium: 600, large: 1200 } as const;

export interface ImageRow {
  alt: string;
  storageKey: string | null;
  sourceUrl: string | null;
}

/**
 * Builds the URL set for an image. Processed uploads live at
 * `<MEDIA_BASE_URL>/<storageKey>/<width>.webp`; seed placeholders (`sourceUrl`, a path on
 * this API) get `?w=<width>`.
 */
export function imageSet(row: ImageRow, bases: { media: string; api: string }): ImageSet | null {
  if (row.storageKey) {
    const at = (w: number) => `${bases.media}/${row.storageKey}/${w}.webp`;
    return {
      alt: row.alt,
      thumb: at(IMAGE_WIDTHS.thumb),
      small: at(IMAGE_WIDTHS.small),
      medium: at(IMAGE_WIDTHS.medium),
      large: at(IMAGE_WIDTHS.large),
      original: at(IMAGE_WIDTHS.large),
    };
  }
  if (row.sourceUrl) {
    const src = row.sourceUrl.startsWith('http') ? row.sourceUrl : `${bases.api}${row.sourceUrl}`;
    const at = (w: number) => `${src}${src.includes('?') ? '&' : '?'}w=${w}`;
    return {
      alt: row.alt,
      thumb: at(IMAGE_WIDTHS.thumb),
      small: at(IMAGE_WIDTHS.small),
      medium: at(IMAGE_WIDTHS.medium),
      large: at(IMAGE_WIDTHS.large),
      original: src,
    };
  }
  return null;
}

const PALETTE = [
  ['#1e3a8a', '#60a5fa'],
  ['#065f46', '#34d399'],
  ['#7c2d12', '#fb923c'],
  ['#581c87', '#c084fc'],
  ['#831843', '#f472b6'],
  ['#134e4a', '#5eead4'],
  ['#3f3f46', '#a1a1aa'],
  ['#713f12', '#facc15'],
];

const COLOR_HEX: Record<string, string> = {
  black: '#111827',
  white: '#f9fafb',
  blue: '#2563eb',
  red: '#dc2626',
  green: '#16a34a',
  silver: '#cbd5e1',
  grey: '#6b7280',
  gold: '#d4a017',
  pink: '#ec4899',
  purple: '#7c3aed',
  brown: '#78350f',
  beige: '#e7d8c9',
  navy: '#1e3a8a',
  yellow: '#facc15',
  orange: '#f97316',
};

export function colorHex(name: string): string | undefined {
  return COLOR_HEX[name.toLowerCase()];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Generated placeholder artwork (M2.24): a deterministic gradient tile with the product's
 * label and an optional colour swatch. Never scraped product photography.
 */
export function placeholderSvg(seed: string, label: string, width: number, color?: string): string {
  const w = Math.min(1200, Math.max(50, Math.round(width) || 600));
  const [a, b] = PALETTE[hash(seed) % PALETTE.length];
  const words = label.trim().split(/\s+/).slice(0, 6);
  const lines = [words.slice(0, 3).join(' '), words.slice(3).join(' ')].filter(Boolean);
  const swatch = color ? colorHex(color) : undefined;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}" viewBox="0 0 600 600" role="img" aria-label="${esc(label)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/>
<circle cx="300" cy="250" r="${110 + (hash(seed + 'r') % 40)}" fill="${swatch ?? '#ffffff'}" fill-opacity="${swatch ? 0.95 : 0.18}" stroke="#ffffff" stroke-opacity="0.5" stroke-width="6"/>
${lines
  .map(
    (l, i) =>
      `<text x="300" y="${460 + i * 48}" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#ffffff" text-anchor="middle">${esc(l)}</text>`,
  )
  .join('\n')}
</svg>`;
}
