// Content-Security-Policy builder shared by the Next.js apps (M7.1, ASVS V14.4.3).
// Kept dependency-free so it runs in the Edge middleware runtime.

/** 128-bit random nonce, base64. */
export function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function origin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * @param {import('./csp.d.mts').CspOptions} o
 * @returns {string}
 */
export function buildCsp(o) {
  const dev = !!o.dev;
  const api = o.apiUrl ? origin(o.apiUrl) : null;
  const insecureLocal = !!api && api.startsWith('http://');
  const script = o.nonce
    ? [`'nonce-${o.nonce}'`, "'strict-dynamic'", "'self'", ...(o.scriptSrc ?? [])]
    : ["'self'", "'unsafe-inline'", ...(o.scriptSrc ?? [])];
  if (dev) script.push("'unsafe-eval'");
  const connect = ["'self'", ...(api ? [api] : []), ...(o.connectSrc ?? [])];
  if (dev) connect.push('ws:', 'wss:');
  const img = ["'self'", 'data:', 'blob:', 'https:', ...(o.imgSrc ?? [])];
  if (insecureLocal || dev) img.push('http://localhost:*', 'http://127.0.0.1:*');
  const directives = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    `frame-src ${(o.frameSrc ?? []).length ? o.frameSrc.join(' ') : "'none'"}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${(o.formAction ?? []).map((x) => ` ${x}`).join('')}`,
    "frame-ancestors 'none'",
  ];
  // Only when the app itself is served over TLS (local E2E runs on plain http://localhost).
  if (!dev && !insecureLocal) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Non-CSP hardening headers every Next app sends. */
export const BASE_SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), usb=(), payment=(self "https://checkout.razorpay.com")',
};
