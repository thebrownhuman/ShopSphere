/**
 * Courier network model: pincode prefixes → zone → SLA days and rate card. The API pulls
 * `matrix()` nightly and evaluates the same rules locally for delivery estimates (M5.6a),
 * so keep the rules in the matrix data, not in code paths only this service runs.
 */

export type Zone = 'LOCAL' | 'REGIONAL' | 'METRO' | 'NATIONAL' | 'REMOTE';

export interface ServiceabilityMatrix {
  version: string;
  /** First three digits of metro sorting districts. */
  metroPrefixes: string[];
  /** Regex sources for slow lanes (islands, Ladakh, Sikkim, North-East). */
  remotePatterns: string[];
  /** Regex sources for destinations the courier does not serve at all. */
  unserviceablePatterns: string[];
  slaDays: Record<Zone, number>;
  /** Base rate per zone for the first 500 g, plus each further 500 g slab, paise. */
  ratePaise: Record<Zone, { base: number; perSlab: number }>;
  codFeePaise: number;
}

export const MATRIX: ServiceabilityMatrix = {
  version: '2026-10-v1',
  metroPrefixes: ['110', '400', '560', '600', '700', '500', '411', '380'],
  remotePatterns: ['^744', '^194', '^737', '^7[89]'],
  // Army/field post office pincodes (9xxxxx) are outside the civilian courier network.
  unserviceablePatterns: ['^9'],
  slaDays: { LOCAL: 1, REGIONAL: 2, METRO: 2, NATIONAL: 4, REMOTE: 7 },
  ratePaise: {
    LOCAL: { base: 3_500, perSlab: 1_500 },
    REGIONAL: { base: 4_500, perSlab: 2_000 },
    METRO: { base: 5_000, perSlab: 2_500 },
    NATIONAL: { base: 6_500, perSlab: 3_000 },
    REMOTE: { base: 9_500, perSlab: 4_500 },
  },
  codFeePaise: 3_000,
};

export function isPincode(pin: unknown): pin is string {
  return typeof pin === 'string' && /^[1-9]\d{5}$/.test(pin);
}

export function serviceable(toPin: string, m = MATRIX): boolean {
  return !m.unserviceablePatterns.some((p) => new RegExp(p).test(toPin));
}

export function zoneFor(fromPin: string, toPin: string, m = MATRIX): Zone {
  if (m.remotePatterns.some((p) => new RegExp(p).test(toPin))) return 'REMOTE';
  if (fromPin.slice(0, 3) === toPin.slice(0, 3)) return 'LOCAL';
  if (fromPin.slice(0, 2) === toPin.slice(0, 2)) return 'REGIONAL';
  const metro = new Set(m.metroPrefixes);
  if (metro.has(fromPin.slice(0, 3)) && metro.has(toPin.slice(0, 3))) return 'METRO';
  return 'NATIONAL';
}

export function rateFor(zone: Zone, weightGrams: number, cod: boolean, m = MATRIX): number {
  const slabs = Math.max(1, Math.ceil(weightGrams / 500));
  const r = m.ratePaise[zone];
  return r.base + (slabs - 1) * r.perSlab + (cod ? m.codFeePaise : 0);
}
