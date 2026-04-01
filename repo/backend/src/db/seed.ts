/**
 * Development seed — inserts one account per role.
 * Runs automatically on `docker-compose up` via entrypoint.sh.
 * Safe to re-run: skips any username that already exists.
 */

import bcrypt from 'bcrypt';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { users } from './schema/index.js';
import { sql } from 'drizzle-orm';

const SEED_ACCOUNTS = [
  { username: 'customer',   password: 'customer1234',   role: 'customer'   },
  { username: 'associate',  password: 'associate1234',  role: 'associate'  },
  { username: 'supervisor', password: 'supervisor1234', role: 'supervisor' },
  { username: 'manager',    password: 'manager1234',    role: 'manager'    },
  { username: 'admin',      password: 'admin12345',     role: 'admin'      },
] as const;

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  console.log('==> Seeding accounts...');

  for (const account of SEED_ACCOUNTS) {
    const passwordHash = await bcrypt.hash(account.password, 10);

    const existing = await db.execute(
      sql`SELECT id FROM users WHERE username = ${account.username} LIMIT 1`
    );

    if (existing.length > 0) {
      // Always sync the password so seed changes take effect on re-run
      await db.execute(
        sql`UPDATE users SET password_hash = ${passwordHash}, role = ${account.role} WHERE username = ${account.username}`
      );
      console.log(`    updated  ${account.role.padEnd(10)} → ${account.username}`);
    } else {
      await db.insert(users).values({
        username: account.username,
        passwordHash,
        role: account.role,
      });
      console.log(`    inserted ${account.role.padEnd(10)} → ${account.username}`);
    }
  }

  await client.end();
  console.log('==> Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
