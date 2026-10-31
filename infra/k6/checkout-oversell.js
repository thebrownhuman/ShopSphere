/**
 * M4.33 oversell load test: N concurrent shoppers (default 500) each try to buy 1 unit of an item
 * with 10 in stock (Buy Now → COD → place order). Pass = exactly STOCK orders, everyone else gets
 * OUT_OF_STOCK, no 5xx. `scripts/k6-oversell.ts verify` then checks the database (0 negative stock).
 *
 *   corepack pnpm --filter @shopsphere/api k6:setup     # writes infra/k6/oversell-fixture.json
 *   docker run --rm -i --add-host host.docker.internal:host-gateway \
 *     -v "$PWD/infra/k6:/k6" -e API_URL=http://host.docker.internal:4210 \
 *     grafana/k6:1.3.0 run /k6/checkout-oversell.js
 *   corepack pnpm --filter @shopsphere/api k6:verify
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import exec from 'k6/execution';

const fixture = JSON.parse(open('./oversell-fixture.json'));
const API = __ENV.API_URL || 'http://host.docker.internal:4210';

const created = new Counter('orders_created');
const soldOut = new Counter('orders_out_of_stock');
const unexpected = new Counter('unexpected_responses');

export const options = {
  scenarios: {
    rush: {
      executor: 'per-vu-iterations',
      vus: fixture.users.length,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  thresholds: {
    orders_created: [`count==${fixture.stock}`],
    unexpected_responses: ['count==0'],
  },
};

/**
 * Retries only connection-level failures (status 0): with 500 simultaneous connects the Docker
 * Desktop port proxy refuses some, which says nothing about the API. Real clients retry too.
 */
function send(fn) {
  let r = fn();
  for (let i = 0; i < 8 && r.status === 0; i++) {
    sleep(0.2 + Math.random() * 0.5);
    r = fn();
  }
  return r;
}

export default function () {
  const user = fixture.users[exec.vu.idInTest - 1];
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${user.token}` };

  const session = send(() =>
    http.post(
      `${API}/checkout`,
      JSON.stringify({
        source: 'BUY_NOW',
        skuId: fixture.skuId,
        qty: 1,
        addressId: user.addressId,
      }),
      { headers },
    ),
  );
  if (!check(session, { 'checkout created': (r) => r.status === 201 })) {
    unexpected.add(1);
    return;
  }
  const s = session.json();
  const patched = send(() =>
    http.patch(`${API}/checkout/${s.id}`, JSON.stringify({ paymentMethod: { type: 'COD' } }), {
      headers,
    }),
  );
  if (!check(patched, { 'cod selected': (r) => r.status === 200 })) {
    unexpected.add(1);
    return;
  }
  const total = patched.json().totals.totalPaise;
  // Same Idempotency-Key on retry, so a retried place-order can never create a second order.
  const placed = send(() =>
    http.post(
      `${API}/checkout/${s.id}/place-order`,
      JSON.stringify({ expectedTotalPaise: total }),
      {
        headers: { ...headers, 'idempotency-key': `k6-${user.userId}` },
      },
    ),
  );
  if (placed.status === 201) {
    created.add(1);
  } else if (isSoldOut(placed)) {
    soldOut.add(1);
  } else {
    unexpected.add(1);
    console.warn(`unexpected ${placed.status}: ${String(placed.body).slice(0, 200)}`);
  }
}

/** Lost the race at reservation (409), or the re-quote already saw no stock (422). */
function isSoldOut(r) {
  if (r.status === 409) return r.json().code === 'OUT_OF_STOCK';
  if (r.status !== 422) return false;
  const body = r.json();
  return (
    body.code === 'CHECKOUT_INVALID' &&
    body.details.issues.every(
      (i) => i.code === 'LINE_ISSUE' && /OUT_OF_STOCK|LIMITED/.test(i.message),
    )
  );
}
