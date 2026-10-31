import { HttpStatus } from '@nestjs/common';
import { AppError } from '../shared/errors/app-error';

export type IdentifierType = 'email' | 'phone';

export interface Identifier {
  type: IdentifierType;
  /** Normalised: lowercased email or +91XXXXXXXXXX. */
  value: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts an email or an Indian mobile number (10 digits, optional +91 / 0 prefix). */
export function parseIdentifier(raw: string): Identifier {
  const input = raw.trim();
  if (input.includes('@')) {
    if (!EMAIL.test(input)) throw invalid();
    return { type: 'email', value: input.toLowerCase() };
  }
  const digits = input.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) throw invalid();
  return { type: 'phone', value: `+91${digits}` };
}

/** Mask for display in notifications: s****@gmail.com, +91******3210. */
export function maskIdentifier({ type, value }: Identifier): string {
  if (type === 'phone') return `${value.slice(0, 3)}******${value.slice(-4)}`;
  const [local, domain] = value.split('@');
  return `${local[0]}****@${domain}`;
}

function invalid() {
  return new AppError(
    'INVALID_IDENTIFIER',
    'Enter a valid email or 10-digit mobile number',
    HttpStatus.BAD_REQUEST,
  );
}
