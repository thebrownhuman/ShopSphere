/**
 * M7.5 full-journey load test: home → search → PDP → add to cart → checkout → pay through
 * ShopSphere Bank (bank-sim, UPI success@ssb) → verify → poll until the order is CONFIRMED.
 *
 * Load shape (docs/perf/load-test.md): PEAK concurrent shoppers is the stated expected peak;
 * we ramp to PEAK, hold, then ramp to 10 × PEAK and hold. Think time 1–2 s between steps.
 *
 *   corepack pnpm --filter @shopsphere/api k6:journey 300     # writes infra/k6/journey-fixture.json
 *   docker run --rm --add-host host.docker.internal:host-gateway -v "$PWD/infra/k6:/k6" \
 *     -e API_URL=http://host.docker.internal:4310 -e BANK_URL=http://host.docker.internal:4115 \
 *     -e PEAK=20 grafana/k6:1.3.0 run --summary-export /k6/results/run.json /k6/journey.js
 *
 * Env: PEAK (default 20), HOLD (default 2m), VPA (default success@ssb; failure@ssb forces bank
 * declines for the alert drill), RETURN_URL (must be one of the API's CORS_ORIGINS).
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const fixture = JSON.parse(open('./journey-fixture.json'));
const API = __ENV.API_URL || 'http://host.docker.internal:4310';
const BANK = __ENV.BANK_URL || 'http://host.docker.internal:4115';
const RETURN_URL = __ENV.RETURN_URL || 'http://localhost:3140/checkout/return';
const VPA = __ENV.VPA || 'success@ssb';
const PEAK = Number(__ENV.PEAK || 20);
const HOLD = __ENV.HOLD || '2m';

const journeyTime = new Trend('journey_duration', true);
const checkoutTime = new Trend('checkout_to_confirmed', true);
const queueWait = new Trend('waiting_room_wait', true);
const confirmed = new Counter('orders_confirmed');
const failedJourneys = new Counter('journeys_failed');

export const options = {
  scenarios: {
    journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: PEAK },
        { duration: '1m', target: PEAK },
        { duration: '1m', target: PEAK * 10 },
        { duration: HOLD, target: PEAK * 10 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{step:checkout}': ['p(99)<1000'],
    journeys_failed: ['count<10'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

/** Retries connection-level failures only (Docker Desktop port proxy refuses some connects). */
function send(fn) {
  let r = fn();
  for (let i = 0; i < 5 && r.status === 0; i++) {
    sleep(0.2 + Math.random() * 0.3);
    r = fn();
  }
  return r;
}

function think() {
  sleep(1 + Math.random());
}

function fail(step, r) {
  failedJourneys.add(1, { step });
  if (Math.random() < 0.05) console.warn(`${step}: ${r.status} ${String(r.body).slice(0, 160)}`);
}

