import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL || '';
    const isRailwayInternal = /railway\.internal/i.test(dbUrl);
    const shouldUseSsl = process.env.NODE_ENV === 'production' && !isRailwayInternal;
    // 调试：打印实际读到的 DATABASE_URL（脱敏）
    const masked = dbUrl
      ? dbUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')
      : '(empty)';
    console.log('[DB] DATABASE_URL =', masked);
    console.log('[DB] SSL =', shouldUseSsl ? 'enabled' : 'disabled');
    pool = new Pool({
      connectionString: dbUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000,
      ssl: shouldUseSsl
        ? { rejectUnauthorized: false }
        : false,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });
  }
  return pool;
}

export const db = {
  query: (text: string, params?: any[]) => getPool().query(text, params),

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};

/** 执行 schema.sql 初始化数据库表 */
export async function runMigrations(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');
  await db.query(sql);
  console.log('[DB] Migrations completed.');
}
