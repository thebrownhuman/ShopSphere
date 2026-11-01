import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as mockApi from '@/lib/api/checkout.mock';
import type { CheckoutSession, PriceBreakdown as Breakdown } from '@/lib/api/checkout.types';
import { resetMockStore } from '@/lib/api/orders.mock';
import { viewFor } from './order-result';
import { PriceBreakdown } from './price-breakdown';
import { AddressStep, PaymentStep, ReviewStep } from './steps';

const params = new URLSearchParams();
const router = { replace: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useSearchParams: () => params, useRouter: () => router }));
vi.mock('@/lib/use-requester', () => ({
  useRequester: () => ({ request: vi.fn(), ready: true, needsSignIn: false }),
}));
// Route the real data layer to the mock implementation regardless of env.
vi.mock('@/lib/api/checkout', async () => {
  const m = await import('@/lib/api/checkout.mock');
  return {
    CHECKOUT_MOCK: true,
    BUY_NOW_PREVIEW_KEY: 'ss_buy_now_preview',
    checkoutApi: () => ({
      create: m.createCheckout,
      update: m.updateCheckout,
      placeOrder: (id: string, total: number) => m.placeOrder(id, total),
      initiatePayment: m.initiatePayment,
      verifyRedirect: async () => undefined,
      status: m.getOrderStatus,
    }),
  };
});

const price: Breakdown = {
  items: 259_800,
  mrp: 300_000,
  delivery: 0,
  discount: 20_000,
  giftCard: 10_000,
  codFee: 0,
  total: 229_800,
  savings: 60_200,
};

beforeEach(() => resetMockStore());

describe('PriceBreakdown', () => {
  it('shows each PRD §8 line and the GST-inclusive total', () => {
    render(<PriceBreakdown price={price} itemCount={2} />);
    const box = screen.getByTestId('price-breakdown');
    expect(within(box).getByText('Items (2)').nextSibling).toHaveTextContent('₹2,598');
    expect(within(box).getByText('Delivery').nextSibling).toHaveTextContent('FREE');
    expect(within(box).getByText('Coupon / bank offer').nextSibling).toHaveTextContent('−₹200');
    expect(within(box).getByText('Gift card applied').nextSibling).toHaveTextContent('−₹100');
    expect(within(box).queryByText('COD fee')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-total')).toHaveTextContent('₹2,298');
    expect(box).toHaveTextContent('You save ₹602');
  });

  it('adds the COD fee and hides empty deductions', () => {
    render(
      <PriceBreakdown
        price={{ ...price, discount: 0, giftCard: 0, codFee: 1_000, delivery: 4_000, savings: 0 }}
        itemCount={1}
      />,
    );
    expect(screen.getByText('COD fee').nextSibling).toHaveTextContent('₹10');
    expect(screen.getByText('Delivery').nextSibling).toHaveTextContent('₹40');
    expect(screen.queryByText('Coupon / bank offer')).not.toBeInTheDocument();
    expect(screen.queryByText(/You save/)).not.toBeInTheDocument();
  });
});

const session = () => mockApi.createCheckout({ type: 'CART' });

describe('AddressStep', () => {
  it('flags undeliverable items and removes them', async () => {
    let s = await session();
    s = await mockApi.updateCheckout(s.id, {
      newAddress: {
        name: 'A',
        phone: '+919999999999',
        line1: 'x',
        line2: null,
        landmark: null,
        city: 'Port Blair',
        state: 'Andaman',
        pincode: '944001',
        type: 'HOME',
      },
    });
    const apply = vi.fn(async () => null);
    render(<AddressStep session={s} apply={apply} onDone={vi.fn()} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Some items can't be delivered to 944001");
    expect(alert).toHaveTextContent('Milton Thermosteel Flask 1 L');
    expect(screen.getByRole('button', { name: 'Deliver here' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove undeliverable items' }));
    expect(apply).toHaveBeenCalledWith({ removeLineIds: ['line-2'] });
  });

  it('switches saved address', async () => {
    const s = await session();
    const apply = vi.fn(async () => null);
    render(<AddressStep session={s} apply={apply} onDone={vi.fn()} />);
    await userEvent.click(screen.getAllByRole('radio')[1]!);
    expect(apply).toHaveBeenCalledWith({ addressId: 'addr-work' });
  });
});

describe('PaymentStep', () => {
  it('offers ShopSphere Bank, Razorpay (disabled without keys), COD and gift card', async () => {
    const s = await session();
    const apply = vi.fn(async () => null);
    render(<PaymentStep session={s} apply={apply} onDone={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /ShopSphere Bank/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Razorpay/ })).toBeDisabled();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Gift card balance/ })).toBeDisabled();
    // No card fields on our page, ever.
    expect(screen.queryByLabelText(/card number|cvv/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Cash on Delivery/ }));
    expect(apply).toHaveBeenCalledWith({ paymentMethod: 'COD' });
  });

  it('shows the server message for a rejected coupon', async () => {
    const s = await session();
    const apply = vi.fn(async () => 'Coupon NOPE is not valid');
    render(<PaymentStep session={s} apply={apply} onDone={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Coupon code'), 'NOPE');
    await userEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0]!);
    expect(apply).toHaveBeenCalledWith({ couponCode: 'NOPE' });
    expect(await screen.findByText('Coupon NOPE is not valid')).toBeInTheDocument();
  });
});

