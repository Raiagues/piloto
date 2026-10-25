import { readFile } from 'node:fs/promises';
import { loadLocalEnvironment } from '../server/local-environment.mjs';
import { runPostgresRetirement } from '../server/postgres-retirement.mjs';

if (process.argv.includes('--help')) {
  console.info('Usage: node norte/scripts/retire-workspace.mjs --config /private/operation.json\nRequires DATABASE_URL. Modes: inventory, plan, apply. Apply requires the reviewed fingerprint.');
} else {
  try {
    loadLocalEnvironment();
    const index = process.argv.indexOf('--config');
    if (index < 0 || !process.argv[index + 1] || !process.env.DATABASE_URL) throw new Error('Missing configuration.');
    const config = await readFile(process.argv[index + 1], 'utf8');
    console.info(JSON.stringify(await runPostgresRetirement(process.env.DATABASE_URL, config), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: error.code || 'RETIREMENT_FAILED' }));
    process.exitCode = 1;
  }
}
