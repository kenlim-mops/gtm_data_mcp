# GTM Data MCP — Deployment Guide

This guide covers local STDIO use and the recommended Runpod-internal Vercel deployment.

## 1. Production shape

- **Runtime:** Node.js 20+ on Vercel Functions.
- **MCP endpoints:** `POST /api/mcp` for bearer clients and `POST /api/slack/mcp` for Slack-signed identity requests, both using stateless Streamable HTTP.
- **Health endpoint:** local HTTP only in V1; use Vercel function monitoring and an authenticated MCP initialization check in production.
- **Database:** Runpod-approved managed PostgreSQL reachable from Vercel.
- **Schedule:** [Vercel Cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs) calls `/api/cron/sync` hourly at minute 17; each connector also enforces its own `scheduleMinutes`.
- **Secrets:** Vercel project environment variables, never repository files or catalog records.

## 2. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Remote | PostgreSQL connection string |
| `GTM_MCP_BEARER_TOKEN` | Remote | Protects `/api/mcp`; use a high-entropy secret |
| `GTM_INCLUDE_RESTRICTED` | Optional | Defaults false; enable only for a separately reviewed deployment |
| `SLACK_SIGNING_SECRET` | Slack | Verifies signed requests to `/api/slack/mcp` |
| `SLACK_ALLOWED_ENTERPRISE_IDS` | Slack production | Comma-separated approved enterprise IDs |
| `SLACK_ALLOWED_TEAM_IDS` | Slack optional | Comma-separated approved workspace IDs |
| `SLACK_RESTRICTED_USER_IDS` | Slack optional | Explicit users eligible for restricted records when restricted access is enabled |
| `CRON_SECRET` | Scheduled sync | Authenticates Vercel Cron requests |
| `NOTION_API_TOKEN` | When Notion connectors exist | Read access to explicitly shared Notion sources |
| `UTM_BUILDER_URL` | Optional | Base URL of the independent UTM Builder |
| `UTM_BUILDER_TOKEN` | Optional | Server-side UTM API token |
| `GTM_CATALOG_PATH` | Local only | JSON catalog path when PostgreSQL is absent |
| `PORT` | Local HTTP only | Defaults to `8787` |

Use different values for Preview and Production. Do not expose `UTM_BUILDER_TOKEN`, `NOTION_API_TOKEN`, `DATABASE_URL`, or `CRON_SECRET` to MCP clients.

## 3. Database provisioning

1. Provision a PostgreSQL database through a Runpod-approved provider available to the Vercel project.
2. Require TLS and restrict administrative access.
3. Store the connection string as `DATABASE_URL` in Vercel Production and, if needed, Preview.
4. From an authorized administrative environment, run:

```bash
npm ci
DATABASE_URL="postgresql://..." npm run db:migrate
DATABASE_URL="postgresql://..." npm run db:seed
```

The migration is idempotent. The seed is an upsert of the reviewed default bundle. Do not run seed from every serverless invocation.

Configure automated backups and test point-in-time recovery. The minimum production retention should follow Runpod's internal data policy; the application does not choose a retention period.

## 4. Vercel project

1. Import this GitHub repository into the approved Vercel team.
2. Select the Node.js runtime and keep the repository's `vercel.json`.
3. Add the environment variables listed above.
4. Deploy to Preview.
5. Send an unauthenticated MCP request and confirm it receives `401`.
6. Initialize an MCP client with the Preview URL and token.
7. Confirm `gtm_module_status`, search, definition lookup, template generation, and readiness checks.
8. If UTM integration is enabled, confirm reference-data and preview calls first; do not issue a production URL as a smoke test.
9. Promote the reviewed deployment to Production.
10. If Slack is enabled, follow [SLACK.md](SLACK.md), then verify signed discovery, one tool call, outside-org denial, and invocation audit.

The remote endpoint is:

```text
https://YOUR_PROJECT_DOMAIN/api/mcp
```

## 5. Authentication

V1 compares a fixed bearer secret using a timing-safe operation. Generate a high-entropy value, store it as `GTM_MCP_BEARER_TOKEN`, and distribute it only through the approved password/secret workflow.

