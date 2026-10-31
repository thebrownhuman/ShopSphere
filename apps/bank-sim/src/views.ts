import { NETBANKING_USERS, TEST_CARDS, UPI_HANDLES } from './cards';
import type { BankOrder, BankPayment, WebhookDelivery } from './bank.service';

export const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const rupees = (paise: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);

const CSS = `
:root{--ink:#0f1f3d;--navy:#12306b;--gold:#c9a227;--line:#d8dde8;--bg:#f3f5f9;--bad:#b42318;--muted:#5b6b86}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
header{background:var(--navy);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px}
header b{font-size:17px;letter-spacing:.3px}header span{color:var(--gold);font-size:12px;border:1px solid var(--gold);padding:1px 6px;border-radius:3px}
main{max-width:560px;margin:24px auto;padding:0 16px}
.card{background:#fff;border:1px solid var(--line);border-radius:6px;padding:18px;margin-bottom:16px}
.amount{display:flex;justify-content:space-between;align-items:baseline}.amount strong{font-size:24px}
.muted{color:var(--muted);font-size:13px}
details{border-top:1px solid var(--line);padding:12px 0}details:first-of-type{border-top:0}
summary{cursor:pointer;font-weight:600;padding:4px 0}
label{display:block;font-size:13px;margin:10px 0 4px;color:var(--muted)}
input,select{width:100%;padding:10px;border:1px solid var(--line);border-radius:4px;font:inherit}
.row{display:flex;gap:10px}.row>div{flex:1}
button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:4px;background:var(--navy);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.link{background:none;color:var(--navy);width:auto;padding:0;margin:0;text-decoration:underline}
button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
.err{color:var(--bad);font-size:14px;margin:8px 0}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}
code{font-size:12px;background:var(--bg);padding:1px 4px;border-radius:3px}
.inline{display:inline}
`;

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ShopSphere Bank</title><style>${CSS}</style></head>
<body><header><b>ShopSphere Bank</b><span>SIMULATOR</span></header><main>${body}</main></body></html>`;
}

export function errorPage(message: string): string {
  return layout(
    'Error',
    `<div class="card"><h2>Something went wrong</h2><p class="err">${esc(message)}</p></div>`,
  );
}

function hidden(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
}

export function checkoutPage(order: BankOrder, callbackUrl: string, error?: string): string {
  const h = hidden({ order_id: order.id, callback_url: callbackUrl });
  const cards = TEST_CARDS.map(
    (c) =>
      `<tr><td><code>${c.number.replace(/(\d{4})/g, '$1 ').trim()}</code></td><td>${c.network} ${c.type}</td><td>${esc(c.note)}</td></tr>`,
  ).join('');
  return layout(
    'Pay',
    `<div class="card amount"><div><div class="muted">Paying ShopSphere</div><div class="muted">Order ${esc(order.id)}</div></div>
