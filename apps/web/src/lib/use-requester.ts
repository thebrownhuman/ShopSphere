'use client';

import { CHECKOUT_MOCK, type Requester } from './api/checkout';
import { useAuth } from './auth';

/**
 * Bearer requester for checkout/orders. With the mock on, no sign-in is needed so the flow runs
 * without the API; otherwise anonymous shoppers are sent to /signin first (PRD §8 step 1).
 */
export function useRequester(): {
  request: Requester;
  ready: boolean;
  needsSignIn: boolean;
} {
  const { status, request } = useAuth();
  if (CHECKOUT_MOCK) return { request, ready: true, needsSignIn: false };
  return {
    request,
    ready: status === 'authenticated',
    needsSignIn: status === 'anonymous',
  };
}
