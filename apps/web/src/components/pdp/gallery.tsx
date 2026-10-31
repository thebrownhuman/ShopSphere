'use client';

import { cx } from '@shopsphere/ui';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { CatalogImage } from '../catalog-image';
import { usePdp } from './pdp-context';

/**
 * PRD §6 gallery: side thumbnails, hover-zoom on desktop, swipe on touch, full-screen viewer.
 * Images follow the selected variant.
 */
export function Gallery() {
  const { sku } = usePdp();
  const images = sku.images.slice(0, 9);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const touchX = useRef<number | null>(null);
  const image = images[Math.min(index, images.length - 1)]!;
  const go = (i: number) => setIndex((i + images.length) % images.length);

  useEffect(() => setIndex(0), [sku.id]);

  function onMove(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    });
  }

  return (
    <div
      className="flex flex-col-reverse gap-3 lg:sticky lg:top-32 lg:flex-row"
      aria-label="Product images"
      role="region"
    >
      <ul className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Image thumbnails">
        {images.map((img, i) => (
          <li key={img.url} className="shrink-0">
            <button
              type="button"
              onClick={() => setIndex(i)}
              onMouseEnter={() => setIndex(i)}
              aria-label={`Show image ${i + 1} of ${images.length}`}
              aria-current={i === index}
              className={cx(
                'block h-14 w-14 overflow-hidden rounded border-2 bg-white',
                i === index ? 'border-brand-dark' : 'border-slate-200',
              )}
            >
              <CatalogImage image={img} sizes="56px" className="h-full w-full object-contain" />
            </button>
          </li>
        ))}
      </ul>
      <div
        className="relative flex-1 cursor-zoom-in overflow-hidden rounded bg-white"
        onMouseMove={onMove}
        onMouseLeave={() => setZoom(null)}
        onTouchStart={(e) => (touchX.current = e.touches[0]!.clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0]!.clientX - touchX.current;
          if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
          touchX.current = null;
        }}
      >
        <button
          type="button"
          className="block w-full"
          onClick={() => dialog.current?.showModal()}
          aria-label="Open full-screen image viewer"
        >
          <CatalogImage
            image={image}
            priority
            fetchPriority="high"
            sizes="(min-width: 1024px) 38vw, 100vw"
            className="aspect-square w-full object-contain"
            data-testid="gallery-main"
          />
        </button>
        {zoom && (
          // Desktop hover-zoom: 2.2x magnified copy following the cursor (pointer devices only).
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden bg-white bg-no-repeat [@media(hover:hover)]:block"
            style={{
              backgroundImage: `url("${image.url}")`,
              backgroundSize: '220%',
              backgroundPosition: `${zoom.x}% ${zoom.y}%`,
            }}
          />
        )}
      </div>
      <dialog
        ref={dialog}
        aria-label="Full-screen image viewer"
        className="m-0 h-full max-h-none w-full max-w-none bg-white p-0"
      >
        <div className="flex h-full flex-col">
          <div className="flex justify-end p-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="rounded px-3 py-1 text-3xl"
              aria-label="Close viewer"
            >
              ×
            </button>
          </div>
          <div className="relative flex flex-1 items-center justify-center overflow-hidden">
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous image"
              className="absolute left-2 z-10 rounded-full bg-white/90 px-3 py-2 text-3xl shadow"
            >
              ‹
            </button>
            <CatalogImage
              image={image}
              sizes="100vw"
              className="max-h-full w-auto max-w-full object-contain"
            />
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next image"
              className="absolute right-2 z-10 rounded-full bg-white/90 px-3 py-2 text-3xl shadow"
            >
              ›
            </button>
          </div>
          <p className="p-3 text-center text-sm" aria-live="polite">
            {index + 1} / {images.length}
          </p>
        </div>
      </dialog>
    </div>
  );
}