<strong>${rupees(order.amount)}</strong></div>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<div class="card">
<details open><summary>Debit / credit card</summary>
<form method="post" action="/checkout/pay">${h}<input type="hidden" name="method" value="card">
<label for="cn">Card number</label><input id="cn" name="card_number" inputmode="numeric" autocomplete="cc-number" required placeholder="4111 1111 1111 1111">
<div class="row"><div><label for="ce">Expiry (MM/YY)</label><input id="ce" name="expiry" autocomplete="cc-exp" required placeholder="12/30"></div>
<div><label for="cv">CVV</label><input id="cv" name="cvv" inputmode="numeric" autocomplete="cc-csc" required maxlength="4"></div></div>
<label for="cname">Name on card</label><input id="cname" name="name" autocomplete="cc-name" required>
<button>Pay ${rupees(order.amount)}</button></form></details>
<details><summary>Net banking</summary>
<form method="post" action="/checkout/pay">${h}<input type="hidden" name="method" value="netbanking">
<label for="nb">Bank</label><select id="nb" name="bank"><option>ShopSphere Bank</option><option>State Bank (sim)</option><option>HDFC (sim)</option></select>
<label for="nu">Customer ID</label><input id="nu" name="user" required autocomplete="username">
<label for="np">Password</label><input id="np" name="password" type="password" required autocomplete="current-password">
<button>Login and pay</button></form></details>
<details><summary>UPI</summary>
<form method="post" action="/checkout/pay">${h}<input type="hidden" name="method" value="upi">
<label for="vpa">UPI ID</label><input id="vpa" name="vpa" required placeholder="name@ssb">
<button>Send collect request</button></form></details>
</div>
<div class="card"><b>Test controls</b><p class="muted">3-D Secure OTP: <code>123456</code> (anything else fails). Any expiry in the future, any CVV.</p>
<table><thead><tr><th>Card</th><th>Type</th><th>Result</th></tr></thead><tbody>${cards}</tbody></table>
<p class="muted">UPI: ${Object.entries(UPI_HANDLES)
      .map(([k, v]) => `<code>${k}</code> ${v}`)
      .join(', ')}. Net banking customer ID: ${Object.entries(NETBANKING_USERS)
      .map(([k, v]) => `<code>${k}</code> ${v}`)
      .join(', ')}; anything else succeeds.</p>
</div>`,
  );
}

export function otpPage(sessionId: string, amount: number, last4: string, error?: string): string {
  return layout(
    '3-D Secure',
    `<div class="card"><h2>Verify it's you</h2>
<p>An OTP was sent to the mobile number registered with card ending <b>${esc(last4)}</b> for ${rupees(amount)}.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/checkout/otp">${hidden({ session: sessionId })}
<label for="otp">One-time password</label><input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required autofocus>
<button>Submit</button></form><p class="muted">Simulator OTP is 123456.</p></div>`,
  );
}

export function devPage(
  orders: BankOrder[],
  payments: BankPayment[],
  deliveries: WebhookDelivery[],
): string {
  const pay = payments
    .map(
      (
        p,
      ) => `<tr><td><code>${esc(p.id)}</code><br><span class="muted">${esc(p.order_id)}</span></td><td>${esc(p.method)}</td><td>${rupees(p.amount)}</td><td>${esc(p.status)}</td>
<td>${
        p.status === 'created' || p.status === 'authorized'
          ? `<form class="inline" method="post" action="/dev/payments/${esc(p.id)}/resolve"><input type="hidden" name="outcome" value="capture"><button class="link">capture</button></form>
 · <form class="inline" method="post" action="/dev/payments/${esc(p.id)}/resolve"><input type="hidden" name="outcome" value="fail"><button class="link">fail</button></form>`
          : ''
      }</td></tr>`,
    )
    .join('');
  const hooks = deliveries
    .map(
      (
        d,
      ) => `<tr><td><code>${esc(d.eventId)}</code></td><td>${esc(d.event)}</td><td>${d.delivered ? 'delivered' : 'pending'} (${d.attempts}× , ${d.lastStatus ?? '—'})</td>
<td><form class="inline" method="post" action="/dev/webhooks/${esc(d.eventId)}/replay"><button class="link">replay</button></form></td></tr>`,
    )
    .join('');
  return layout(
    'Dev console',
    `<div class="card"><h2>Dev console</h2><p class="muted">${orders.length} orders. Resolve pending payments and replay webhooks (same event id) to test idempotency.</p></div>
<div class="card"><b>Payments</b><table><thead><tr><th>Payment</th><th>Method</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${pay || '<tr><td colspan="5" class="muted">No payments yet</td></tr>'}</tbody></table></div>
<div class="card"><b>Webhooks</b><table><thead><tr><th>Event id</th><th>Event</th><th>Delivery</th><th></th></tr></thead><tbody>${hooks || '<tr><td colspan="4" class="muted">None sent</td></tr>'}</tbody></table></div>`,
  );
}
