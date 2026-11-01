import type { ReactNode } from 'react';
import { AccountShell } from './account-shell';

/** Rendered per request so the nonce-based CSP from middleware.ts applies (M7.1). */
export const dynamic = 'force-dynamic';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
