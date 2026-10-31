import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Sku, VariantAxis } from '@/lib/api/catalog.types';
import { VariantSelector, resolveSku } from './variant-selector';

const im = { url: '/img/1/x', alt: 'x', width: 1, height: 1 };
const skus: Sku[] = [
  { id: 'black-m', attributes: { colour: 'black', size: 'm' }, images: [im] },
  { id: 'black-l', attributes: { colour: 'black', size: 'l' }, images: [im] },
  { id: 'blue-m', attributes: { colour: 'blue', size: 'm' }, images: [im] },
];
const axes: VariantAxis[] = [
  {
    key: 'colour',
    label: 'Colour',
    kind: 'swatch',
    values: [
      { value: 'black', label: 'Black', swatch: '#000' },
      { value: 'blue', label: 'Blue', swatch: '#00f' },
    ],
  },
  {
    key: 'size',
    label: 'Size',
    kind: 'chip',
    values: [
      { value: 'm', label: 'M' },
      { value: 'l', label: 'L' },
    ],
  },
];

describe('VariantSelector', () => {
  it('shows the selection and selects the matching SKU', async () => {
    const onSelect = vi.fn();
    render(
      <VariantSelector
        axes={axes}
        skus={skus}
        selected={skus[0]!}
        onSelect={onSelect}
        available={null}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Black' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Colour:').parentElement).toHaveTextContent('Colour: Black');
    await userEvent.click(screen.getByRole('radio', { name: 'L' }));
    expect(onSelect).toHaveBeenCalledWith('black-l');
    await userEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(onSelect).toHaveBeenLastCalledWith('blue-m');
  });

  it('does not reselect the current value', async () => {
    const onSelect = vi.fn();
    render(
      <VariantSelector
        axes={axes}
        skus={skus}
        selected={skus[0]!}
        onSelect={onSelect}
        available={null}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Black' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('greys out unavailable variants but keeps them selectable', async () => {
    const onSelect = vi.fn();
    const available = new Map([
      ['black-m', true],
      ['black-l', false],
      ['blue-m', true],
    ]);
    render(
      <VariantSelector
        axes={axes}
        skus={skus}
        selected={skus[0]!}
        onSelect={onSelect}
        available={available}
      />,
    );
    const l = screen.getByRole('radio', { name: 'L, currently unavailable' });
    expect(l.className).toContain('border-dashed');
    await userEvent.click(l);
    expect(onSelect).toHaveBeenCalledWith('black-l');
  });

  it('resolveSku falls back to any SKU with the value when the combo does not exist', () => {
    expect(resolveSku(skus, skus[1]!, 'colour', 'blue')?.id).toBe('blue-m');
  });
});
