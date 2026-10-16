/** Prepare the local data store for `./setup`.
 *
 * Creates the PostgreSQL table (or the JSON file when DATABASE_URL is empty)
 * exactly as the API does on startup, then imports the official Quetzal-1
 * documents once, while the validation project's memory is still empty. A
 * project that already has documents is never touched, so running ./setup
 * again cannot reset conception progress.
 *
 *   node scripts/setup-database.mjs [--skip-seed]
 */
import { resolve } from "node:path";
import { loadLocalEnvironment } from "../server/local-environment.mjs";
import { JsonDataStore } from "../server/data-store.mjs";
import { PostgresDataStore } from "../server/postgres-store.mjs";
import { describeProject, seedJsonFile, seedPostgres } from "./seed-quetzal-validation.mjs";

loadLocalEnvironment();

const databaseUrl = process.env.DATABASE_URL;
const filePath = resolve("var/mission-dev-data.json");
const store = await (databaseUrl ? new PostgresDataStore(databaseUrl) : new JsonDataStore(filePath)).init();
const project = describeProject(store.read());
await store.pool?.end();
console.log(databaseUrl ? "Database schema ready (PostgreSQL table norte_state)." : `Local data file ready: ${filePath}`);

if (process.argv.includes("--skip-seed")) {
  console.log("Skipping the Quetzal-1 document import (--skip-seed).");
} else if (!project.found || project.artifacts.length > 0) {
  console.log("Validation project already has documents; nothing to import.");
} else {
  console.log("Importing the official Quetzal-1 documents into the validation project...");
  const env = { ...process.env, NORTE_ALLOW_QUETZAL_SEED: "1" };
  try {
    const result = databaseUrl ? await seedPostgres(databaseUrl, {}, env) : await seedJsonFile(filePath, {}, env);
    const megabytes = (result.totalImportedBytes / 1024 / 1024).toFixed(1);
    console.log(`Imported ${result.imported.length} documents (${megabytes} MB) into ${result.after.name}.`);
  } catch (error) {
    // The app works without these documents; only the validation project stays empty.
    console.warn(`Quetzal-1 documents were not imported: ${error.message}`);
    console.warn("The app still runs. Check the internet connection and run ./setup again to retry.");
  }
}