export default function () {
  const user = fixture.users[(exec.vu.idInTest - 1) % fixture.users.length];
  const product = fixture.products[Math.floor(Math.random() * fixture.products.length)];
  const auth = { authorization: `Bearer ${user.token}` };
  const json = { ...auth, 'content-type': 'application/json' };
  const t0 = Date.now();

  group('browse', () => {
    check(
      send(() => http.get(`${API}/home`, { headers: auth, tags: { step: 'home' } })),
      {
        home: (r) => r.status === 200,
      },
    );
    think();
    check(
      send(() =>
        http.get(`${API}/search?q=${encodeURIComponent(product.term)}`, {
          headers: auth,
          tags: { step: 'search', name: 'GET /search' },
        }),
      ),
      { search: (r) => r.status === 200 },
    );
    think();
    check(
      send(() =>
        http.get(`${API}/products/${product.slug}`, {
          headers: auth,
          tags: { step: 'pdp', name: 'GET /products/:slug' },
        }),
      ),
      { pdp: (r) => r.status === 200 },
    );
    http.get(`${API}/categories`, { tags: { step: 'categories' } });
    think();
  });

  const added = send(() =>
    http.post(
      `${API}/cart/items`,
      JSON.stringify({ sku: product.skuId, sellerId: product.sellerId, qty: 1 }),
      { headers: json, tags: { step: 'cart' } },
    ),
  );
  if (!check(added, { 'add to cart': (r) => r.status === 201 })) return fail('cart', added);
  think();

  const tc = Date.now();
  let session = startCheckout(json, user);
  if (!session) return;
  const s = session.json();
  const patched = send(() =>
    http.patch(
      `${API}/checkout/${s.id}`,
      JSON.stringify({ paymentMethod: { type: 'ONLINE', provider: 'bank' } }),
      { headers: json, tags: { step: 'checkout', name: 'PATCH /checkout/:id' } },
    ),
  );
  if (!check(patched, { 'pay online': (r) => r.status === 200 })) return fail('patch', patched);
  const total = patched.json().totals.totalPaise;
  const placed = send(() =>
    http.post(
      `${API}/checkout/${s.id}/place-order`,
      JSON.stringify({ expectedTotalPaise: total }),
      {
        headers: { ...json, 'idempotency-key': `jr-${s.id}` },
        tags: { step: 'checkout', name: 'POST /checkout/:id/place-order' },
      },
    ),
  );
  if (!check(placed, { 'place order': (r) => r.status === 201 })) return fail('place', placed);
  const orderId = placed.json().orderId;

  const init = send(() =>
    http.post(
      `${API}/payments/${orderId}/initiate`,
      JSON.stringify({ provider: 'bank', returnUrl: RETURN_URL }),
      {
        headers: { ...json, 'idempotency-key': `jr-pay-${orderId}` },
        tags: { step: 'pay', name: 'POST /payments/:id/initiate' },
      },
    ),
  );
  if (!check(init, { initiate: (r) => r.status === 201 || r.status === 200 }))
    return fail('initiate', init);
  const providerOrderId = init.json().providerOrderId;

  // The shopper's browser posts the bank's hosted page; we read the 303 back to the merchant.
  const paid = send(() =>
    http.post(
      `${BANK}/checkout/pay`,
      { order_id: providerOrderId, callback_url: RETURN_URL, method: 'upi', vpa: VPA },
      { redirects: 0, tags: { step: 'bank', name: 'POST bank /checkout/pay' } },
    ),
  );
  const location = paid.headers.Location || paid.headers.location || '';
  const q = parseQuery(location);
  if (!q.signature) {
    // Declined (failure@ssb) comes back with error_code; the failure webhook still reaches the API.
    if (q.error_code) return;
    return fail('bank', paid);
  }
  const verified = send(() =>
    http.post(
      `${API}/payments/${orderId}/verify`,
      JSON.stringify({
        provider: 'bank',
        providerOrderId,
        providerPaymentId: q.payment_id,
        signature: q.signature,
      }),
      { headers: json, tags: { step: 'pay', name: 'POST /payments/:id/verify' } },
    ),
  );
  if (!check(verified, { verify: (r) => r.status === 200 })) return fail('verify', verified);

  for (let i = 0; i < 20; i++) {
    const st = http.get(`${API}/orders/${orderId}/status`, {
      headers: auth,
      tags: { step: 'status', name: 'GET /orders/:id/status' },
    });
    if (st.status === 200 && st.json().status === 'CONFIRMED') {
      confirmed.add(1);
      checkoutTime.add(Date.now() - tc);
      journeyTime.add(Date.now() - t0);
      think();
      return;
    }
    sleep(0.5);
  }
  failedJourneys.add(1, { step: 'confirm' });
}

/** POST /checkout, waiting in the sale-day queue (429 WAITING_ROOM) when the flag is on. */
function startCheckout(json, user) {
  const tq = Date.now();
  for (let i = 0; i < 120; i++) {
    const r = send(() =>
      http.post(`${API}/checkout`, JSON.stringify({ source: 'CART', addressId: user.addressId }), {
        headers: json,
        tags: { step: 'checkout', name: 'POST /checkout' },
        responseCallback: http.expectedStatuses(201, 429),
      }),
    );
    if (r.status === 201) {
      if (i > 0) queueWait.add(Date.now() - tq);
      return r;
    }
    if (r.status !== 429 || r.json().code !== 'WAITING_ROOM') {
      fail('checkout', r);
      return null;
    }
    sleep(Math.min(5, r.json().details.retryAfterSeconds));
  }
  fail('queue', { status: 429, body: 'gave up waiting' });
  return null;
}

function parseQuery(url) {
  const out = {};
  const i = url.indexOf('?');
  if (i < 0) return out;
  for (const part of url.slice(i + 1).split('&')) {
    const [k, v = ''] = part.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return out;
}