Rotation procedure:

1. Announce a rotation window.
2. Set a new production token and deploy.
3. Update authorized client environments.
4. Verify both Codex and Claude Code.
5. Revoke/delete the old token and review access logs.

A single shared token cannot provide reliable per-user attribution. Before access expands beyond a small internal group, add Runpod-approved OAuth or an identity-aware gateway. Preserve the MCP URL and transport where possible so clients need only reauthenticate.

Slack is the first per-user remote identity path. It has a separate endpoint, verifies Slack's HMAC and five-minute timestamp window, reads the caller from signed `_meta.slack`, and can enforce enterprise/workspace/user allowlists. It does not replace authentication for Codex or Claude Code.

## 6. Client rollout

### Codex

```toml
[mcp_servers.gtm_data]
url = "https://YOUR_PROJECT_DOMAIN/api/mcp"
bearer_token_env_var = "GTM_DATA_MCP_TOKEN"
```

### Claude Code

```bash
claude mcp add --transport http gtm-data \
  https://YOUR_PROJECT_DOMAIN/api/mcp \
  --header "Authorization: Bearer ${GTM_DATA_MCP_TOKEN}"
```

Both configurations point to the same service and data. Official setup references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [Claude Code MCP](https://code.claude.com/docs/en/mcp).

## 7. Notion reconciliation

1. Create a Notion integration with read-only access.
2. Share only approved source data sources with it.
3. Add `NOTION_API_TOKEN` to Vercel.
4. Add connector definitions to the governed catalog bundle and import them.
5. Run `npm run sync` manually against production credentials.
6. Review generated proposals and source-run records.
7. Enable the connector and scheduled endpoint only after the mappings are correct.

Vercel Cron sends its configured authorization secret. The endpoint also verifies `CRON_SECRET` and refuses to run without `DATABASE_URL`. Connector locks expire after ten minutes so overlapping jobs do not apply the same source change twice.

If a connector repeatedly fails, pause it in the catalog, resolve the source or mapping issue, deploy/import the correction, and perform a manual run. Catalog queries remain available during source outages.

## 8. Optional UTM integration

Set both `UTM_BUILDER_URL` and `UTM_BUILDER_TOKEN`. If either is absent, no UTM tools are registered. Verify:

- the URL targets the builder's stable `/api/v1` deployment;
- the token has the narrowest supported scope;
- the MCP egress path can reach the builder; and
- search and preview succeed before enabling issuance for users.

Do not point the MCP directly at the UTM database. The API boundary preserves validation, duplicate checks, logging, and ID authority. UTM Builder downtime affects only optional UTM calls.

## 9. CI and release checks

Before production deployment:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Also verify:

- migration compatibility with the production schema;
- no secrets or internal personal data are present in the Git diff;
- draft templates have not been mislabeled verified;
- source connector field mappings match current Notion property names; and
- client configurations use the intended environment and hostname.

## 10. Observability and recovery

Monitor Vercel function errors, latency, rate, and scheduled invocation status. Monitor PostgreSQL connections, storage, slow queries, and backup health. Application audit data is available in:

- `gtm_audit_events` for administrative actions;
- `gtm_source_sync_runs` for scan outcomes;
- `gtm_change_proposals` for review state; and
- `gtm_source_records` for source evidence and hashes.

Recovery priorities:

1. Restore database availability or use a known-good database restore.
2. Keep source connectors paused until catalog integrity is checked.
3. Reconcile records changed after the restore point.
4. Re-run readiness checks for critical systems, accounts, integrations, and reports.

The version-controlled seed can restore foundational definitions and templates, but it is not a substitute for database backups because it does not contain live administrative history.

## 11. Local/private STDIO deployment

For one-user evaluation with the bundled JSON catalog:

```bash
npm ci
npm run build
GTM_CATALOG_PATH=/absolute/path/to/data/catalog.json node dist/src/index.js
```

STDIO needs no network listener or bearer token. It is appropriate for development, not a shared production source of truth. Configure `DATABASE_URL` if the local client must query the production catalog, subject to database access policy.
