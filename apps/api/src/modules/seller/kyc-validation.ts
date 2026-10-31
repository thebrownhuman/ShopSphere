import type { KycIssue } from '@shopsphere/types';

/**
 * KYC format checks (M5.1). Simulation only: formats and checksums are real, nothing is looked up
 * against NSDL/GSTN.
 */

/** PAN: 5 letters, 4 digits, 1 letter; 4th char is the holder type (P person, C company, ...). */
const PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/;
/** GSTIN: 2-digit state code + PAN + entity number + 'Z' + check character. */
const GSTIN_RE = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/;
/** IFSC: 4-letter bank code, '0', 6-char branch code. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GST state codes (CBIC list) → state / UT names as used in the pincode directory. */
export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

export const normalizeId = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');

export function isValidPan(pan: string): boolean {
  return PAN_RE.test(pan);
}

/** GSTIN check character: base-36 weighted sum (weights alternate 1, 2) over the first 14 chars. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidIfsc(ifsc: string): boolean {
  return IFSC_RE.test(ifsc);
}

/** Validates PAN, GSTIN and their consistency with each other and the pickup state. */
export function validateTaxIds(input: {
  pan?: string | null;
  gstin?: string | null;
  pickupState?: string | null;
}): KycIssue[] {
  const issues: KycIssue[] = [];
  const pan = input.pan ? normalizeId(input.pan) : null;
  const gstin = input.gstin ? normalizeId(input.gstin) : null;
  if (pan && !isValidPan(pan)) {
    issues.push({ field: 'pan', message: 'PAN must look like ABCPE1234F' });
  }
  if (gstin) {
    const m = GSTIN_RE.exec(gstin);
    if (!m) {
      issues.push({ field: 'gstin', message: 'GSTIN must be 15 characters, e.g. 27ABCPE1234F1Z5' });
    } else {
      const [, state, gstPan] = m;
      if (!GST_STATE_CODES[state]) {
        issues.push({ field: 'gstin', message: `Unknown GST state code ${state}` });
      }
      if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
        issues.push({ field: 'gstin', message: 'GSTIN check digit does not match' });
      }
      if (pan && gstPan !== pan) {
        issues.push({ field: 'gstin', message: 'GSTIN must contain your PAN' });
      }
      const pickup = input.pickupState?.trim().toLowerCase();
      if (pickup && GST_STATE_CODES[state] && GST_STATE_CODES[state].toLowerCase() !== pickup) {
        issues.push({
          field: 'gstin',
          message: `GSTIN is registered in ${GST_STATE_CODES[state]} but pickup is in ${input.pickupState}`,
        });
      }
    }
  }
  return issues;
}

/** Builds a valid GSTIN for a PAN (tests, seed, E2E). */
export function makeGstin(stateCode: string, pan: string, entity = '1'): string {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstinCheckChar(first14);
}
