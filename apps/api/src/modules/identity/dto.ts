import { z } from 'zod';

const identifier = z.string().min(3).max(254);
const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
/** PRD §3: min 8 chars. Upper bound keeps Argon2 input sane. */
export const password = z.string().min(8, 'Use at least 8 characters').max(128);
const keepSignedIn = z.boolean().default(false);

export const identifySchema = z.object({ identifier });
export const otpRequestSchema = z.object({ identifier });
export const otpVerifySchema = z.object({ identifier, code: otpCode, keepSignedIn });
export const signupSchema = z.object({
  signupToken: z.string().min(10),
  name: z.string().trim().min(1).max(80),
  password: password.optional(),
});
export const loginSchema = z.object({
  identifier,
  password: z.string().min(1).max(128),
  keepSignedIn,
  captchaToken: z.string().max(4096).optional(),
});
export const mfaSchema = z.object({ mfaToken: z.string().min(10), code: otpCode });
export const forgotSchema = z.object({ identifier });
export const resetSchema = z.object({ identifier, code: otpCode, newPassword: password });

export const profileSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const reauthSchema = z
  .object({
    password: z.string().max(128).optional(),
    otp: otpCode.optional(),
    totp: otpCode.optional(),
  })
  .refine((v) => v.password || v.otp || v.totp, 'Provide password, otp or totp');
export const changePasswordSchema = z.object({ newPassword: password });
export const totpCodeSchema = z.object({ code: otpCode });
export const changeIdentifierRequestSchema = z.object({ identifier });
export const changeIdentifierConfirmSchema = z.object({ identifier, code: otpCode });

export const addressSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number'),
  line1: z.string().trim().min(3).max(200),
  line2: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v ?? null),
  landmark: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v ?? null),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode'),
  type: z.enum(['home', 'work', 'other']).default('home'),
  isDefault: z.boolean().optional(),
});
export const addressUpdateSchema = addressSchema.partial();
