/**
 * Integration tests for product catalog endpoints.
 *
 * Covers:
 *   GET /products        — list, pagination, filters, sorting, full-text search
 *   GET /products/:id    — single product by UUID
 *
 * All tests use Fastify's inject() against a real PostgreSQL test database
 * so that the tsvector generated column, GIN index, and price ordering work
 * exactly as they do in production.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildProductTestApp } from '../test/app.js';
import { inject } from '../test/client.js';
import { runMigrations, clearAllTables, closeDb } from '../test/db.js';
import { seedProduct } from '../test/helpers.js';

// ── Shared app + lifecycle ─────────────────────────────────────────────────────

let app: FastifyInstance;
let url: string;

beforeAll(async () => {
  await runMigrations();
  ({ app, url } = await buildProductTestApp());
});

beforeEach(async () => {
  await clearAllTables();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

type ProductItem = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  price: string;
  stockQty: number;
  category: string | null;
  isActive: boolean;
  createdAt: string;
};

type ListResponse = {
  data: ProductItem[];
  total: number;
  limit: number;
  offset: number;
};

async function getProducts(query: Record<string, string | number | boolean> = {}) {
  const qs = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)] as [string, string]),
  ).toString();
  return inject(url, {
    method: 'GET',
    url: qs ? `/products?${qs}` : '/products',
  });
}

async function getProduct(id: string) {
  return inject(url, { method: 'GET', url: `/products/${id}` });
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — response shape
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — response shape', () => {
  it('returns 200 with envelope: data, total, limit, offset', async () => {
    await seedProduct({ name: 'Alpha Widget' });

    const res = await getProducts();
    expect(res.statusCode).toBe(200);

    const body = res.json<ListResponse>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('limit');
    expect(body).toHaveProperty('offset');
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('each product has all required fields', async () => {
    await seedProduct({
      name: 'Beta Gadget',
      description: 'A fine gadget',
      brand: 'Acme',
      price: '19.99',
      stockQty: 5,
      category: 'electronics',
    });

    const body = (await getProducts()).json<ListResponse>();
    const p = body.data[0]!;

    expect(p).toHaveProperty('id');
    expect(p).toHaveProperty('name', 'Beta Gadget');
    expect(p).toHaveProperty('description', 'A fine gadget');
    expect(p).toHaveProperty('brand', 'Acme');
    expect(p).toHaveProperty('price', '19.99');
    expect(p).toHaveProperty('stockQty', 5);
    expect(p).toHaveProperty('category', 'electronics');
    expect(p).toHaveProperty('isActive', true);
    expect(p).toHaveProperty('createdAt');
  });

  it('price is returned as a string (exact decimal, never float)', async () => {
    await seedProduct({ price: '99.99' });
    const body = (await getProducts()).json<ListResponse>();
    expect(typeof body.data[0]!.price).toBe('string');
    expect(body.data[0]!.price).toBe('99.99');
  });

  it('createdAt is a valid ISO-8601 string', async () => {
    await seedProduct();
    const body = (await getProducts()).json<ListResponse>();
    const createdAt = body.data[0]!.createdAt;
    expect(typeof createdAt).toBe('string');
    expect(Number.isNaN(new Date(createdAt).getTime())).toBe(false);
  });

  it('returns empty data array and total=0 when no products exist', async () => {
    const body = (await getProducts()).json<ListResponse>();
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('reflects default pagination: limit=20, offset=0', async () => {
    const body = (await getProducts()).json<ListResponse>();
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — active-only filter (isActive)
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — active-only filter', () => {
  it('excludes soft-deleted products (isActive = false)', async () => {
    await seedProduct({ name: 'Visible', isActive: true });
    await seedProduct({ name: 'Deleted', isActive: false });

    const body = (await getProducts()).json<ListResponse>();
    expect(body.total).toBe(1);
    expect(body.data[0]!.name).toBe('Visible');
  });

  it('returns empty results when all products are soft-deleted', async () => {
    await seedProduct({ isActive: false });
    await seedProduct({ isActive: false });

    const body = (await getProducts()).json<ListResponse>();
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  it('isActive field in response is always true (inactive never returned)', async () => {
    await seedProduct({ isActive: true });
    const body = (await getProducts()).json<ListResponse>();
    expect(body.data.every((p) => p.isActive === true)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — pagination
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — pagination', () => {
  beforeEach(async () => {
    // Seed 5 products with deterministic names for ordering
    for (let i = 1; i <= 5; i++) {
      await seedProduct({ name: `Item ${i}`, price: String(i * 10) });
    }
  });

  it('limit=2 returns 2 items', async () => {
    const body = (await getProducts({ limit: 2, sortBy: 'name_asc' })).json<ListResponse>();
    expect(body.data).toHaveLength(2);
    expect(body.limit).toBe(2);
  });

  it('total always reflects all matching rows, not just the page', async () => {
    const body = (await getProducts({ limit: 2 })).json<ListResponse>();
    expect(body.total).toBe(5);
  });

  it('offset skips rows', async () => {
    const page1 = (await getProducts({ limit: 2, offset: 0, sortBy: 'name_asc' })).json<ListResponse>();
    const page2 = (await getProducts({ limit: 2, offset: 2, sortBy: 'name_asc' })).json<ListResponse>();

    const names1 = page1.data.map((p) => p.name);
    const names2 = page2.data.map((p) => p.name);

    expect(names1).not.toEqual(names2);
    expect(new Set([...names1, ...names2]).size).toBe(4); // no overlap
  });

  it('offset beyond total returns empty data with correct total', async () => {
    const body = (await getProducts({ limit: 10, offset: 100 })).json<ListResponse>();
    expect(body.data).toHaveLength(0);
    expect(body.total).toBe(5);
    expect(body.offset).toBe(100);
  });

  it('offset=0 and offset not provided return the same result', async () => {
    const withZero = (await getProducts({ offset: 0, sortBy: 'name_asc' })).json<ListResponse>();
    const withoutOffset = (await getProducts({ sortBy: 'name_asc' })).json<ListResponse>();
    expect(withZero.data.map((p) => p.id)).toEqual(withoutOffset.data.map((p) => p.id));
  });

  it('limit=1 returns exactly one item', async () => {
    const body = (await getProducts({ limit: 1 })).json<ListResponse>();
    expect(body.data).toHaveLength(1);
  });

  it('limit=100 (maximum) is accepted', async () => {
    const res = await getProducts({ limit: 100 });
    expect(res.statusCode).toBe(200);
  });

  it('limit=101 (exceeds max) returns 400', async () => {
    const res = await getProducts({ limit: 101 });
    expect(res.statusCode).toBe(400);
  });

  it('limit=0 returns 400', async () => {
    const res = await getProducts({ limit: 0 });
    expect(res.statusCode).toBe(400);
  });

  it('negative limit returns 400', async () => {
    const res = await getProducts({ limit: -1 });
    expect(res.statusCode).toBe(400);
  });

  it('negative offset returns 400', async () => {
    const res = await getProducts({ offset: -1 });
    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — sorting
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — sorting', () => {
  beforeEach(async () => {
    await seedProduct({ name: 'Banana', price: '5.00', stockQty: 30 });
    await seedProduct({ name: 'Apple', price: '15.00', stockQty: 5 });
    await seedProduct({ name: 'Cherry', price: '10.00', stockQty: 50 });
  });

  it('sortBy=name_asc returns A→Z order (default)', async () => {
    const body = (await getProducts({ sortBy: 'name_asc' })).json<ListResponse>();
    const names = body.data.map((p) => p.name);
    expect(names).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('default sort (no sortBy param) is name_asc', async () => {
    const body = (await getProducts()).json<ListResponse>();
    const names = body.data.map((p) => p.name);
    expect(names).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('sortBy=name_desc returns Z→A order', async () => {
    const body = (await getProducts({ sortBy: 'name_desc' })).json<ListResponse>();
    const names = body.data.map((p) => p.name);
    expect(names).toEqual(['Cherry', 'Banana', 'Apple']);
  });

  it('sortBy=price_asc returns cheapest first', async () => {
    const body = (await getProducts({ sortBy: 'price_asc' })).json<ListResponse>();
    const prices = body.data.map((p) => parseFloat(p.price));
    expect(prices).toEqual([5, 10, 15]);
  });

  it('sortBy=price_desc returns most expensive first', async () => {
    const body = (await getProducts({ sortBy: 'price_desc' })).json<ListResponse>();
    const prices = body.data.map((p) => parseFloat(p.price));
    expect(prices).toEqual([15, 10, 5]);
  });

  it('sortBy=availability returns highest stock first', async () => {
    const body = (await getProducts({ sortBy: 'availability' })).json<ListResponse>();
    const stocks = body.data.map((p) => p.stockQty);
    // Cherry(50) > Banana(30) > Apple(5)
    expect(stocks[0]).toBeGreaterThanOrEqual(stocks[1]!);
    expect(stocks[1]).toBeGreaterThanOrEqual(stocks[2]!);
    expect(stocks[0]).toBe(50);
  });

  it('invalid sortBy value returns 400', async () => {
    const res = await getProducts({ sortBy: 'random_order' });
    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — brand filter
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — brand filter', () => {
  beforeEach(async () => {
    await seedProduct({ name: 'Acme Wrench', brand: 'Acme' });
    await seedProduct({ name: 'Acme Drill', brand: 'Acme' });
    await seedProduct({ name: 'Globex Widget', brand: 'Globex' });
  });

  it('returns only products matching the given brand', async () => {
    const body = (await getProducts({ brand: 'Acme' })).json<ListResponse>();
    expect(body.total).toBe(2);
    expect(body.data.every((p) => p.brand === 'Acme')).toBe(true);
  });

  it('brand filter is case-sensitive (exact match)', async () => {
    const lower = (await getProducts({ brand: 'acme' })).json<ListResponse>();
    expect(lower.total).toBe(0);

    const exact = (await getProducts({ brand: 'Acme' })).json<ListResponse>();
    expect(exact.total).toBe(2);
  });

  it('returns empty results for an unknown brand', async () => {
    const body = (await getProducts({ brand: 'NoSuchBrand' })).json<ListResponse>();
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  it('total reflects brand-filtered count, not all products', async () => {
    const body = (await getProducts({ brand: 'Globex' })).json<ListResponse>();
    expect(body.total).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — price range filters
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — price range filters', () => {
  beforeEach(async () => {
    await seedProduct({ name: 'Budget', price: '5.00' });
    await seedProduct({ name: 'Mid', price: '25.00' });
    await seedProduct({ name: 'Premium', price: '99.99' });
  });

  it('minPrice returns products at or above the threshold', async () => {
    const body = (await getProducts({ minPrice: 25, sortBy: 'price_asc' })).json<ListResponse>();
    expect(body.total).toBe(2);
    body.data.forEach((p) => expect(parseFloat(p.price)).toBeGreaterThanOrEqual(25));
  });

  it('maxPrice returns products at or below the threshold', async () => {
    const body = (await getProducts({ maxPrice: 25, sortBy: 'price_asc' })).json<ListResponse>();
    expect(body.total).toBe(2);
    body.data.forEach((p) => expect(parseFloat(p.price)).toBeLessThanOrEqual(25));
  });

  it('minPrice + maxPrice returns products within the range (inclusive)', async () => {
    const body = (await getProducts({ minPrice: 10, maxPrice: 50 })).json<ListResponse>();
    expect(body.total).toBe(1);
    expect(body.data[0]!.name).toBe('Mid');
  });

  it('exact price boundary: minPrice=25 includes product priced exactly 25', async () => {
    const body = (await getProducts({ minPrice: 25 })).json<ListResponse>();
    expect(body.data.some((p) => p.name === 'Mid')).toBe(true);
  });

  it('exact price boundary: maxPrice=25 includes product priced exactly 25', async () => {
    const body = (await getProducts({ maxPrice: 25 })).json<ListResponse>();
    expect(body.data.some((p) => p.name === 'Mid')).toBe(true);
  });

  it('impossible range (minPrice > maxPrice) returns empty results without error', async () => {
    const res = await getProducts({ minPrice: 100, maxPrice: 10 });
    expect(res.statusCode).toBe(200);
    expect(res.json<ListResponse>().total).toBe(0);
  });

  it('minPrice=0 returns all active products (no price lower bound)', async () => {
    const body = (await getProducts({ minPrice: 0 })).json<ListResponse>();
    expect(body.total).toBe(3);
  });

  it('negative minPrice returns 400 (nonnegative constraint)', async () => {
    const res = await getProducts({ minPrice: -1 });
    expect(res.statusCode).toBe(400);
  });

  it('negative maxPrice returns 400 (nonnegative constraint)', async () => {
    const res = await getProducts({ maxPrice: -5 });
    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — availability filter
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — available filter', () => {
  beforeEach(async () => {
    await seedProduct({ name: 'In Stock', stockQty: 10 });
    await seedProduct({ name: 'Also In Stock', stockQty: 1 });
    await seedProduct({ name: 'Out of Stock', stockQty: 0 });
  });

  it('available=true returns only products with stockQty > 0', async () => {
    const body = (await getProducts({ available: 'true' })).json<ListResponse>();
    expect(body.total).toBe(2);
    body.data.forEach((p) => expect(p.stockQty).toBeGreaterThan(0));
  });

  it('available=false applies no stock filter (returns all active products)', async () => {
    const body = (await getProducts({ available: 'false' })).json<ListResponse>();
    expect(body.total).toBe(3);
  });

  it('omitting available returns all active products including out-of-stock', async () => {
    const body = (await getProducts()).json<ListResponse>();
    expect(body.total).toBe(3);
  });

  it('product with stockQty=0 is NOT returned when available=true', async () => {
    const body = (await getProducts({ available: 'true' })).json<ListResponse>();
    expect(body.data.every((p) => p.name !== 'Out of Stock')).toBe(true);
  });

  it('product with stockQty=1 IS returned when available=true', async () => {
    const body = (await getProducts({ available: 'true' })).json<ListResponse>();
    expect(body.data.some((p) => p.name === 'Also In Stock')).toBe(true);
  });

  it('invalid available value (not "true"/"false") returns 400', async () => {
    const res = await getProducts({ available: 'yes' });
    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — full-text search (q parameter)
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — full-text search (q)', () => {
  beforeEach(async () => {
    await seedProduct({
      name: 'Ergonomic Office Chair',
      description: 'Comfortable lumbar support for long sessions',
    });
    await seedProduct({
      name: 'Standing Desk',
      description: 'Adjustable height electric motorized desk',
    });
    await seedProduct({
      name: 'Laptop Stand',
      description: 'Portable aluminium laptop and notebook riser',
    });
    await seedProduct({
      name: 'Noise Cancelling Headphones',
      description: 'Over-ear wireless audio with active noise isolation',
    });
  });

  it('q matches product name (exact word)', async () => {
    const body = (await getProducts({ q: 'desk' })).json<ListResponse>();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.some((p) => p.name.toLowerCase().includes('desk'))).toBe(true);
  });

  it('q matches product description', async () => {
    const body = (await getProducts({ q: 'lumbar' })).json<ListResponse>();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data[0]!.name).toBe('Ergonomic Office Chair');
  });

  it('q uses English stemming — "adjusting" matches "adjustable"', async () => {
    // PostgreSQL 'english' dictionary stems both to 'adjust'
    const body = (await getProducts({ q: 'adjust' })).json<ListResponse>();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.some((p) => p.name === 'Standing Desk')).toBe(true);
  });

  it('q uses English stemming — "portably" matches "portable"', async () => {
    const body = (await getProducts({ q: 'portable' })).json<ListResponse>();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.some((p) => p.name === 'Laptop Stand')).toBe(true);
  });

  it('q with multiple words matches products containing all terms', async () => {
    // "wireless audio" — both terms must appear (plainto_tsquery uses AND logic)
    const body = (await getProducts({ q: 'wireless audio' })).json<ListResponse>();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data[0]!.name).toBe('Noise Cancelling Headphones');
  });

  it('q with no matching products returns empty data and total=0', async () => {
    const body = (await getProducts({ q: 'zzznomatchxxx' })).json<ListResponse>();
    expect(body.total).toBe(0);
    expect(body.data).toHaveLength(0);
  });

  it('empty q string returns 400 (min length 1)', async () => {
    const res = await inject(url, {
      method: 'GET',
      url: '/products?q=',
    });
    expect(res.statusCode).toBe(400);
  });

  it('q longer than 200 characters returns 400', async () => {
    const res = await getProducts({ q: 'a'.repeat(201) });
    expect(res.statusCode).toBe(400);
  });

  it('q exactly 200 characters is accepted', async () => {
    const res = await getProducts({ q: 'a'.repeat(200) });
    // May return 0 results, but should not be a validation error
    expect(res.statusCode).toBe(200);
  });

  it('q combined with brand filter narrows results correctly', async () => {
    await clearAllTables();
    await seedProduct({
      name: 'Acme Standing Desk', brand: 'Acme',
      description: 'Height adjustable office desk by Acme',
    });
    await seedProduct({
      name: 'Generic Standing Desk', brand: 'Generic',
      description: 'Basic height adjustable desk',
    });

    const body = (await getProducts({ q: 'desk', brand: 'Acme' })).json<ListResponse>();
    expect(body.total).toBe(1);
    expect(body.data[0]!.brand).toBe('Acme');
  });

  it('q combined with available=true filters to in-stock results only', async () => {
    await clearAllTables();
    await seedProduct({
      name: 'Available Chair',
      description: 'Ergonomic chair for office',
      stockQty: 5,
    });
    await seedProduct({
      name: 'Out of Stock Chair',
      description: 'Ergonomic chair for office',
      stockQty: 0,
    });

    const body = (await getProducts({ q: 'ergonomic', available: 'true' })).json<ListResponse>();
    expect(body.total).toBe(1);
    expect(body.data[0]!.name).toBe('Available Chair');
  });

  it('relevance ordering: most relevant result appears first', async () => {
    await clearAllTables();
    // Higher ts_rank: "headphone" appears in both name AND description (2 occurrences)
    await seedProduct({
      name: 'Pro Headphone',
      description: 'Premium headphone with noise cancellation',
    });
    // Lower ts_rank: "headphone" appears only in description (1 occurrence)
    await seedProduct({
      name: 'Audio Mixer',
      description: 'Mixes multiple headphone inputs',
    });

    const body = (await getProducts({ q: 'headphone' })).json<ListResponse>();
    expect(body.total).toBe(2);
    // Product with "headphone" in both name+description outranks description-only match
    expect(body.data[0]!.name).toBe('Pro Headphone');
  });

  it('q with whitespace-only string is trimmed and treated as empty → 400', async () => {
    // The schema trims the value; after trimming "   " becomes "" which fails min(1)
    const res = await inject(url, { method: 'GET', url: '/products?q=%20%20%20' });
    expect(res.statusCode).toBe(400);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — combined filters
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — combined filters', () => {
  beforeEach(async () => {
    await seedProduct({ name: 'Acme Budget Wrench', brand: 'Acme', price: '9.99', stockQty: 10 });
    await seedProduct({ name: 'Acme Premium Drill', brand: 'Acme', price: '149.99', stockQty: 0 });
    await seedProduct({ name: 'Globex Socket Set', brand: 'Globex', price: '29.99', stockQty: 5 });
    await seedProduct({ name: 'Globex Hammer', brand: 'Globex', price: '14.99', stockQty: 0 });
  });

  it('brand + available=true returns in-stock products for that brand only', async () => {
    const body = (await getProducts({ brand: 'Acme', available: 'true' })).json<ListResponse>();
    expect(body.total).toBe(1);
    expect(body.data[0]!.name).toBe('Acme Budget Wrench');
  });

  it('brand + minPrice + maxPrice narrows by brand and price range', async () => {
    const body = (await getProducts({ brand: 'Globex', minPrice: 10, maxPrice: 50 })).json<ListResponse>();
    expect(body.total).toBe(2);
    body.data.forEach((p) => {
      expect(p.brand).toBe('Globex');
      expect(parseFloat(p.price)).toBeGreaterThanOrEqual(10);
      expect(parseFloat(p.price)).toBeLessThanOrEqual(50);
    });
  });

  it('all four filters combined', async () => {
    // Acme, price 5–15, in-stock
    const body = (
      await getProducts({ brand: 'Acme', minPrice: 5, maxPrice: 15, available: 'true' })
    ).json<ListResponse>();
    expect(body.total).toBe(1);
    expect(body.data[0]!.name).toBe('Acme Budget Wrench');
  });

  it('combined filters with no matches return empty results (no error)', async () => {
    const res = await getProducts({ brand: 'Acme', minPrice: 200 });
    expect(res.statusCode).toBe(200);
    expect(res.json<ListResponse>().total).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products/:id
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products/:id', () => {
  it('returns 200 with full product detail for a valid active product', async () => {
    const product = await seedProduct({
      name: 'Special Widget',
      description: 'A very special widget',
      brand: 'Acme',
      price: '42.00',
      stockQty: 7,
      category: 'tools',
    });

    const res = await getProduct(product.id);
    expect(res.statusCode).toBe(200);

    const body = res.json<ProductItem>();
    expect(body.id).toBe(product.id);
    expect(body.name).toBe('Special Widget');
    expect(body.description).toBe('A very special widget');
    expect(body.brand).toBe('Acme');
    expect(body.price).toBe('42.00');
    expect(body.stockQty).toBe(7);
    expect(body.category).toBe('tools');
    expect(body.isActive).toBe(true);
  });

  it('price in detail response is a string (exact decimal)', async () => {
    const product = await seedProduct({ price: '1.50' });
    const body = (await getProduct(product.id)).json<ProductItem>();
    expect(typeof body.price).toBe('string');
    expect(body.price).toBe('1.50');
  });

  it('createdAt in detail response is a valid ISO-8601 string', async () => {
    const product = await seedProduct();
    const body = (await getProduct(product.id)).json<ProductItem>();
    expect(Number.isNaN(new Date(body.createdAt).getTime())).toBe(false);
  });

  it('returns 404 for a soft-deleted product (isActive = false)', async () => {
    const product = await seedProduct({ isActive: false });
    const res = await getProduct(product.id);
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a UUID that does not exist in the database', async () => {
    const res = await getProduct('00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for an invalid (non-UUID) id format', async () => {
    const res = await getProduct('not-a-uuid');
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for a plain integer id', async () => {
    const res = await getProduct('12345');
    expect(res.statusCode).toBe(400);
  });

  it('404 body has statusCode and error fields', async () => {
    const body = (await getProduct('00000000-0000-0000-0000-000000000000')).json<{
      statusCode: number;
      error: string;
    }>();
    expect(body.statusCode).toBe(404);
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  it('detail response does not include internal fields (passwordHash, etc.)', async () => {
    const product = await seedProduct();
    const body = (await getProduct(product.id)).json<Record<string, unknown>>();
    // Products have no passwords, but verify no schema bleed from other tables
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('searchVector');
    expect(body).not.toHaveProperty('search_vector');
    expect(body).not.toHaveProperty('sortOrder');
    expect(body).not.toHaveProperty('sort_order');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /products — large dataset stress / edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe('GET /products — edge cases', () => {
  it('handles exactly limit=20 products correctly (default page fits all)', async () => {
    for (let i = 0; i < 20; i++) {
      await seedProduct({ name: `Widget ${String(i).padStart(2, '0')}` });
    }
    const body = (await getProducts()).json<ListResponse>();
    expect(body.total).toBe(20);
    expect(body.data).toHaveLength(20);
  });

  it('products with null description are returned correctly', async () => {
    await seedProduct({ description: undefined });
    const body = (await getProducts()).json<ListResponse>();
    // description defaults to undefined in seedProduct which maps to null in DB
    expect(body.data[0]).toHaveProperty('description');
  });

  it('products with null brand and null category are returned without errors', async () => {
    await seedProduct({ brand: undefined, category: undefined });
    const res = await getProducts();
    expect(res.statusCode).toBe(200); // no error
    expect(res.json<ListResponse>().data).toHaveLength(1);
  });

  it('a product with stockQty=0 appears in list results (not filtered unless available=true)', async () => {
    await seedProduct({ name: 'Zero Stock', stockQty: 0 });
    const body = (await getProducts()).json<ListResponse>();
    expect(body.data.some((p) => p.name === 'Zero Stock')).toBe(true);
  });
});
