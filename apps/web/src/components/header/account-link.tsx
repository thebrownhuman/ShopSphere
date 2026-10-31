'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';

/**
 * Greeting from the client auth state, so the header (and every page under it) stays cacheable:
 * reading the `ss_session` cookie in the root layout would make all pages dynamic and defeat ISR.
 */
export function useGreetingName(): string | null {
  const { status, user } = useAuth();
  return status === 'authenticated' ? (user?.name ?? 'there') : null;
}

export function AccountLink() {
  const name = useGreetingName();
  return (
    <Link
      href={name ? '/account' : '/signin'}
      className="rounded px-2 py-1 text-sm hover:outline hover:outline-1 hover:outline-white"
      data-testid="account-link"
    >
      <span className="block text-xs opacity-90">Hello, {name ?? 'Sign in'}</span>
      <span className="font-semibold">Account &amp; Lists</span>
    </Link>
  );
}