describe('ReviewStep', () => {
  it('lists shipments per seller and changes the delivery option', async () => {
    const s: CheckoutSession = await session();
    const apply = vi.fn(async () => null);
    render(<ReviewStep session={s} apply={apply} />);
    const shipments = screen.getAllByTestId('shipment');
    expect(shipments).toHaveLength(2);
    expect(shipments[1]).toHaveTextContent('Sold by Kitchen Mart');
    expect(within(shipments[1]!).queryByText(/Scheduled slot/)).not.toBeInTheDocument();
    await userEvent.click(within(shipments[0]!).getByRole('radio', { name: /One-day delivery/ }));
    expect(apply).toHaveBeenCalledWith({
      delivery: { shipmentId: 'shp-1', speed: 'ONE_DAY', slot: undefined },
    });
  });
});

describe('CheckoutFlow', () => {
  it('opens on Review with defaults, applies a coupon and asks to confirm a price change', async () => {
    params.set('mockPriceChange', '1');
    const { CheckoutFlow } = await import('./checkout-flow');
    render(<CheckoutFlow />);
    const cta = await screen.findByTestId('place-order');
    expect(screen.getByTestId('step-3')).toHaveAttribute('data-open', 'true');
    expect(cta).toHaveTextContent('Pay ₹18,797');

    await userEvent.click(screen.getByRole('button', { name: 'Change Payment method' }));
    await userEvent.type(screen.getByLabelText('Coupon code'), 'save200');
    await userEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0]!);
    await waitFor(() => expect(screen.getByTestId('order-total')).toHaveTextContent('₹18,597'));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await userEvent.click(screen.getByTestId('place-order'));
    const dialog = await screen.findByRole('dialog', { name: 'Prices have changed' });
    expect(within(dialog).getByTestId('price-changes')).toHaveTextContent('₹16,999.00 → ₹17,099');
    expect(dialog).toHaveTextContent('New total ₹18,697');
    expect(screen.getByTestId('place-order')).toHaveTextContent('Pay ₹18,697');
    params.delete('mockPriceChange');
  });
});

describe('result view', () => {
  const s = {
    orderId: 'o',
    orderNumber: 'OD1',
    amount: 1,
    failureReason: null,
    retryUntil: null,
  } as const;
  it('maps order status to confirming / confirmed / pending / failed', () => {
    expect(viewFor(null, 0)).toBe('confirming');
    expect(viewFor({ ...s, status: 'PENDING_PAYMENT', paymentState: 'PENDING' }, 1_000)).toBe(
      'confirming',
    );
    expect(viewFor({ ...s, status: 'PENDING_PAYMENT', paymentState: 'PENDING' }, 25_000)).toBe(
      'pending',
    );
    expect(viewFor({ ...s, status: 'CONFIRMED', paymentState: 'PAID' }, 0)).toBe('confirmed');
    expect(viewFor({ ...s, status: 'PAYMENT_FAILED', paymentState: 'FAILED' }, 0)).toBe('failed');
  });
});
