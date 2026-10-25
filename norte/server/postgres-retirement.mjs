import { createHash } from 'node:crypto';
import pg from 'pg';
import { postgresTransaction } from './postgres-store.mjs';
import { decodePostgresState, encodePostgresState, isEncodedPostgresState } from './postgres-state-codec.mjs';
import { inventoryWorkspaceRetirement, planWorkspaceRetirement, applyWorkspaceRetirement } from './workspace-retirement.mjs';
import { planMeetingRetirement, applyMeetingRetirement } from './meeting-retirement.mjs';

function invalid() { return Object.assign(new Error('Invalid workspace maintenance configuration.'), { code: 'RETIREMENT_CONFIG_INVALID' }); }

export function retirementConfig(value) {
  const config = typeof value === 'string' ? JSON.parse(value) : value;
  if (!config || !['inventory', 'plan', 'apply'].includes(config.mode)
    || !/^[a-zA-Z0-9_-]{1,100}$/u.test(config.id || '')
    || typeof config.keepProject !== 'string' || !config.keepProject
    || !Array.isArray(config.removeProjectIds) || config.removeProjectIds.some(id => typeof id !== 'string' || !id)
    || config.removeProjectIds.includes(config.keepProject)
    || (config.mode === 'apply' && !/^[a-f0-9]{64}$/u.test(config.expectedFingerprint || ''))) throw invalid();
  return config;
}

// An operator supplies an explicit operation; normal application startup never retires data.
export async function runPostgresRetirement(connectionString, value, options = {}) {
  const config = retirementConfig(value);
  const pool = options.pool || new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, application_name: 'norte-maintenance' });
  try {
    return await postgresTransaction(pool, async ({ query, wait }) => {
      if (config.mode === 'apply') {
        await query(`CREATE TABLE IF NOT EXISTS norte_retirement_backups (
          operation_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          fingerprint TEXT NOT NULL, report JSONB NOT NULL, node_state JSONB NOT NULL,
          meeting_state JSONB NOT NULL
        )`);
        const prior = await query('SELECT fingerprint, report FROM norte_retirement_backups WHERE operation_id = $1', [config.id]);
        if (prior.rows.length) {
          if (prior.rows[0].fingerprint !== config.expectedFingerprint) throw Object.assign(new Error('Operation identifier already used.'), { code: 'RETIREMENT_OPERATION_CONFLICT' });
          return { status: 'already-applied', operationId: config.id, ...prior.rows[0].report };
        }
      }
      const selected = await query('SELECT data, revision::text AS revision FROM norte_state WHERE id = $1 FOR UPDATE', ['primary']);
      if (!selected.rows.length) throw Object.assign(new Error('Workspace missing.'), { code: 'RETIREMENT_STATE_MISSING' });
      const row = selected.rows[0];
      const data = await wait(() => decodePostgresState(row.data));
      const inventory = inventoryWorkspaceRetirement(data);
      if (config.mode === 'inventory') return { status: 'inventory', operationId: config.id, inventory };
      const plan = planWorkspaceRetirement(data, config);
      const meetings = await planMeetingRetirement(query, plan.remove.meetings);
      const fingerprint = retirementFingerprint([plan.fingerprint, meetings.fingerprint]);
      const meetingReport = { fingerprint: meetings.fingerprint, meetingIds: meetings.meetingIds, userIds: meetings.userIds, counts: meetings.counts };
      if (config.mode === 'plan') return { status: 'planned', operationId: config.id, inventory, plan, meetings: meetingReport, fingerprint };
      if (config.expectedFingerprint !== fingerprint) throw Object.assign(new Error('The reviewed state changed.'), { code: 'RETIREMENT_FINGERPRINT_MISMATCH' });
      const changed = applyWorkspaceRetirement(data, { ...config, expectedFingerprint: plan.fingerprint });
      const encoded = isEncodedPostgresState(row.data);
      const persisted = await wait(() => encodePostgresState(changed.data, { compress: encoded, compactStrings: encoded && row.data.version === 2 }));
      const report = { plan, meetings: meetingReport, sourceRevision: row.revision, inventory: inventoryWorkspaceRetirement(changed.data) };
      await applyMeetingRetirement(query, plan.remove.meetings, {
        expectedFingerprint: meetings.fingerprint,
        // The original encoded row is copied inside PostgreSQL, in the same commit as removal.
        backup: async current => query(`INSERT INTO norte_retirement_backups (operation_id, fingerprint, report, node_state, meeting_state)
          SELECT $1, $2, $3::jsonb, data, $4::jsonb FROM norte_state WHERE id = $5`,
        [config.id, config.expectedFingerprint, JSON.stringify(report), JSON.stringify(current.payload), 'primary'])
      });
      await query('UPDATE norte_state SET data = $2::jsonb, revision = revision + 1, updated_at = NOW() WHERE id = $1', ['primary', JSON.stringify(persisted)]);
      return { status: 'applied', operationId: config.id, ...report };
    });
  } finally {
    if (!options.pool) await pool.end();
  }
}

export function retirementFingerprint(parts) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
