'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { AddedToCartDrawer } from '@/components/cart/added-drawer';
import { CartProvider } from '@/lib/cart';
import { PincodeProvider } from '@/lib/pincode';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <PincodeProvider>
          <CartProvider>
            {children}
            <AddedToCartDrawer />
          </CartProvider>
        </PincodeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
