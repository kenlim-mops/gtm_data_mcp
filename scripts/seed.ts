import { resolve } from "node:path";
import { Pool } from "pg";
import { importBundle, readBundle } from "../src/admin.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await importBundle(pool, await readBundle(resolve("./data/catalog.json")), "system-seed", "Initial governed defaults");
  process.stdout.write("Default catalog seeded.\n");
} finally {
  await pool.end();
}
