import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export function isCloudSqlConfigured(): boolean {
  return Boolean(
    process.env.SQL_HOST &&
      process.env.SQL_USER &&
      process.env.SQL_PASSWORD &&
      process.env.SQL_DB_NAME
  );
}

/** Fails explicitly when durable SQL is required but not configured. */
export function requireCloudSql(): void {
  if (!isCloudSqlConfigured()) {
    throw new Error('CLOUD_SQL_NOT_CONFIGURED');
  }
}

export const createPool = (): Pool | null => {
  if (!isCloudSqlConfigured()) {
    return null;
  }
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

type Database = ReturnType<typeof drizzle<typeof schema>>;

let database: Database | undefined;

/** Lazily connects to Cloud SQL. Never falls back to an in-memory or no-op database. */
function getDatabase(): Database {
  if (!database) {
    const pool = createPool();
    if (!pool) {
      throw new Error('CLOUD_SQL_NOT_CONFIGURED');
    }
    database = drizzle(pool, { schema });
  }
  return database;
}

// Forwards every call to the real Drizzle client. Without SQL configuration the
// first use fails explicitly with CLOUD_SQL_NOT_CONFIGURED instead of returning fake data.
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDatabase();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
