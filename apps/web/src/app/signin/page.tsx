import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInFlow } from './signin-flow';

export const metadata: Metadata = { title: 'Sign in · ShopSphere' };

export default function SignInPage() {
  return (
    <main className="flex justify-center px-4 py-10">
      <Suspense>
        <SignInFlow />
      </Suspense>
    </main>
  );
}
