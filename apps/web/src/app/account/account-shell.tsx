'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireAuth } from '@/lib/auth';

export function AccountShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <RequireAuth returnTo={pathname}>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </RequireAuth>
  );
}
