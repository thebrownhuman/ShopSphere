import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shared layout for policy pages (M7.3): title, last-updated date, simulation notice, contents. */
export function LegalPage({
  title,
  updated,
  sections,
  children,
}: {
  title: string;
  updated: string;
  sections: Array<{ id: string; title: string; body: ReactNode }>;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <article className="rounded-lg bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-slate-600">Last updated {updated}</p>
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ShopSphere is a simulated marketplace. This policy describes how the store behaves; no
          real goods are sold and no real payments are taken.
        </p>
        {children}
        <nav aria-label="On this page" className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            On this page
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-brand-dark underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="mt-8 scroll-mt-24">
            <h2 id={`${s.id}-h`} className="text-lg font-bold">
              {s.title}
            </h2>
            <div className="mt-2 space-y-3 text-slate-800 [&_a]:text-brand-dark [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
              {s.body}
            </div>
          </section>
        ))}
        <p className="mt-10 border-t border-slate-200 pt-4 text-sm text-slate-600">
          Questions? Contact our <Link href="/grievance">Grievance Officer</Link> or visit the{' '}
          <Link href="/help">Help centre</Link>.
        </p>
      </article>
    </main>
  );
}
