import type { CourierTrackingStatus, CourierWebhookEvent } from '@shopsphere/types';
import { z } from 'zod';
import { hmacSha256Hex, signaturesMatch } from '../../payment/providers/signature';
import type {
  BookedShipment,
  CourierProvider,
  CreateShipmentInput,
  RateInput,
  RateQuote,
  ServiceabilityMatrix,
  TrackingSnapshot,
} from './courier-provider';
import { CourierError } from './courier-provider';

const STATUSES = ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
const webhookSchema = z.object({
  eventId: z.string().min(1).max(100),
  awb: z.string().min(1).max(40),
  reference: z.string().min(1).max(64),
  status: z.enum(STATUSES),
  sequence: z.number().int().positive(),
  location: z.string().max(200).nullable().default(null),
  occurredAt: z.string().datetime(),
});

export interface CourierSimOptions {
  apiUrl: string;
  apiKey: string;
  webhookSecret: string;
}

/** HTTP adapter for apps/courier-sim. */
export class CourierSimProvider implements CourierProvider {
  readonly name = 'courier-sim';

  constructor(private readonly opts: CourierSimOptions) {}

  protected async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.opts.apiUrl}${path}`, {
        method,
        headers: { 'x-api-key': this.opts.apiKey, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new CourierError(`courier unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new CourierError(detail?.error ?? `courier HTTP ${res.status}`, res.status);
    }
    return res;
  }

  private async json<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    return (await (await this.call(method, path, body)).json()) as T;
  }

  async rate(input: RateInput): Promise<RateQuote> {
    const r = await this.json<RateQuote>('POST', '/rates', input);
    return r.serviceable
      ? { serviceable: true, zone: r.zone, slaDays: r.slaDays, ratePaise: r.ratePaise }
      : { serviceable: false };
  }

  async createShipment(input: CreateShipmentInput): Promise<BookedShipment> {
    const r = await this.json<BookedShipment>('POST', '/shipments', { ...input });
    return { awb: r.awb, ratePaise: r.ratePaise, slaDays: r.slaDays };
  }

  async label(awb: string): Promise<Buffer> {
    const res = await this.call('GET', `/shipments/${encodeURIComponent(awb)}/label`);
    return Buffer.from(await res.arrayBuffer());
  }

  async track(awb: string): Promise<TrackingSnapshot> {
    const r = await this.json<{
      awb: string;
      events: {
        eventId: string;
        status: CourierTrackingStatus;
        sequence: number;
        location: string;
        occurredAt: string;
      }[];
    }>('GET', `/shipments/${encodeURIComponent(awb)}`);
    return { awb: r.awb, events: r.events };
  }

  async serviceability(): Promise<ServiceabilityMatrix> {
    const m = await this.json<ServiceabilityMatrix>('GET', '/serviceability/matrix');
    return {
      version: m.version,
      metroPrefixes: m.metroPrefixes,
      remotePatterns: m.remotePatterns,
      unserviceablePatterns: m.unserviceablePatterns,
      slaDays: m.slaDays,
    };
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): CourierWebhookEvent | null {
    const sig = headers['x-courier-signature'];
    if (!signaturesMatch(hmacSha256Hex(this.opts.webhookSecret, rawBody), sig as string)) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return null;
    }
    const r = webhookSchema.safeParse(parsed);
    return r.success ? r.data : null;
  }
}
