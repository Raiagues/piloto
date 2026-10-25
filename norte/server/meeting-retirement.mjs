import { createHash } from 'node:crypto';

const TABLES = [
  'norte_users', 'norte_sessions', 'norte_records', 'ai_jobs', 'ai_usage',
  'ai_block_memory', 'ai_block_requests', 'ai_block_uses', 'ai_block_feedback',
  'ai_block_evaluations', 'ai_meeting_learning',
  // Retired worker tables: backup/removal only; never created by the app.
  'ai_events', 'ai_proposals', 'ai_evaluations', 'ai_aliases'
];
const digest = value => createHash('sha256').update(value).digest('hex');
const quoted = name => '"' + name.replaceAll('"', '""') + '"';
const failure = (code, message) => Object.assign(new Error(message), { code });

function meetingIds(value) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(id))) {
    throw failure('RETIREMENT_CONFIG_INVALID', 'Supply explicit meeting IDs for retirement.');
  }
  return [...new Set(value)].sort();
}

async function snapshot(query, removedIds, lock = false) {
  const ids = meetingIds(removedIds);
  const columns = await query(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`, [TABLES]);
  const tables = TABLES.filter(table => columns.rows.some(row => row.table_name === table));
  for (const table of tables) {
    const required = table === 'norte_users' ? ['id', 'username'] : ['user_id'];
    if (required.some(column => !columns.rows.some(row => row.table_name === table && row.column_name === column))) {
      throw failure('RETIREMENT_SCHEMA_INCOMPATIBLE', 'Worker table is incompatible with retirement: ' + table);
    }
  }
  if (tables.length && !tables.includes('norte_users')) throw failure('RETIREMENT_SCHEMA_INCOMPATIBLE', 'Worker identities are missing.');
  // Keep the backup snapshot stable against worker writes until the caller commits.
  if (lock && tables.length) await query('LOCK TABLE ' + tables.map(quoted).join(', ') + ' IN SHARE ROW EXCLUSIVE MODE');
  const references = await query(`SELECT child.relname AS table_name, child_ns.nspname AS table_schema,
      parent.relname AS referenced_table, child_column.attname AS column_name,
      parent_column.attname AS referenced_column, cardinality(foreign_key.conkey) AS column_count,
      current_schema() AS active_schema
    FROM pg_catalog.pg_constraint foreign_key
    JOIN pg_catalog.pg_class child ON child.oid = foreign_key.conrelid
    JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_catalog.pg_class parent ON parent.oid = foreign_key.confrelid
    JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    JOIN pg_catalog.pg_attribute child_column ON child_column.attrelid = child.oid AND child_column.attnum = foreign_key.conkey[1]
    JOIN pg_catalog.pg_attribute parent_column ON parent_column.attrelid = parent.oid AND parent_column.attnum = foreign_key.confkey[1]
    WHERE foreign_key.contype = 'f' AND parent_ns.nspname = current_schema()
      AND parent.relname = ANY($1::text[])`, [tables]);
  const unknownReferences = references.rows.filter(row => row.table_schema !== row.active_schema || !tables.includes(row.table_name)
    || row.referenced_table !== 'norte_users' || row.column_name !== 'user_id'
    || row.referenced_column !== 'id' || row.column_count !== 1);
  if (unknownReferences.length) {
    const error = failure('RETIREMENT_UNKNOWN_FOREIGN_KEY', 'An unrecognized foreign key prevents safe meeting retirement.');
    error.retirementDetails = { unknownReferences: unknownReferences.map(row => ({
      table: row.table_name, schema: row.table_schema, column: row.column_name,
      referencedTable: row.referenced_table, referencedColumn: row.referenced_column, columnCount: row.column_count
    })) };
    throw error;
  }
  const names = ids.map(id => 'bridge.' + digest('meeting:' + id).slice(0, 25));
  const users = tables.includes('norte_users') && names.length
    ? await query('SELECT id::text AS id FROM norte_users WHERE username = ANY($1::text[]) ORDER BY id', [names])
    : { rows: [] };
  const userIds = users.rows.map(row => row.id).sort();
  const rowsByTable = {};
  for (const table of tables) {
    const field = table === 'norte_users' ? 'id' : 'user_id';
    // JSON text preserves BIGINTs and timestamp precision in the private backup.
    const result = userIds.length
      ? await query(`SELECT row_to_json(entry)::text AS record FROM ${quoted(table)} entry WHERE ${field} = ANY($1::bigint[])`, [userIds])
      : { rows: [] };
    rowsByTable[table] = result.rows.map(row => row.record).sort();
  }
  const payload = { format: 'norte.meeting-retirement.v1', tables: rowsByTable };
  const counts = Object.fromEntries(tables.map(table => [table, rowsByTable[table].length]));
  const fingerprint = digest(JSON.stringify({ meetingIds: ids, userIds, payload }));
  return { fingerprint, meetingIds: ids, userIds, counts, payload };
}

/** Read-only plan. Payload contains private rows and must never be logged. */
export function planMeetingRetirement(query, removedMeetingIds) {
  return snapshot(query, removedMeetingIds);
}

/** Caller owns the transaction; backup must persist the plan before deletion. */
export async function applyMeetingRetirement(query, removedMeetingIds, { expectedFingerprint, backup } = {}) {
  if (typeof backup !== 'function' || !/^[a-f0-9]{64}$/.test(expectedFingerprint || '')) {
    throw failure('RETIREMENT_CONFIG_INVALID', 'A reviewed fingerprint and persistent backup callback are required.');
  }
  const plan = await snapshot(query, removedMeetingIds, true);
  if (plan.fingerprint !== expectedFingerprint) throw failure('RETIREMENT_FINGERPRINT_MISMATCH', 'Meeting retirement plan changed; review it again.');
  await backup(plan);
  for (const table of Object.keys(plan.payload.tables).reverse()) {
    if (!plan.counts[table]) continue;
    const field = table === 'norte_users' ? 'id' : 'user_id';
    const result = await query(`DELETE FROM ${quoted(table)} WHERE ${field} = ANY($1::bigint[])`, [plan.userIds]);
    if (result.rowCount !== plan.counts[table]) throw failure('RETIREMENT_ROW_COUNT_CHANGED', 'Meeting retirement row count changed.');
  }
  const { fingerprint, meetingIds, userIds, counts } = plan;
  return { fingerprint, meetingIds, userIds, counts };
}
