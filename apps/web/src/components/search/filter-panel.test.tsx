import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Facet } from '@/lib/api/catalog.types';
import { parseSearchQuery, serializeSearchQuery } from '@/lib/search-params';
import { FilterPanel } from './filter-panel';

const push = vi.fn();
let pathname = '/s';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

const facets: Facet[] = [
  {
    key: 'brand',
    label: 'Brand',
    type: 'terms',
    values: [
      { value: 'sony', label: 'Sony', count: 3 },
      { value: 'boat', label: 'boAt', count: 2 },
    ],
  },
  {
    key: 'rating',
    label: 'Customer Review',
    type: 'terms',
    values: [{ value: '4', label: '4★ & up', count: 4 }],
  },
  {
    key: 'colour',
    label: 'Colour',
    type: 'terms',
    values: [{ value: 'black', label: 'Black', count: 5 }],
  },
];

const renderAt = (url: string) =>
  render(<FilterPanel facets={facets} query={parseSearchQuery(new URLSearchParams(url))} />);

describe('FilterPanel URL sync', () => {
  beforeEach(() => {
    push.mockReset();
    pathname = '/s';
  });

  it('checking a brand pushes ?brand= and resets the page', async () => {
    renderAt('k=headphones&page=3');
    await userEvent.click(screen.getByRole('checkbox', { name: /Sony/ }));
    expect(push).toHaveBeenCalledWith('/s?k=headphones&brand=sony', { scroll: false });
  });

  it('reflects URL state and unchecks to remove the value', async () => {
    renderAt('k=headphones&brand=sony,boat');
    const sony = screen.getByRole('checkbox', { name: /Sony/ });
    expect(sony).toBeChecked();
    await userEvent.click(sony);
    expect(push).toHaveBeenCalledWith('/s?k=headphones&brand=boat', { scroll: false });
  });

  it('attribute facets use a_ keys, single-select facets set a value', async () => {
    renderAt('k=headphones');
    await userEvent.click(screen.getByRole('checkbox', { name: /Black/ }));
    expect(push).toHaveBeenLastCalledWith('/s?k=headphones&a_colour=black', { scroll: false });
    await userEvent.click(screen.getByRole('radio', { name: /4★/ }));
    expect(push).toHaveBeenLastCalledWith('/s?k=headphones&rating=4', { scroll: false });
  });

  it('clear all keeps query and sort', async () => {
    renderAt('k=tv&brand=sony&rating=4&sort=price_asc');
    await userEvent.click(screen.getByRole('button', { name: 'Clear all filters (2)' }));
    expect(push).toHaveBeenCalledWith('/s?k=tv&sort=price_asc', { scroll: false });
  });

  it('category pages keep the category in the path, not the query', async () => {
    pathname = '/c/headphones';
    render(
      <FilterPanel
        facets={facets}
        query={parseSearchQuery(new URLSearchParams(''), { category: 'headphones' })}
        omitCategory
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /boAt/ }));
    expect(push).toHaveBeenCalledWith('/c/headphones?brand=boat', { scroll: false });
  });
});

describe('search params', () => {
  it('round-trips canonically', () => {
    const qs =
      'k=headphones&brand=sony,jbl&price=1000-5000&rating=4&delivery=plus&stock=1&a_colour=black&sort=rating&page=2';
    expect(serializeSearchQuery(parseSearchQuery(new URLSearchParams(qs)))).toBe(
      new URLSearchParams(qs).toString(),
    );
  });

  it('ignores junk values', () => {
    const q = parseSearchQuery({ sort: 'evil', page: '-4', rating: 'x', delivery: 'drone' });
    expect(q).toMatchObject({ sort: 'featured', page: 1, rating: undefined, delivery: undefined });
  });
});
