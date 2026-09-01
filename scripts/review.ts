import { Pool } from "pg";
import { decideProposal } from "../src/admin.js";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const [proposalId, rawDecision, ...reasonParts] = process.argv.slice(2);
if (!proposalId || !["approve", "reject"].includes(rawDecision) || !reasonParts.length) {
  throw new Error("Usage: npm run admin:review -- <proposal-id> <approve|reject> <reason>");
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await decideProposal(pool, proposalId, rawDecision as "approve" | "reject", process.env.GTM_ADMIN_ACTOR ?? "cli-admin", reasonParts.join(" "));
  process.stdout.write(`Proposal ${proposalId} ${rawDecision}d.\n`);
} finally {
  await pool.end();
}
