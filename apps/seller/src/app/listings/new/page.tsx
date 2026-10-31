'use client';

import type {
  ListingCreated,
  ListingRequest,
  MediaUploadResponse,
  SellerAttribute,
  SellerCategory,
} from '@shopsphere/types';
import { Button, SectionCard } from '@shopsphere/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Alert, Field, inputClass } from '@/components/field';
import { api, ApiCallError, fileToBase64, rupeesToPaise } from '@/lib/api';

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? 'http://localhost:3000';

interface Row {
  key: string;
  attributes: Record<string, string>;
  price: string;
  mrp: string;
  stock: string;
  skuCode: string;
}

/** Cartesian product of the variant values the seller typed, e.g. colour × size. */
function combos(values: [string, string[]][]): Record<string, string>[] {
  return values.reduce<Record<string, string>[]>(
    (acc, [key, vals]) =>
      vals.length ? acc.flatMap((a) => vals.map((v) => ({ ...a, [key]: v }))) : acc,
    [{}],
  );
}

/** Single listing form (M5.2): category → attribute form → variants matrix → images. */
export default function NewListingPage() {
  const [categories, setCategories] = useState<SellerCategory[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [attrs, setAttrs] = useState<SellerAttribute[]>([]);
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [description, setDescription] = useState('');
  const [bullets, setBullets] = useState('');
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [variantValues, setVariantValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [images, setImages] = useState<MediaUploadResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<ListingCreated | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SellerCategory[]>('/seller/categories').then(setCategories, () => setCategories([]));
  }, []);
  useEffect(() => {
    setAttrs([]);
    setSpecs({});
    setVariantValues({});
    if (categoryId)
      api<SellerAttribute[]>(`/seller/categories/${categoryId}/attributes`).then(setAttrs);
  }, [categoryId]);

  const variantAttrs = attrs.filter((a) => a.isVariant);
  const matrix = useMemo(() => {
    const values = variantAttrs.map(
      (a) =>
        [
          a.key,
          (variantValues[a.key] ?? '')
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean),
        ] as [string, string[]],
    );
    return combos(values).map((attributes) => {
      const key = JSON.stringify(attributes);
      return rows[key] ?? { key, attributes, price: '', mrp: '', stock: '', skuCode: '' };
    });
  }, [variantAttrs, variantValues, rows]);

  const setRow = (r: Row, patch: Partial<Row>) => setRows({ ...rows, [r.key]: { ...r, ...patch } });

  async function upload(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const res = await api<MediaUploadResponse>('/seller/media', {
          method: 'POST',
          json: {
            fileName: file.name,
            contentType: file.type,
            dataBase64: await fileToBase64(file),
          },
        });
        setImages((prev) => [...prev, res]);
      }
    } catch (err) {
      setError(err instanceof ApiCallError ? err.message : 'Upload failed');
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const variants: ListingRequest['variants'] = [];
    for (const r of matrix) {
      const price = rupeesToPaise(r.price);
      const mrp = rupeesToPaise(r.mrp);
      if (price === null || mrp === null || !/^\d+$/.test(r.stock)) {
        setError('Enter price, MRP (rupees) and stock for every variant');
        return;
      }
      variants.push({
        attributes: r.attributes,
        price,
        mrp,
        stock: Number(r.stock),
        ...(r.skuCode.trim() ? { skuCode: r.skuCode.trim() } : {}),
      });
    }
    setBusy(true);
    try {
      const body: ListingRequest = {
        categoryId,
        title,
        brand,
        description,
        bullets: bullets
          .split('\n')
          .map((b) => b.trim())
          .filter(Boolean),
        specs: Object.fromEntries(Object.entries(specs).filter(([, v]) => v.trim())),
        images: images.map((i) => i.id),
        variants,
      };
      setCreated(await api<ListingCreated>('/seller/listings', { method: 'POST', json: body }));
    } catch (err) {
      if (err instanceof ApiCallError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else setError('Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <SectionCard title="Listing is live">
        <p className="mb-3 text-sm" data-testid="listing-created">
          Created {created.skus.length} SKU(s): {created.skus.map((s) => s.code).join(', ')}
        </p>
        <a
          className="text-brand-dark underline"
          href={`${STOREFRONT_URL}/p/${created.slug}`}
          target="_blank"
          rel="noreferrer"
        >
          View on ShopSphere
        </a>
      </SectionCard>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-2xl font-bold">Add a listing</h1>
      <SectionCard title="Category">
        <label htmlFor="category" className="mb-1 block text-sm font-medium">
          Category
        </label>
        <select
          id="category"
          className={inputClass}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
        >
          <option value="">Choose a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.pathLabel}
            </option>
          ))}
        </select>
      </SectionCard>

      {categoryId && (
        <>
          <SectionCard title="Product details">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                error={fieldErrors.title}
                required
              />
              <Field
                label="Brand"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                error={fieldErrors.brand}
                required
              />
              <div className="md:col-span-2">
                <label htmlFor="description" className="mb-1 block text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="description"
                  className={`${inputClass} h-24 py-2`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="bullets" className="mb-1 block text-sm font-medium">
                  Key features (one per line)
                </label>
                <textarea
                  id="bullets"
                  className={`${inputClass} h-20 py-2`}
                  value={bullets}
                  onChange={(e) => setBullets(e.target.value)}
                />
              </div>
              {attrs
                .filter((a) => !a.isVariant)
                .map((a) => (
                  <Field
                    key={a.key}
                    label={a.label}
                    type={a.type === 'NUMBER' ? 'number' : 'text'}
                    value={specs[a.key] ?? ''}
                    onChange={(e) => setSpecs({ ...specs, [a.key]: e.target.value })}
                    error={fieldErrors[`specs.${a.key}`]}
                  />
                ))}
            </div>
          </SectionCard>

          <SectionCard title="Variants, price and stock">
            {variantAttrs.length > 0 && (
              <div className="mb-4 grid gap-4 md:grid-cols-2">
                {variantAttrs.map((a) => (
                  <Field
                    key={a.key}
                    label={`${a.label} values`}
                    hint="Comma separated, e.g. Black, Blue. Leave empty if not applicable."
                    value={variantValues[a.key] ?? ''}
                    onChange={(e) =>
                      setVariantValues({ ...variantValues, [a.key]: e.target.value })
                    }
                  />
                ))}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600">
                    <th className="p-2">Variant</th>
                    <th className="p-2">Price (₹)</th>
                    <th className="p-2">MRP (₹)</th>
                    <th className="p-2">Stock</th>
                    <th className="p-2">SKU code (optional)</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map((r, i) => {
                    const name = Object.values(r.attributes).join(' / ') || 'Default';
                    return (
                      <tr key={r.key} className="border-t" data-testid="variant-row">
                        <td className="p-2 font-medium">{name}</td>
                        <td className="p-2">
                          <input
                            aria-label={`Price for ${name}`}
                            className={inputClass}
                            inputMode="decimal"
                            value={r.price}
                            onChange={(e) => setRow(r, { price: e.target.value })}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`MRP for ${name}`}
                            className={inputClass}
                            inputMode="decimal"
                            value={r.mrp}
                            onChange={(e) => setRow(r, { mrp: e.target.value })}
                          />
                          {fieldErrors[`variants[${i}].mrp`] && (
                            <p className="text-xs text-deal">{fieldErrors[`variants[${i}].mrp`]}</p>
                          )}
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`Stock for ${name}`}
                            className={inputClass}
                            inputMode="numeric"
                            value={r.stock}
                            onChange={(e) => setRow(r, { stock: e.target.value })}
                          />
                        </td>
                        <td className="p-2">
                          <input
                            aria-label={`SKU code for ${name}`}
                            className={inputClass}
                            value={r.skuCode}
                            onChange={(e) => setRow(r, { skuCode: e.target.value })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Images">
            <label htmlFor="images" className="mb-1 block text-sm font-medium">
              Upload images (PNG, JPEG or WebP, up to 2 MB)
            </label>
            <input
              id="images"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(e) => void upload(e.target.files)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {images.map((img) => (
                <img
                  key={img.id}
                  src={img.url}
                  alt="Uploaded product"
                  className="h-20 w-20 rounded border object-contain"
                  data-testid="uploaded-image"
                />
              ))}
            </div>
          </SectionCard>

          {error && <Alert>{error}</Alert>}
          <Button type="submit" variant="buy" size="lg" disabled={busy}>
            Publish listing
          </Button>
        </>
      )}
    </form>
  );
}
