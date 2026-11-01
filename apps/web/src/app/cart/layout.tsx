import type { ReactNode } from 'react';

/** Rendered per request so the nonce-based CSP from middleware.ts applies (M7.1). */
export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
