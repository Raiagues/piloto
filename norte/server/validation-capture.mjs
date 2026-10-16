/** Opt-in local diagnostics for one operator-selected validation project only.
 * Provider credentials and requests are deliberately never written. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function captureValidationResponse(record, payload, env = process.env) {
  if (!env.NORTE_VALIDATION_CAPTURE_PROJECT || record.projectId !== env.NORTE_VALIDATION_CAPTURE_PROJECT || !env.NORTE_VALIDATION_CAPTURE_DIR) return;
  const content = JSON.stringify({ feature: record.feature, projectId: record.projectId, model: record.model, status: record.status, usage: record.usageMetadata, response: payload?.response, output: payload?.output });
  if (content.length > 2_000_000) return;
  const directory = resolve(env.NORTE_VALIDATION_CAPTURE_DIR);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(resolve(directory, `${Date.now()}-${randomUUID()}.json`), content, { mode: 0o600 });
}
