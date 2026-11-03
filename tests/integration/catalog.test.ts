import { Role } from '@prisma/client';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { storage } from '../../src/lib/storage/index.js';
import { adminClient, createUser, TestClient } from '../helpers/client.js';
import { resetState } from '../helpers/db.js';

beforeEach(resetState);

type Json = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- typed accessor for test responses
const data = <T = Json>(res: { body: unknown }) => (res.body as { data: T }).data;

const memoryFiles = () => (storage as unknown as { files: Map<string, Buffer> }).files;

async function png(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
    .png()
    .toBuffer();
}

async function newProduct(client: TestClient, overrides: Json = {}) {
  const res = await client.post('/admin/products', {
    name: 'Cotton T-Shirt',
    variants: [{ sku: 'TS-001', price: 120000, initialStock: 10 }],
    ...overrides,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return data<{
    id: string;
    slug: string;
    variants: { id: string; sku: string; stock: number; isDefault: boolean }[];
  }>(res);
}

// ---------------------------------------------------------------------------
// Permissions (requirements §3, §9)
// ---------------------------------------------------------------------------
describe('catalog permissions', () => {
  const routes: [string, string][] = [
    ['get', '/admin/categories'],
    ['post', '/admin/categories'],
    ['get', '/admin/brands'],
    ['get', '/admin/attributes'],
    ['get', '/admin/products'],
    ['post', '/admin/products'],
    ['get', '/admin/inventory/low-stock'],
  ];

  it.each(routes)('CUSTOMER gets 403 on %s %s', async (method, path) => {
    const customer = await createUser();
    const client = await TestClient.create();
    await client.login(customer.email);
    const res = method === 'get' ? await client.get(path) : await client.post(path, { name: 'x' });
    expect(res.status).toBe(403);
  });

  it('anonymous gets 401', async () => {
    const client = await TestClient.create();
    expect((await client.get('/admin/products')).status).toBe(401);
  });

  it('STAFF can create but not delete', async () => {
    const { client } = await adminClient(Role.STAFF);
    const created = await client.post('/admin/brands', { name: 'Acme' });
    expect(created.status).toBe(201);
    const del = await client.delete(`/admin/brands/${data<{ id: string }>(created).id}`);
    expect(del.status).toBe(403);
    expect((del.body as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('ADMIN must re-authenticate before deleting', async () => {
    const { client, reauth } = await adminClient(Role.ADMIN);
    const id = data<{ id: string }>(await client.post('/admin/brands', { name: 'Acme' })).id;
    const first = await client.delete(`/admin/brands/${id}`);
    expect(first.status).toBe(403);
    expect((first.body as { error: { code: string } }).error.code).toBe('REAUTH_REQUIRED');
    await reauth();
    expect((await client.delete(`/admin/brands/${id}`)).status).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
describe('categories', () => {
  it('creates a tree with generated unique slugs', async () => {
    const { client } = await adminClient();
    const men = data<{ id: string; slug: string }>(
      await client.post('/admin/categories', { name: 'Men & Boys' }),
    );
    expect(men.slug).toBe('men-and-boys');
    const shirts = data<{ id: string; slug: string }>(
      await client.post('/admin/categories', { name: 'Shirts', parentId: men.id }),
    );
    const again = data<{ slug: string }>(
      await client.post('/admin/categories', { name: 'Shirts' }),
    );
    expect(again.slug).toBe('shirts-2');

    const list = data<{ tree: { id: string; children: { id: string }[] }[] }>(
      await client.get('/admin/categories'),
    );
    const root = list.tree.find((n) => n.id === men.id);
    expect(root?.children.map((c) => c.id)).toEqual([shirts.id]);
  });

  it('falls back to a random slug for non-Latin names', async () => {
    const { client } = await adminClient();
    const cat = data<{ slug: string; name: string }>(
      await client.post('/admin/categories', { name: 'পোশাক' }),
    );
    expect(cat.name).toBe('পোশাক');
    expect(cat.slug).toMatch(/^item-[0-9a-f]{8}$/);
  });

  it('rejects cycles (a category under its own descendant)', async () => {
    const { client } = await adminClient();
    const a = data<{ id: string }>(await client.post('/admin/categories', { name: 'A' }));
    const b = data<{ id: string }>(
      await client.post('/admin/categories', { name: 'B', parentId: a.id }),
    );
    const c = data<{ id: string }>(
      await client.post('/admin/categories', { name: 'C', parentId: b.id }),
    );
    const res = await client.patch(`/admin/categories/${a.id}`, { parentId: c.id });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('CATEGORY_CYCLE');
    expect((await client.patch(`/admin/categories/${a.id}`, { parentId: a.id })).status).toBe(400);
  });

  it('rejects a taken explicit slug with 409', async () => {
    const { client } = await adminClient();
    await client.post('/admin/categories', { name: 'Shoes', slug: 'shoes' });
    const res = await client.post('/admin/categories', { name: 'Footwear', slug: 'shoes' });
    expect(res.status).toBe(409);
  });

  it('refuses to delete a category with products, then frees the slug after deletion', async () => {
    const { client, reauth } = await adminClient();
    await reauth();
    const cat = data<{ id: string }>(
      await client.post('/admin/categories', { name: 'Bags', slug: 'bags' }),
    );
    const product = await newProduct(client, { categoryId: cat.id });
    const blocked = await client.delete(`/admin/categories/${cat.id}`);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('CATEGORY_HAS_PRODUCTS');

    await client.patch(`/admin/products/${product.id}`, { categoryId: null });
    expect((await client.delete(`/admin/categories/${cat.id}`)).status).toBe(204);
    expect((await client.get(`/admin/categories/${cat.id}`)).status).toBe(404);
    expect((await client.post('/admin/categories', { name: 'Bags', slug: 'bags' })).status).toBe(
      201,
    );
  });

  it('reorders categories', async () => {
    const { client } = await adminClient();
    const a = data<{ id: string }>(await client.post('/admin/categories', { name: 'A' }));
    const b = data<{ id: string }>(await client.post('/admin/categories', { name: 'B' }));
    expect(
      (
        await client.patch('/admin/categories/reorder', {
          items: [
            { id: a.id, sortOrder: 2 },
            { id: b.id, sortOrder: 1 },
          ],
        })
      ).status,
    ).toBe(204);
    const items = data<{ items: { id: string }[] }>(await client.get('/admin/categories')).items;
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
  });
});

// ---------------------------------------------------------------------------
// Brands & attributes
// ---------------------------------------------------------------------------
describe('brands', () => {
  it('lists with search and offset pagination meta', async () => {
    const { client } = await adminClient();
    for (const name of ['Apex', 'Bolt', 'Apple Co']) await client.post('/admin/brands', { name });
    const res = await client.get('/admin/brands?search=ap&pageSize=1&page=2&sort=name');
    expect(res.status).toBe(200);
    expect((res.body as { meta: Json }).meta).toEqual({
      pagination: { page: 2, pageSize: 1, total: 2, totalPages: 2 },
    });
    expect(data<{ name: string }[]>(res).map((b) => b.name)).toEqual(['Apple Co']);
  });

  it('enforces the max page size', async () => {
    const { client } = await adminClient();
    expect((await client.get('/admin/brands?pageSize=500')).status).toBe(422);
  });
});

describe('attributes', () => {
  it('requires a hex colour for COLOR values and blocks deleting values in use', async () => {
    const { client, reauth } = await adminClient();
    await reauth();
    const color = data<{ id: string }>(
      await client.post('/admin/attributes', { name: 'Color', type: 'COLOR' }),
    );
    const noHex = await client.post(`/admin/attributes/${color.id}/values`, { value: 'Red' });
    expect(noHex.status).toBe(422);
    const red = data<{ id: string; colorHex: string }>(
      await client.post(`/admin/attributes/${color.id}/values`, {
        value: 'Red',
        colorHex: '#ff0000',
      }),
    );
    expect(red.colorHex).toBe('#FF0000');

    await newProduct(client, {
      variants: [{ sku: 'R-1', price: 100, attributeValueIds: [red.id] }],
    });
    const del = await client.delete(`/admin/attributes/values/${red.id}`);
    expect((del.body as { error: { code: string } }).error.code).toBe('ATTRIBUTE_VALUE_IN_USE');
  });
});

// ---------------------------------------------------------------------------
// Products & variants
// ---------------------------------------------------------------------------
describe('products', () => {
  it('creates a product with variants, options and initial stock movements', async () => {
    const { client } = await adminClient();
    const size = data<{ id: string }>(await client.post('/admin/attributes', { name: 'Size' }));
    const s = data<{ id: string }>(
      await client.post(`/admin/attributes/${size.id}/values`, { value: 'S' }),
    );
    const m = data<{ id: string }>(
      await client.post(`/admin/attributes/${size.id}/values`, { value: 'M' }),
    );

    const product = await newProduct(client, {
      name: 'Polo Shirt',
      description:
        '<p onclick="alert(1)">Soft <script>alert(1)</script><a href="javascript:alert(1)">x</a> <a href="https://ex.com">ok</a></p>',
      specifications: [{ name: 'Material', value: 'Cotton' }],
      variants: [
        { sku: 'polo-s', price: 99900, initialStock: 5, attributeValueIds: [s.id] },
        {
          sku: 'POLO-M',
          price: 99900,
          compareAtPrice: 129900,
          initialStock: 0,
          attributeValueIds: [m.id],
          isDefault: true,
        },
      ],
    });

    const detail = data<{
      slug: string;
      status: string;
      description: string;
      variants: { sku: string; isDefault: boolean; stock: number; options: { value: string }[] }[];
    }>(await client.get(`/admin/products/${product.id}`));
    expect(detail.slug).toBe('polo-shirt');
    expect(detail.status).toBe('DRAFT');
    expect(detail.variants.map((v) => v.sku)).toEqual(['POLO-S', 'POLO-M']); // uppercased
    expect(detail.variants.find((v) => v.sku === 'POLO-M')?.isDefault).toBe(true);
    expect(detail.variants[0]?.options.map((o) => o.value)).toEqual(['S']);

    // Rich text is sanitized on the server (§4.3)
    expect(detail.description).not.toMatch(/script|onclick|javascript:/);
    expect(detail.description).toContain(
      '<a href="https://ex.com" rel="noopener noreferrer nofollow" target="_blank">ok</a>',
    );

    const movements = await prisma.inventoryMovement.findMany({
      where: { variant: { productId: product.id } },
    });
    expect(movements).toHaveLength(1); // only the variant with initialStock > 0
    expect(movements[0]).toMatchObject({ delta: 5, stockAfter: 5, reason: 'RESTOCK' });
  });

  it('rejects duplicate SKUs (409), duplicate option combinations and two values of one attribute', async () => {
    const { client } = await adminClient();
    await newProduct(client);
    const dup = await client.post('/admin/products', {
      name: 'X',
      variants: [{ sku: 'ts-001', price: 1 }],
    });
    expect(dup.status).toBe(409);
    expect((dup.body as { error: { code: string } }).error.code).toBe('SKU_TAKEN');

    const size = data<{ id: string }>(await client.post('/admin/attributes', { name: 'Size' }));
    const s = data<{ id: string }>(
      await client.post(`/admin/attributes/${size.id}/values`, { value: 'S' }),
    );
    const m = data<{ id: string }>(
      await client.post(`/admin/attributes/${size.id}/values`, { value: 'M' }),
    );
    const sameCombo = await client.post('/admin/products', {
      name: 'Y',
      variants: [
        { sku: 'Y-1', price: 1, attributeValueIds: [s.id] },
        { sku: 'Y-2', price: 1, attributeValueIds: [s.id] },
      ],
    });
    expect(sameCombo.status).toBe(422);
    const twoSizes = await client.post('/admin/products', {
      name: 'Z',
      variants: [{ sku: 'Z-1', price: 1, attributeValueIds: [s.id, m.id] }],
    });
    expect(twoSizes.status).toBe(422);
  });

  it('validates money: integers only, compare-at above price', async () => {
    const { client } = await adminClient();
    const float = await client.post('/admin/products', {
      name: 'F',
      variants: [{ sku: 'F-1', price: 10.5 }],
    });
    expect(float.status).toBe(422);
    const compare = await client.post('/admin/products', {
      name: 'C',
      variants: [{ sku: 'C-1', price: 1000, compareAtPrice: 900 }],
    });
    expect(compare.status).toBe(422);
  });

  it('ignores mass-assigned stock/id fields on product update', async () => {
    const { client } = await adminClient();
    const product = await newProduct(client);
    const res = await client.patch(`/admin/products/${product.id}`, {
      name: 'Renamed',
      stock: 999999,
      id: '00000000-0000-0000-0000-000000000000',
      deletedAt: null,
    });
    expect(res.status).toBe(200);
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    expect(variant.stock).toBe(10);
    expect(data<{ id: string; name: string }>(res)).toMatchObject({
      id: product.id,
      name: 'Renamed',
    });
  });

  it('only publishes products with an active variant, and protects the last active variant', async () => {
    const { client, reauth } = await adminClient();
    await reauth();
    const product = await newProduct(client, {
      variants: [{ sku: 'P-1', price: 100, isActive: false }],
    });
    const publish = await client.patch(`/admin/products/${product.id}`, { status: 'ACTIVE' });
    expect((publish.body as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_SELLABLE');

    const variantId = product.variants[0]?.id ?? '';
    await client.patch(`/admin/variants/${variantId}`, { isActive: true });
    const ok = await client.patch(`/admin/products/${product.id}`, { status: 'ACTIVE' });
    expect(data<{ status: string; publishedAt: string }>(ok)).toMatchObject({ status: 'ACTIVE' });
    expect(data<{ publishedAt: string | null }>(ok).publishedAt).not.toBeNull();

    const deactivate = await client.patch(`/admin/variants/${variantId}`, { isActive: false });
    expect((deactivate.body as { error: { code: string } }).error.code).toBe('LAST_ACTIVE_VARIANT');
    const del = await client.delete(`/admin/variants/${variantId}`);
    expect((del.body as { error: { code: string } }).error.code).toBe('LAST_ACTIVE_VARIANT');
  });

  async function sizes(client: TestClient, values: string[]) {
    const size = data<{ id: string }>(await client.post('/admin/attributes', { name: 'Size' }));
    const ids: string[] = [];
    for (const value of values) {
      ids.push(
        data<{ id: string }>(await client.post(`/admin/attributes/${size.id}/values`, { value }))
          .id,
      );
    }
    return ids;
  }

  it('adds variants, moves the default, and reassigns it when the default is deleted', async () => {
    const { client, reauth } = await adminClient();
    await reauth();
    const [s = '', m = '', l = ''] = await sizes(client, ['S', 'M', 'L']);
    const product = await newProduct(client, {
      variants: [{ sku: 'TS-001', price: 120000, attributeValueIds: [s] }],
    });
    const sameOptions = await client.post(`/admin/products/${product.id}/variants`, {
      sku: 'TS-009',
      price: 1,
      attributeValueIds: [s],
    });
    expect((sameOptions.body as { error: { code: string } }).error.code).toBe(
      'VARIANT_COMBINATION_EXISTS',
    );
    const added = await client.post(`/admin/products/${product.id}/variants`, {
      sku: 'TS-002',
      price: 130000,
      isDefault: true,
      attributeValueIds: [m],
    });
    expect(added.status).toBe(201);
    const newId = data<{ id: string }>(added).id;
    const rows = await prisma.productVariant.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.isDefault)).toEqual([false, true]);

    expect((await client.delete(`/admin/variants/${newId}`)).status).toBe(204);
    const first = await prisma.productVariant.findUniqueOrThrow({
      where: { id: product.variants[0]?.id ?? '' },
    });
    expect(first.isDefault).toBe(true);
    // SKU is freed for reuse after deletion
    expect(
      (
        await client.post(`/admin/products/${product.id}/variants`, {
          sku: 'TS-002',
          price: 1,
          attributeValueIds: [l],
        })
      ).status,
    ).toBe(201);
  });

  it('lists with filters, search by name or SKU, low-stock and computed fields', async () => {
    const { client } = await adminClient();
    const brand = data<{ id: string }>(await client.post('/admin/brands', { name: 'Acme' }));
    await newProduct(client, {
      name: 'Blue Jeans',
      brandId: brand.id,
      variants: [{ sku: 'JEANS-1', price: 200000, initialStock: 2 }],
    });
    const [s = '', m = ''] = await sizes(client, ['S', 'M']);
    await newProduct(client, {
      name: 'Red Cap',
      variants: [
        { sku: 'CAP-1', price: 50000, initialStock: 50, attributeValueIds: [s] },
        { sku: 'CAP-2', price: 70000, initialStock: 50, attributeValueIds: [m] },
      ],
    });

    const bySku = data<{ name: string }[]>(await client.get('/admin/products?search=jeans-1'));
    expect(bySku.map((p) => p.name)).toEqual(['Blue Jeans']);
    const byBrand = data<{ name: string }[]>(
      await client.get(`/admin/products?brandId=${brand.id}`),
    );
    expect(byBrand).toHaveLength(1);
    const low = data<{ name: string; lowStock: boolean }[]>(
      await client.get('/admin/products?lowStock=true'),
    );
    expect(low.map((p) => p.name)).toEqual(['Blue Jeans']);

    const cap = data<
      {
        name: string;
        priceMin: number;
        priceMax: number;
        totalStock: number;
        variantCount: number;
      }[]
    >(await client.get('/admin/products?search=cap'))[0];
    expect(cap).toMatchObject({
      priceMin: 50000,
      priceMax: 70000,
      totalStock: 100,
      variantCount: 2,
    });
  });

  it('soft-deletes products (reauth) and frees slug + SKUs', async () => {
    const { client, reauth } = await adminClient();
    const product = await newProduct(client);
    expect((await client.delete(`/admin/products/${product.id}`)).status).toBe(403);
    await reauth();
    expect((await client.delete(`/admin/products/${product.id}`)).status).toBe(204);
    expect((await client.get(`/admin/products/${product.id}`)).status).toBe(404);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.deletedAt).not.toBeNull();
    const again = await newProduct(client); // same name + SKU
    expect(again.slug).toBe('cotton-t-shirt');
  });

  it('bulk publish reports skipped products; bulk delete needs ADMIN + reauth', async () => {
    const { client: staff } = await adminClient(Role.STAFF);
    const ok = await newProduct(staff);
    const inactive = await newProduct(staff, {
      name: 'Inactive',
      variants: [{ sku: 'IN-1', price: 1, isActive: false }],
    });
    const res = await staff.post('/admin/products/bulk', {
      ids: [ok.id, inactive.id],
      action: 'publish',
    });
    expect(data<{ updated: string[]; skipped: { id: string }[] }>(res)).toMatchObject({
      updated: [ok.id],
      skipped: [{ id: inactive.id }],
    });
    const staffDelete = await staff.post('/admin/products/bulk', {
      ids: [ok.id],
      action: 'delete',
    });
    expect(staffDelete.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
describe('inventory', () => {
  it('adjusts stock, records movements and never goes negative', async () => {
    const { client } = await adminClient();
    const product = await newProduct(client);
    const variantId = product.variants[0]?.id ?? '';

    const add = await client.post(`/admin/variants/${variantId}/stock-adjustments`, {
      delta: 5,
      reason: 'RESTOCK',
      note: 'PO-77',
    });
    expect(add.status).toBe(201);
    expect(data<{ stock: number }>(add).stock).toBe(15);

    const tooMuch = await client.post(`/admin/variants/${variantId}/stock-adjustments`, {
      delta: -16,
      reason: 'DAMAGE',
    });
    expect(tooMuch.status).toBe(409);
    expect((tooMuch.body as { error: { code: string } }).error.code).toBe('INSUFFICIENT_STOCK');

    const manualSale = await client.post(`/admin/variants/${variantId}/stock-adjustments`, {
      delta: -1,
      reason: 'SALE',
    });
    expect(manualSale.status).toBe(422); // SALE/RETURN are reserved for order flows

    const history = await client.get(`/admin/variants/${variantId}/movements`);
    expect(
      data<{ delta: number; stockAfter: number; actor: { id: string } | null }[]>(history).map(
        (m) => [m.delta, m.stockAfter],
      ),
    ).toEqual([
      [5, 15],
      [10, 10],
    ]);
  });

  it('is race-safe: concurrent removals cannot oversell', async () => {
    const { client } = await adminClient();
    const product = await newProduct(client); // stock 10
    const variantId = product.variants[0]?.id ?? '';
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        client.post(`/admin/variants/${variantId}/stock-adjustments`, {
          delta: -3,
          reason: 'ADJUSTMENT',
        }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 201).length;
    expect(succeeded).toBe(3); // 3 × 3 = 9 ≤ 10; the 4th would go negative
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    expect(variant.stock).toBe(1);
    const sum = await prisma.inventoryMovement.aggregate({
      where: { variantId },
      _sum: { delta: true },
    });
    expect(sum._sum.delta).toBe(variant.stock); // history always adds up
  });

  it('lists low-stock variants', async () => {
    const { client } = await adminClient();
    await newProduct(client, {
      variants: [{ sku: 'LOW-1', price: 1, initialStock: 3, lowStockThreshold: 5 }],
    });
    await newProduct(client, {
      name: 'Plenty',
      variants: [{ sku: 'OK-1', price: 1, initialStock: 30 }],
    });
    const res = await client.get('/admin/inventory/low-stock');
    expect(data<{ sku: string }[]>(res).map((v) => v.sku)).toEqual(['LOW-1']);
  });
});

// ---------------------------------------------------------------------------
// Image uploads (requirements §4.2)
// ---------------------------------------------------------------------------
describe('image uploads', () => {
  it('re-encodes to WebP, strips EXIF, stores under a random name, and reorders', async () => {
    const { client } = await adminClient();
    const product = await newProduct(client);
    const withExif = await sharp(await png(3000, 1500))
      .withMetadata({ exif: { IFD0: { Copyright: 'GPS-SECRET-123' } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const res = await client.upload(`/admin/products/${product.id}/images`, 'images', [
      { buffer: withExif, filename: '../../etc/passwd.jpg', contentType: 'image/jpeg' },
      { buffer: await png(), filename: 'b.png', contentType: 'image/png' },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const images =
      data<{ id: string; url: string; width: number; height: number; sortOrder: number }[]>(res);
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({ width: 2000, height: 1000, sortOrder: 0 }); // resized to max 2000px

    const rows = await prisma.productImage.findMany({ where: { productId: product.id } });
    for (const row of rows) {
      expect(row.storageKey).toMatch(new RegExp(`^products/${product.id}/[0-9a-f-]{36}$`));
      expect(row.storageKey).not.toContain('passwd');
      const stored = memoryFiles().get(row.storageKey);
      expect(stored).toBeDefined();
      const meta = await sharp(stored).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
    }

    const reordered = await client.patch(`/admin/products/${product.id}/images/order`, {
      imageIds: [images[1]?.id, images[0]?.id],
    });
    expect(data<{ id: string }[]>(reordered).map((i) => i.id)).toEqual([
      images[1]?.id,
      images[0]?.id,
    ]);
    const partial = await client.patch(`/admin/products/${product.id}/images/order`, {
      imageIds: [images[0]?.id],
    });
    expect(partial.status).toBe(422);

    expect((await client.delete(`/admin/images/${images[0]?.id ?? ''}`)).status).toBe(204);
    expect(memoryFiles().has(rows.find((r) => r.id === images[0]?.id)?.storageKey ?? '')).toBe(
      false,
    );
  });

  it('rejects files whose bytes are not an image even if they claim to be (magic bytes)', async () => {
    const { client } = await adminClient();
    const product = await newProduct(client);
    const before = memoryFiles().size;
    const res = await client.upload(`/admin/products/${product.id}/images`, 'images', [
      { buffer: await png(), filename: 'ok.png', contentType: 'image/png' },
      {
        buffer: Buffer.from('<?php system($_GET["c"]); ?>'),
        filename: 'shell.png',
        contentType: 'image/png',
      },
    ]);
    expect(res.status).toBe(415);
    expect(memoryFiles().size).toBe(before); // nothing stored when any file is bad
    expect(await prisma.productImage.count()).toBe(0);
  });

  it('rejects disallowed MIME types and oversized files', async () => {
    const { client } = await adminClient();
    const product = await newProduct(client);
    const svg = await client.upload(`/admin/products/${product.id}/images`, 'images', [
      {
        buffer: Buffer.from('<svg onload="alert(1)"/>'),
        filename: 'x.svg',
        contentType: 'image/svg+xml',
      },
    ]);
    expect(svg.status).toBe(415);
    const big = await client.upload(`/admin/products/${product.id}/images`, 'images', [
      {
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1),
        filename: 'big.png',
        contentType: 'image/png',
      },
    ]);
    expect(big.status).toBe(413);
  });

  it('accepts multipart only on upload routes', async () => {
    const { client } = await adminClient();
    const res = await client.upload('/admin/brands', 'image', [
      { buffer: await png(), filename: 'a.png', contentType: 'image/png' },
    ]);
    expect(res.status).toBe(415);
  });

  it('sets and replaces a brand logo, deleting the old file', async () => {
    const { client } = await adminClient();
    const brand = data<{ id: string }>(await client.post('/admin/brands', { name: 'Acme' }));
    const first = await client.upload(`/admin/brands/${brand.id}/logo`, 'image', [
      { buffer: await png(), filename: 'a.png', contentType: 'image/png' },
    ]);
    expect(first.status).toBe(200);
    const firstKey =
      (await prisma.brand.findUniqueOrThrow({ where: { id: brand.id } })).logoKey ?? '';
    await client.upload(`/admin/brands/${brand.id}/logo`, 'image', [
      { buffer: await png(), filename: 'b.png', contentType: 'image/png' },
    ]);
    expect(memoryFiles().has(firstKey)).toBe(false);
  });

  it('CUSTOMER cannot upload', async () => {
    const { client } = await adminClient();
    const product = await newProduct(client);
    const customer = await createUser();
    const c = await TestClient.create();
    await c.login(customer.email);
    const res = await c.upload(`/admin/products/${product.id}/images`, 'images', [
      { buffer: await png(), filename: 'a.png', contentType: 'image/png' },
    ]);
    expect(res.status).toBe(403);
  });
});
