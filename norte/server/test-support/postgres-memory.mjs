import { DataType, newDb } from 'pg-mem';

/** pg-mem lacks timestamptz::text. Keep that emulator shim in tests;
 * postgres-refresh.test.mjs also runs the unchanged production SQL, including
 * legacy ADD COLUMN migration, against a disposable real PostgreSQL instance.
 */
export function createMemoryPostgresPool() {
  const database = newDb({ noAstCoverageCheck: true });
  database.public.registerFunction({ name: 'norte_timestamp_token', args: [DataType.timestamptz], returns: DataType.text, implementation: value => value.toISOString() });
  const { Pool } = database.adapters.createPg();
  const pool = new Pool(), query = pool.query.bind(pool);
  pool.query = async (sql, ...args) => {
    const result = await query(sql.replaceAll('updated_at::text', 'norte_timestamp_token(updated_at)'), ...args);
    return result;
  };
  return pool;
}
