import Link from 'next/link';

const COLUMNS: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: 'Get to Know Us',
    links: [
      ['About ShopSphere', '/about'],
      ['Careers', '/careers'],
      ['Press', '/press'],
    ],
  },
  {
    title: 'Make Money with Us',
    links: [
      ['Sell on ShopSphere', '/sell'],
      ['Become an Affiliate', '/affiliate'],
      ['Advertise Your Products', '/advertise'],
    ],
  },
  {
    title: 'Let Us Help You',
    links: [
      ['Your Account', '/account'],
      ['Returns Centre', '/account'],
      ['Help', '/help'],
    ],
  },
  {
    title: 'Policies',
    links: [
      ['Privacy Notice', '/privacy'],
      ['Conditions of Use', '/terms'],
      ['Return Policy', '/returns-policy'],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-8 text-sm text-white">
      <a href="#top" className="block bg-slate-700 py-4 text-center hover:bg-slate-600">
        Back to top
      </a>
      <div className="bg-brand-navy">
        <div className="mx-auto grid max-w-page grid-cols-2 gap-8 px-6 py-10 md:grid-cols-4">
          {COLUMNS.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <h2 className="mb-3 font-bold">{c.title}</h2>
              <ul className="space-y-2 text-slate-200">
                {c.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="hover:underline">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="border-t border-slate-600 px-6 py-6 text-center text-slate-200">
          <p>India · English · ₹ INR</p>
          <p className="mt-2">© 2026 ShopSphere (simulated marketplace)</p>
        </div>
      </div>
    </footer>
  );
}
