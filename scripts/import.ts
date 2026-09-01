import { resolve } from "node:path";
import { Pool } from "pg";
import { importBundle, readBundle } from "../src/admin.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const path = resolve(process.argv[2] ?? "./data/catalog.json");
const actor = process.env.GTM_ADMIN_ACTOR ?? "cli-admin";
const reason = process.env.GTM_ADMIN_REASON ?? "Governed catalog import";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const bundle = await readBundle(path);
  await importBundle(pool, bundle, actor, reason);
  process.stdout.write(`Imported ${bundle.records.length} records, ${bundle.relationships.length} relationships, and ${bundle.templates.length} templates.\n`);
} finally {
  await pool.end();
}
