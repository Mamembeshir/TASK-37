#!/bin/sh
set -e

cd /app/backend

echo "==> Applying database migrations..."
pnpm drizzle-kit migrate

echo "==> Seeding default accounts..."
pnpm tsx src/db/seed.ts

echo "==> Seeding demo data..."
pnpm tsx src/db/seed-data.ts

echo "==> Starting backend server..."
exec pnpm dev
