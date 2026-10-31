'use client';

import type { PickupAddress, SellerAccountView } from '@shopsphere/types';
import { Badge, Button, SectionCard } from '@shopsphere/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Field } from '@/components/field';
import { api, ApiCallError } from '@/lib/api';
import { useSeller } from '@/lib/seller-context';

const EMPTY_PICKUP: PickupAddress = {
  name: '',
  phone: '',
  line1: '',
  line2: null,
  city: '',
  state: '',
  pincode: '',
};

/** Seller sign-up + KYC (M5.1): business details, bank penny drop, submit for approval. */
export default function OnboardingPage() {
  const { account } = useSeller();
  if (!account) return <Register />;
  if (account.status === 'APPROVED') {
    return (
      <SectionCard title="You're approved">
        <p className="mb-4 text-sm">Your seller account is live. Start listing products.</p>
        <Link href="/listings/new" className="text-brand-dark underline">
          Add your first listing
        </Link>
      </SectionCard>
    );
  }
  if (account.status === 'SUBMITTED') {
    return (
      <SectionCard title="Application under review">
        <p className="text-sm text-slate-700">
          We&apos;re verifying your documents. This usually takes one working day.
        </p>
        <p className="mt-2 text-sm">
          Application id: <code data-testid="application-id">{account.id}</code>
        </p>
      </SectionCard>
    );
  }
  return <Kyc account={account} />;
}

function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(err.message);
        setFields(err.fieldErrors);
      } else setError('Something went wrong');
    } finally {
      setBusy(false);
    }
  }
  return { error, fields, busy, run };
}

function Register() {
  const { setAccount } = useSeller();
  const [displayName, setDisplayName] = useState('');
  const { error, fields, busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () =>
      setAccount(
        await api<SellerAccountView>('/seller/register', { method: 'POST', json: { displayName } }),
      ),
    );
  };
  return (
    <div className="mx-auto max-w-lg">
      <SectionCard title="Start selling on ShopSphere">
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Store display name"
            hint="Shown to customers as the seller name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={fields.displayName}
            required
          />
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy}>
            Create seller account
          </Button>
        </form>
      </SectionCard>
    </div>
  );
}

function Kyc({ account }: { account: SellerAccountView }) {
  const { setAccount } = useSeller();
  const [legalName, setLegalName] = useState(account.legalName ?? '');
  const [pan, setPan] = useState(account.pan ?? '');
  const [gstin, setGstin] = useState(account.gstin ?? '');
  const [pickup, setPickup] = useState<PickupAddress>(account.pickup ?? EMPTY_PICKUP);
  const [bank, setBank] = useState({ holderName: '', accountNumber: '', ifsc: '' });
  const details = useSubmit();
  const bankForm = useSubmit();
  const submitForm = useSubmit();
  const [saved, setSaved] = useState(false);

  const pick = (k: keyof PickupAddress) => ({
    value: pickup[k] ?? '',
    onChange: (e: { target: { value: string } }) => setPickup({ ...pickup, [k]: e.target.value }),
    error: details.fields[`pickup.${k}`],
  });

  const saveDetails = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void details.run(async () => {
      setAccount(
        await api<SellerAccountView>('/seller/kyc', {
          method: 'PATCH',
          json: { legalName, pan, gstin, pickup: { ...pickup, line2: pickup.line2 || null } },
        }),
      );
      setSaved(true);
    });
  };
  const verifyBank = (e: FormEvent) => {
    e.preventDefault();
    void bankForm.run(async () =>
      setAccount(await api<SellerAccountView>('/seller/kyc/bank', { method: 'POST', json: bank })),
    );
  };
  const submit = () =>
    void submitForm.run(async () =>
      setAccount(await api<SellerAccountView>('/seller/kyc/submit', { method: 'POST' })),
    );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Complete your seller profile</h1>
      {account.status === 'REJECTED' && (
        <Alert>
          Your application was not approved: {account.rejectionReason}. Fix and resubmit.
        </Alert>
      )}

      <SectionCard title="1. Business and tax details">
        <form
          onSubmit={saveDetails}
          className="grid gap-4 md:grid-cols-2"
          aria-label="Business details"
        >
          <Field
            label="Legal name (as on PAN)"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            error={details.fields.legalName}
            required
          />
          <Field
            label="PAN"
            value={pan}
            onChange={(e) => setPan(e.target.value.toUpperCase())}
            error={details.fields.pan}
            hint="e.g. ABCPE1234F"
            maxLength={10}
            required
          />
          <Field
            label="GSTIN"
            value={gstin}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            error={details.fields.gstin}
            hint="15 characters, registered in your pickup state"
            maxLength={15}
            required
          />
          <div className="md:col-span-2">
            <h3 className="mb-2 font-semibold">Pickup address</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Contact name" {...pick('name')} required />
              <Field
                label="Contact phone"
                {...pick('phone')}
                inputMode="numeric"
                maxLength={10}
                required
              />
              <Field label="Address line 1" {...pick('line1')} required className="md:col-span-2" />
              <Field label="City" {...pick('city')} required />
              <Field label="State" {...pick('state')} required />
              <Field
                label="Pincode"
                {...pick('pincode')}
                inputMode="numeric"
                maxLength={6}
                required
              />
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            {details.error && <Alert>{details.error}</Alert>}
            {saved && <Alert tone="ok">Details saved</Alert>}
            <Button type="submit" disabled={details.busy}>
              Save details
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="2. Bank account">
        {account.bank?.verified ? (
          <p className="text-sm" data-testid="bank-verified">
            <Badge tone="plus">Verified</Badge> A/c ending {account.bank.accountLast4} ·{' '}
            {account.bank.ifsc} · name at bank: {account.bank.nameAtBank}
          </p>
        ) : (
          <form
            onSubmit={verifyBank}
            className="grid gap-4 md:grid-cols-3"
            aria-label="Bank account"
          >
            <Field
              label="Account holder name"
              value={bank.holderName}
              onChange={(e) => setBank({ ...bank, holderName: e.target.value })}
              required
            />
            <Field
              label="Account number"
              value={bank.accountNumber}
              onChange={(e) => setBank({ ...bank, accountNumber: e.target.value })}
              error={bankForm.fields.accountNumber}
              inputMode="numeric"
              required
            />
            <Field
              label="IFSC"
              value={bank.ifsc}
              onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })}
              error={bankForm.fields.ifsc}
              required
            />
            <div className="space-y-2 md:col-span-3">
              <p className="text-xs text-slate-500">
                We deposit ₹1 to confirm the account and match the name with your legal name
                (simulated).
              </p>
              {bankForm.error && <Alert>{bankForm.error}</Alert>}
              <Button type="submit" variant="secondary" disabled={bankForm.busy}>
                Verify bank account
              </Button>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard title="3. Submit for approval">
        {account.missing.length > 0 && (
          <p className="mb-3 text-sm text-slate-600">Still needed: {account.missing.join(', ')}</p>
        )}
        {submitForm.error && <Alert>{submitForm.error}</Alert>}
        <Button
          type="button"
          variant="buy"
          onClick={submit}
          disabled={submitForm.busy || account.missing.length > 0}
        >
          Submit for approval
        </Button>
      </SectionCard>
    </div>
  );
}
