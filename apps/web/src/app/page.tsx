import { formatPaise } from '@shopsphere/ui';
import { HealthStatus } from './health-status';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold">Hello from ShopSphere</h1>
      <p className="mb-6 text-slate-600">
        Milestone 0 scaffold. Prices are stored in paise: 129900 paise = {formatPaise(129900)}.
      </p>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <HealthStatus />
      </section>
    </main>
  );
}
