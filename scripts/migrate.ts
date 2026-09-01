import { readFile } from "node:fs/promises";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL("../migrations/001_init.sql", import.meta.url), "utf8"));
  process.stdout.write("Migration applied.\n");
} finally {
  await pool.end();
}
