import type { IncomingMessage, ServerResponse } from "node:http";
import { Pool } from "pg";
import { bearerAuthorized } from "../../src/auth.js";
import { syncDueConnectors } from "../../src/source-sync.js";

let pool: Pool | null = null;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const header = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
  if (!bearerAuthorized(header, process.env.CRON_SECRET)) return json(res, 401, { error: "Unauthorized" });
  if (!process.env.DATABASE_URL) return json(res, 503, { error: "DATABASE_URL is not configured" });
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  return json(res, 200, { result: await syncDueConnectors(pool) });
}
