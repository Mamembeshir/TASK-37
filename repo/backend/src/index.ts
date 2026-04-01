import Fastify from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import { db } from './db/index';
import errorHandler from './plugins/error-handler';
import requestLogger from './plugins/request-logger';
import zodValidator from './plugins/zod-validator';
import authRoutes from './routes/auth';
import productRoutes from './routes/products';
import adminProductRoutes from './routes/admin/products';
import adminCampaignRoutes from './routes/admin/campaigns';
import recommendationRoutes from './routes/recommendations';
import cartRoutes from './routes/cart';
import orderRoutes from './routes/orders';
import reviewRoutes from './routes/reviews';
import moderationRoutes from './routes/moderation';
import adminBannedTermsRoutes from './routes/admin/banned-terms';
import adminRulesRoutes from './routes/admin/rules';
import adminAuditLogsRoutes from './routes/admin/audit-logs';
import ticketRoutes from './routes/tickets';
import associateRoutes from './routes/associate';
import notificationRoutes from './routes/notifications';
import customerRoutes from './routes/customers';
import { runExpireCartsJob } from './jobs/expire-carts';
import requireAuth from './plugins/require-auth';

const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

const host = process.env.HOST ?? '0.0.0.0';
const port = parseInt(process.env.PORT ?? '3000', 10);
const maxImageBytes = parseInt(process.env.MAX_IMAGE_SIZE_BYTES ?? '5242880', 10);

// Local-network-only CORS: allow localhost and RFC-1918 private ranges only
const LOCAL_ORIGIN_RE =
  /^https?:\/\/(localhost|127\.0\.0\.1|(10|192\.168)\.\d{1,3}\.\d{1,3}|(172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}))(:\d+)?$/;

await app.register(cors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (same-origin, curl, healthchecks)
    if (!origin || LOCAL_ORIGIN_RE.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error('CORS: origin not allowed'), false);
    }
  },
  credentials: true,
});

// Zod validator must be registered before any route that uses schema validation
await app.register(zodValidator);

// Error handler must be registered before routes so it catches everything
await app.register(errorHandler);
await app.register(requestLogger);

// Multipart file uploads — limit individual files to MAX_IMAGE_SIZE_BYTES
await app.register(multipart, {
  limits: {
    fileSize: maxImageBytes,
    files: 6, // Max images per review per SPEC
  },
});

// application/x-www-form-urlencoded support
await app.register(formbody);

// requireAuth preHandler — must be registered before any route that uses it
await app.register(requireAuth);

// Auth routes
await app.register(authRoutes, { prefix: '/auth' });

// Catalog routes (public — no auth required for browsing)
await app.register(productRoutes, { prefix: '/products' });

// Admin catalog management (admin role only)
await app.register(adminProductRoutes, { prefix: '/admin/products' });

// Admin campaign management (admin role only)
await app.register(adminCampaignRoutes, { prefix: '/admin/campaigns' });

// Recommendation panel (public — kiosk browsing)
await app.register(recommendationRoutes, { prefix: '/recommendations' });

// Cart management (authenticated customers)
await app.register(cartRoutes, { prefix: '/cart' });

// Order management
await app.register(orderRoutes, { prefix: '/orders' });

// Reviews (customers submit post-pickup; staff can read any)
await app.register(reviewRoutes, { prefix: '/reviews' });

// Moderation — customer reporting and staff appeals resolution
await app.register(moderationRoutes, { prefix: '/moderation' });

// Admin — banned terms management
await app.register(adminBannedTermsRoutes, { prefix: '/admin/banned-terms' });

// Admin — rules engine CRUD and versioning
await app.register(adminRulesRoutes, { prefix: '/admin/rules' });

// Admin — immutable audit log viewer (task 145)
await app.register(adminAuditLogsRoutes, { prefix: '/admin/audit-logs' });

// After-sales tickets
await app.register(ticketRoutes, { prefix: '/tickets' });

// Associate queue (staff-facing ticket queue by department)
await app.register(associateRoutes, { prefix: '/associate' });

// In-app notifications (customers only; no email/SMS per spec task 121)
await app.register(notificationRoutes, { prefix: '/notifications' });

// Customer loyalty — points balance and tier (task 141)
await app.register(customerRoutes, { prefix: '/customers' });

// Expected tables from the initial migration
const EXPECTED_TABLES = [
  'after_sales_tickets', 'audit_logs', 'banned_terms', 'campaigns',
  'cart_items', 'carts', 'image_hashes', 'moderation_appeals',
  'moderation_flags', 'notifications', 'order_items', 'orders',
  'pickup_group_items', 'pickup_groups', 'products', 'review_images',
  'reviews', 'rules', 'rules_history', 'tender_splits',
  'ticket_events', 'users',
] as const;

/**
 * Health check — actively verifies DB connectivity and confirms all 22
 * expected tables exist.  Used by Docker healthcheck and README verification.
 * Returns HTTP 503 if the DB is unreachable or tables are missing.
 */
app.get('/health', async (_req, reply) => {
  let dbStatus: 'ok' | 'error' = 'error';
  let tables: string[] = [];
  let missingTables: string[] = [];

  try {
    const rows = await db.execute<{ table_name: string }>(
      sql`SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
    );
    tables = rows.map((r) => r.table_name);
    missingTables = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    dbStatus = missingTables.length === 0 ? 'ok' : 'error';
  } catch {
    dbStatus = 'error';
  }

  const healthy = dbStatus === 'ok';
  return reply.status(healthy ? 200 : 503).send({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    db: {
      status: dbStatus,
      tableCount: tables.length,
      expectedTableCount: EXPECTED_TABLES.length,
      ...(missingTables.length > 0 ? { missingTables } : {}),
    },
  });
});

// Decorate app with db so routes can access it via fastify.db
app.decorate('db', db);

declare module 'fastify' {
  interface FastifyInstance {
    db: typeof db;
  }
}

try {
  await app.listen({ host, port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// ── Background jobs ────────────────────────────────────────────────────────────

/**
 * Cart expiry job — runs every 60 seconds.
 * Finds active carts past their 30-min expiry, releases stock, writes audit log.
 * SPEC Q7: "cart cannot resume; logs record expiration timestamp."
 */
const CART_EXPIRY_INTERVAL_MS = 60_000;

async function runAndLogExpireCartsJob() {
  try {
    await runExpireCartsJob(db);
  } catch (err) {
    app.log.error({ err }, 'expire-carts job failed');
  }
}

// Run immediately on start to catch any carts that expired during downtime,
// then repeat on the interval.
runAndLogExpireCartsJob();
setInterval(runAndLogExpireCartsJob, CART_EXPIRY_INTERVAL_MS);
