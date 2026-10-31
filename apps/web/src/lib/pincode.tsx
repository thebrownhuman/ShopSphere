'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/** Delivery pincode drives delivery dates site-wide (PRD §4). Guests keep it in a cookie. */
export const DEFAULT_PINCODE = '560001';
const COOKIE = 'ss_pin';

interface PincodeCtx {
  pincode: string;
  /** True once the shopper picked a pincode (vs the default). */
  chosen: boolean;
  setPincode: (pin: string) => void;
}

const Ctx = createContext<PincodeCtx>({
  pincode: DEFAULT_PINCODE,
  chosen: false,
  setPincode: () => {},
});

export const isValidPincode = (pin: string) => /^[1-9]\d{5}$/.test(pin);

export function PincodeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ pincode: DEFAULT_PINCODE, chosen: false });

  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )ss_pin=(\d{6})/);
    if (m?.[1]) setState({ pincode: m[1], chosen: true });
  }, []);

  const setPincode = useCallback((pin: string) => {
    if (!isValidPincode(pin)) return;
    document.cookie = `${COOKIE}=${pin}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setState({ pincode: pin, chosen: true });
  }, []);

  return <Ctx.Provider value={{ ...state, setPincode }}>{children}</Ctx.Provider>;
}

export const usePincode = () => useContext(Ctx);
