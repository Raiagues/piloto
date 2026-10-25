/** Prepare the local data store for `./setup`.
 *
 * Creates the PostgreSQL table (or the JSON file when DATABASE_URL is empty)
 * exactly as the API does on startup. Existing records are preserved;
 * a new installation starts without accounts, teams or projects.
 *
 *   node scripts/setup-database.mjs
 */
import { resolve } from "node:path";
import { loadLocalEnvironment } from "../server/local-environment.mjs";
import { JsonDataStore } from "../server/data-store.mjs";
import { PostgresDataStore } from "../server/postgres-store.mjs";

loadLocalEnvironment();

const databaseUrl = process.env.DATABASE_URL;
const filePath = resolve("var/mission-dev-data.json");
const store = await (databaseUrl ? new PostgresDataStore(databaseUrl) : new JsonDataStore(filePath)).init();
await store.pool?.end();
console.log(databaseUrl ? "Database schema ready (PostgreSQL table norte_state)." : `Local data file ready: ${filePath}`);
