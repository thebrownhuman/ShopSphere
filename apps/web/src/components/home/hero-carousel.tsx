'use client';

import { cx } from '@shopsphere/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Banner } from '@/lib/api/catalog.types';
import { CatalogImage } from '../catalog-image';

const ROTATE_MS = 5000;

/**
 * PRD §4 hero: auto-rotates every 5 s, pauses on hover/focus (and for prefers-reduced-motion),
 * swipe on touch, prev/next + dot controls, every banner links to a listing.
 * Only the first banner is high priority (it is the LCP element).
 */
export function HeroCarousel({ banners }: { banners: Banner[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const n = banners.length;
  const go = useCallback((i: number) => setIndex(((i % n) + n) % n), [n]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setUserPaused(true);
  }, []);

  useEffect(() => {
    if (paused || userPaused || n < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % n), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, userPaused, n]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured offers"
      className="relative overflow-hidden bg-slate-200"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => {
        // Arrow keys move between slides while focus is inside the carousel (M7.4).
        if (e.key === 'ArrowRight') go(index + 1);
        else if (e.key === 'ArrowLeft') go(index - 1);
      }}
      onTouchStart={(e) => (touchX.current = e.touches[0]!.clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0]!.clientX - touchX.current;
        if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      <div
        className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(-${index * 100}%)` }}
        aria-live={paused || userPaused ? 'polite' : 'off'}
      >
        {banners.map((b, i) => (
          <div
            key={b.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${n}: ${b.title}`}
            aria-hidden={i !== index}
            className="relative w-full shrink-0"
          >
            <Link href={b.href} tabIndex={i === index ? 0 : -1} className="block">
              <CatalogImage
                image={b.image}
                priority={i === 0}
                fetchPriority={i === 0 ? 'high' : 'low'}
                loading={i === 0 ? undefined : 'lazy'}
                sizes="100vw"
                className="aspect-[3/1] h-auto w-full object-cover md:aspect-[15/4]"
              />
              <span className="absolute bottom-[18%] left-[6%] max-w-[60%] text-white drop-shadow md:bottom-[30%]">
                <span className="block text-sm font-medium md:text-xl">{b.subtitle}</span>
              </span>
            </Link>
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="absolute left-0 top-0 hidden h-full w-12 items-center justify-center text-4xl text-slate-900/80 hover:bg-white/20 md:flex"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="absolute right-0 top-0 hidden h-full w-12 items-center justify-center text-4xl text-slate-900/80 hover:bg-white/20 md:flex"
          >
            ›
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1">
            <button
              type="button"
              onClick={() => setUserPaused((p) => !p)}
              aria-label={userPaused ? 'Start automatic slide show' : 'Stop automatic slide show'}
              className="mr-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-[10px] text-white"
            >
              {userPaused ? '▶' : '❚❚'}
            </button>
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show slide ${i + 1}: ${b.title}`}
                aria-current={i === index}
                className="flex h-6 min-w-6 items-center justify-center"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    'h-2.5 rounded-full transition-all',
                    i === index ? 'w-6 bg-white' : 'w-2.5 bg-white/60',
                  )}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
