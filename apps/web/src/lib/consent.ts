/**
 * Cookie consent (M7.3, DPDP Act 2023). Essential cookies (session, cart, CSRF, consent itself)
 * need no consent; analytics and marketing are off until the shopper opts in. The choice lives in
 * a first-party cookie `ss_consent` (`v1.a<0|1>.m<0|1>`, 180 days) so it is readable before any
 * tag would load. Changes dispatch `ss:consent`.
 */
export interface Consent {
  analytics: boolean;
  marketing: boolean;
}

export const CONSENT_COOKIE = 'ss_consent';
export const CONSENT_EVENT = 'ss:consent';
/** Dispatched by "Cookie preferences" links to reopen the banner's preferences. */
export const OPEN_CONSENT_EVENT = 'ss:open-consent';
const MAX_AGE_S = 180 * 24 * 3600;

export function parseConsent(raw: string | undefined | null): Consent | null {
  const m = /^v1\.a([01])\.m([01])$/.exec(raw ?? '');
  return m ? { analytics: m[1] === '1', marketing: m[2] === '1' } : null;
}

export function serializeConsent(c: Consent): string {
  return `v1.a${c.analytics ? 1 : 0}.m${c.marketing ? 1 : 0}`;
}

/** Stored choice, or null when the shopper has not chosen yet. */
export function readConsent(): Consent | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  return parseConsent(raw ? decodeURIComponent(raw) : null);
}

export function writeConsent(c: Consent): void {
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(c)}; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: c }));
}

/** Analytics may run only after an explicit opt-in. */
export function analyticsAllowed(): boolean {
  return readConsent()?.analytics === true;
}
