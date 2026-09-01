import { Pool } from "pg";
import { syncDueConnectors } from "../src/source-sync.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  process.stdout.write(`${JSON.stringify(await syncDueConnectors(pool), null, 2)}\n`);
} finally {
  await pool.end();
}
