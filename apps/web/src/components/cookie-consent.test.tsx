import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '@/lib/analytics';
import { CONSENT_COOKIE, parseConsent, readConsent, serializeConsent } from '@/lib/consent';
import { CookieConsent, CookiePreferencesLink } from './cookie-consent';

const clearCookie = () => {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
};

describe('cookie consent', () => {
  let events: unknown[];
  const onEvent = (e: Event) => events.push((e as CustomEvent).detail);

  beforeEach(() => {
    clearCookie();
    events = [];
    window.addEventListener('ss:analytics', onEvent);
  });
  afterEach(() => {
    window.removeEventListener('ss:analytics', onEvent);
    window.dataLayer = undefined;
  });

  it('round-trips the cookie format and rejects junk', () => {
    expect(parseConsent(serializeConsent({ analytics: true, marketing: false }))).toEqual({
      analytics: true,
      marketing: false,
    });
    expect(parseConsent('v2.a1.m1')).toBeNull();
    expect(parseConsent(undefined)).toBeNull();
  });

  it('sends no analytics before a choice (essential-only default)', () => {
    window.dataLayer = [];
    track('add_to_cart', { sku: 's1' });
    expect(events).toEqual([]);
    expect(window.dataLayer).toEqual([]);
  });

  it('"Essential only" keeps analytics off and hides the banner', () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByTestId('consent-essential'));
    expect(screen.queryByTestId('cookie-banner')).toBeNull();
    expect(readConsent()).toEqual({ analytics: false, marketing: false });
    track('add_to_cart');
    expect(events).toEqual([]);
  });

  it('opting in to analytics through preferences lets events through', () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByTestId('consent-prefs'));
    fireEvent.click(screen.getByTestId('consent-analytics'));
    fireEvent.click(screen.getByTestId('consent-save'));
    expect(readConsent()).toEqual({ analytics: true, marketing: false });
    track('view_cart');
    expect(events).toEqual([{ event: 'view_cart' }]);
  });

  it('stays hidden once chosen and reopens from the footer control', () => {
    document.cookie = `${CONSENT_COOKIE}=v1.a1.m0; Path=/`;
    render(
      <>
        <CookieConsent />
        <CookiePreferencesLink />
      </>,
    );
    expect(screen.queryByTestId('cookie-banner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cookie preferences' }));
    expect(screen.getByTestId('cookie-banner')).toBeTruthy();
    expect((screen.getByTestId('consent-analytics') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId('consent-analytics'));
    fireEvent.click(screen.getByTestId('consent-save'));
    expect(readConsent()?.analytics).toBe(false);
    vi.restoreAllMocks();
  });
});
