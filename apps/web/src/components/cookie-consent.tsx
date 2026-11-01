'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/form';
import { OPEN_CONSENT_EVENT, readConsent, writeConsent, type Consent } from '@/lib/consent';

const ESSENTIAL_ONLY: Consent = { analytics: false, marketing: false };

/**
 * Cookie banner (M7.3). Shown until the shopper chooses; essential-only is the default and
 * rejecting is as easy as accepting. Rendered in the page flow (not an overlay) at the top so it
 * never hides content and is reached early by keyboard and screen-reader users.
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const [choice, setChoice] = useState<Consent>(ESSENTIAL_ONLY);
  const headingId = useId();
  const region = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!readConsent()) setOpen(true);
    const reopen = () => {
      setChoice(readConsent() ?? ESSENTIAL_ONLY);
      setPrefs(true);
      setOpen(true);
      requestAnimationFrame(() => region.current?.focus());
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  if (!open) return null;
  const save = (c: Consent) => {
    writeConsent(c);
    setOpen(false);
    setPrefs(false);
  };

  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-testid="cookie-banner"
      className="border-b border-slate-300 bg-white text-sm text-slate-900 outline-none"
    >
      <div className="mx-auto flex max-w-page flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl">
          <h2 id={headingId} className="font-semibold">
            Cookies on ShopSphere
          </h2>
          <p className="text-slate-700">
            We use essential cookies to keep you signed in and remember your cart. With your
            permission we would also use analytics cookies to improve the store and marketing
            cookies for relevant offers. See our{' '}
            <Link href="/privacy#cookies" className="text-brand-dark underline">
              Privacy Notice
            </Link>
            .
          </p>
          {prefs && (
            <fieldset className="mt-3 space-y-2">
              <legend className="font-semibold">Cookie preferences</legend>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked disabled className="mt-1" />
                <span>
                  <b>Essential</b> (always on): sign-in, cart, security and this choice.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={choice.analytics}
                  onChange={(e) => setChoice({ ...choice, analytics: e.target.checked })}
                  data-testid="consent-analytics"
                />
                <span>
                  <b>Analytics</b>: how the store is used (pages, add-to-cart events).
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={choice.marketing}
                  onChange={(e) => setChoice({ ...choice, marketing: e.target.checked })}
                  data-testid="consent-marketing"
                />
                <span>
                  <b>Marketing</b>: personalised offers and ads.
                </span>
              </label>
            </fieldset>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {prefs ? (
            <Button onClick={() => save(choice)} data-testid="consent-save">
              Save preferences
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setPrefs(true)} data-testid="consent-prefs">
              Preferences
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => save(ESSENTIAL_ONLY)}
            data-testid="consent-essential"
          >
            Essential only
          </Button>
          <Button
            onClick={() => save({ analytics: true, marketing: true })}
            data-testid="consent-accept"
          >
            Accept all
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Footer control that reopens the preferences. */
export function CookiePreferencesLink({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}
    >
      Cookie preferences
    </button>
  );
}
