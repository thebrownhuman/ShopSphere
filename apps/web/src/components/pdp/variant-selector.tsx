'use client';

import { cx } from '@shopsphere/ui';
import type { Sku, VariantAxis } from '@/lib/api/catalog.types';

/**
 * Pick the SKU for a new attribute value, keeping the other axes where possible.
 * Exported for tests.
 */
export function resolveSku(skus: Sku[], current: Sku, key: string, value: string): Sku | undefined {
  const wanted = { ...current.attributes, [key]: value };
  return (
    skus.find((s) => Object.entries(wanted).every(([k, v]) => s.attributes[k] === v)) ??
    skus.find((s) => s.attributes[key] === value)
  );
}

/**
 * Colour swatches and size chips (PRD §6). Unavailable values stay selectable (to show the
 * "Notify me" state) but are greyed and struck through.
 */
export function VariantSelector({
  axes,
  skus,
  selected,
  onSelect,
  available,
}: {
  axes: VariantAxis[];
  skus: Sku[];
  selected: Sku;
  onSelect: (skuId: string) => void;
  /** skuId -> in stock; null while loading. */
  available: Map<string, boolean> | null;
}) {
  return (
    <div className="space-y-4">
      {axes.map((axis) => {
        const current = axis.values.find((v) => v.value === selected.attributes[axis.key]);
        return (
          <fieldset key={axis.key}>
            <legend className="mb-2 text-sm">
              {axis.label}: <span className="font-bold">{current?.label}</span>
            </legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={axis.label}>
              {axis.values.map((v) => {
                const target = resolveSku(skus, selected, axis.key, v.value);
                if (!target) return null;
                const isSelected = v.value === selected.attributes[axis.key];
                const inStock = available ? available.get(target.id) !== false : true;
                return (
                  <button
                    key={v.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    aria-label={`${v.label}${inStock ? '' : ', currently unavailable'}`}
                    data-testid={`variant-${axis.key}-${v.value}`}
                    onClick={() => !isSelected && onSelect(target.id)}
                    className={cx(
                      'relative rounded-md border text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                      isSelected
                        ? 'border-brand-dark ring-2 ring-brand-dark'
                        : 'border-slate-400 hover:border-slate-700',
                      axis.kind === 'swatch'
                        ? 'flex items-center gap-2 px-2 py-1.5'
                        : 'min-w-12 px-3 py-2',
                      !inStock && 'border-dashed text-slate-500',
                    )}
                  >
                    {axis.kind === 'swatch' && (
                      <span
                        aria-hidden="true"
                        className="h-6 w-6 rounded-full border border-slate-300"
                        style={{ background: v.swatch }}
                      />
                    )}
                    <span className={cx(!inStock && 'line-through')}>{v.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
