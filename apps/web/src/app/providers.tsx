'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { PincodeProvider } from '@/lib/pincode';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <PincodeProvider>{children}</PincodeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
