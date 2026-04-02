/**
 * Minimal Fastify application factory for integration tests.
 *
 * Registers only the plugins required for a given route group — keeps
 * tests fast and isolated without spinning up the full index.ts stack
 * (no background jobs, no CORS, no multipart, etc.).
 *
 * Usage:
 *   const { app, url } = await buildAuthTestApp();
 *   const res = await inject(url, { method: 'POST', url: '/auth/login', ... });
 *   await app.close();
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'net';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import multipart from '@fastify/multipart';
import zodValidator from '../plugins/zod-validator.js';
import errorHandler from '../plugins/error-handler.js';
import requireAuth from '../plugins/require-auth.js';
import authRoutes from '../routes/auth.js';
import productRoutes from '../routes/products.js';
import cartRoutes from '../routes/cart.js';
import orderRoutes from '../routes/orders.js';
import reviewRoutes from '../routes/reviews.js';
import moderationRoutes from '../routes/moderation.js';
import adminRulesRoutes from '../routes/admin/rules.js';
import { testDb } from './db.js';
import type { db } from '../db/index.js';

// Tell TypeScript about the db decoration (mirrors index.ts declaration).
declare module 'fastify' {
  interface FastifyInstance {
    db: typeof db;
  }
}

/**
 * Build a test app with auth routes + requireAuth plugin wired up.
 * Optionally accepts a `configureExtra` callback to register additional
 * test-only routes (e.g. for RBAC checks).
 */
export async function buildAuthTestApp(
  configureExtra?: (app: FastifyInstance) => Promise<void>,
): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  // Decorate with the test DB instance before any plugin that reads fastify.db.
  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });

  if (configureExtra) {
    await configureExtra(app);
  }

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

/**
 * Build a test app with only the public product catalog routes.
 * No auth required — matches the SPEC (kiosk catalog browsing is public).
 */
export async function buildProductTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(productRoutes, { prefix: '/products' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

/**
 * Build a test app with auth + cart routes.
 * All cart endpoints require authentication, so auth routes are included
 * to allow tests to log in and obtain a session cookie.
 */
export async function buildCartTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(cartRoutes, { prefix: '/cart' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

/**
 * Build a test app with auth + order routes.
 * Cart state is set up directly via the test DB for speed.
 * Auth routes are included so tests can log in as customer or staff.
 */
export async function buildOrderTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(orderRoutes, { prefix: '/orders' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

/**
 * Build a test app with auth + review routes (multipart enabled).
 * POST /reviews uses multipart/form-data so @fastify/multipart must be registered.
 */
export async function buildReviewTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(multipart, { limits: { fileSize: 5_242_880 } });
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(reviewRoutes, { prefix: '/reviews' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

/**
 * Build a test app with auth + moderation routes.
 */
export async function buildModerationTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(moderationRoutes, { prefix: '/moderation' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

/**
 * Build a test app with auth + admin rules routes.
 * Auth: admin role only.
 */
export async function buildAdminRulesTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(adminRulesRoutes, { prefix: '/admin/rules' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

import ticketRoutes from '../routes/tickets.js';
import associateRoutes from '../routes/associate.js';
import notificationRoutes from '../routes/notifications.js';

/**
 * Build a test app with auth + ticket routes + notification routes.
 * Customers open tickets; staff act on them.
 */
export async function buildTicketTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(ticketRoutes, { prefix: '/tickets' });
  await app.register(notificationRoutes, { prefix: '/notifications' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}

/**
 * Build a test app with auth + associate queue + ticket lifecycle routes.
 */
export async function buildAssociateTestApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();

  app.decorate('db', testDb as unknown as typeof db);

  await app.register(zodValidator);
  await app.register(errorHandler);
  await app.register(requireAuth);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(associateRoutes, { prefix: '/associate' });
  await app.register(ticketRoutes, { prefix: '/tickets' });

  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${port}` };
}
