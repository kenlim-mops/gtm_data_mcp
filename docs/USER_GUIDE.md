# GTM Data MCP — User and Administration Guide

## 1. Purpose

Use GTM Data MCP when you need governed operating context before planning, analyzing, or changing a go-to-market system. It is designed to answer questions such as:

- Who owns Google Ads, who is the backup, and which agency operates it?
- What is the account ID and which APIs or integrations are in use?
- What does `utm_id` mean and where does it flow?
- Which dashboards consume a measurement asset?
- Is there a verified mass-change format for a platform?
- Did an internal source recently change an owner, account, runbook, or definition?
- Is a campaign link already registered before a new one is created?

The MCP is not a password vault and does not prove live platform state. Account context should include identifiers and contacts, not credentials.

## 2. Connecting a client

Ask the deployment administrator for the HTTPS MCP URL and a token. Store the token in an environment variable named `GTM_DATA_MCP_TOKEN`.

### Codex

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.gtm_data]
url = "https://gtm-data-mcp.example.com/api/mcp"
bearer_token_env_var = "GTM_DATA_MCP_TOKEN"
```

Restart Codex and ask it to check the GTM Data module status.

### Claude Code

```bash
claude mcp add --transport http gtm-data \
  https://gtm-data-mcp.example.com/api/mcp \
  --header "Authorization: Bearer ${GTM_DATA_MCP_TOKEN}"
```

Run `claude mcp list` to confirm the connection.

Both clients can alternatively run the built local STDIO server. The remote service is preferred for normal use because everyone sees the same governed catalog.

## 3. Everyday use

You can ask in ordinary language. Useful request patterns include:

- “Search GTM Data for the current Google Ads owner, agency, account, API integrations, and escalation runbook. Flag anything stale or unverified.”
- “Trace `utm_id` downstream and tell me which reports depend on it.”
- “Find the definition of `rp_initiative_id` and explain how it differs from `utm_id`.”
- “List current source updates related to account ownership, but do not apply them.”
- “Generate the verified Runpod mass-change review CSV.”
- “Validate this bulk file against the Google Ads template; do not upload it.”

Check the response metadata:

- `verified`: reviewed and current as of `lastVerifiedAt`.
- `unverified`: discovered or imported but not confirmed by an owner.
- `stale`: the verification window has passed.
- `conflict`: authoritative sources disagree.
- `draft` template: useful as a plan, but verify against a current platform export.

## 4. Optional UTM workflow

The UTM tools appear only when the independent UTM Builder API is configured. The recommended sequence is:

1. List the current initiatives, campaigns, presets, sources, and mediums.
2. Search the registry for possible duplicates.
3. Preview the proposed URL to normalize it and surface validation or duplicate findings.
4. Review the preview with the requester.
5. Issue only after approval, using `confirmed=true`; use a stable idempotency key for a single link.

The MCP does not mint `utm_id`, `rp_link_id`, or `rp_initiative_id`. The UTM registry does. If the UTM module is unavailable, use the UTM Builder directly; catalog functions continue to work.

## 5. Bulk-change templates

`gtm_list_bulk_templates` shows platform, operation, row limit, notes, documentation, and verification state. `gtm_generate_bulk_template` returns headers and any governed example rows. `gtm_validate_bulk_change` checks:

- missing or extra columns;
- required values;
- allowed values;
- parse errors; and
- maximum row count.

Validation does not determine whether a live account accepts the file and does not upload anything. For a `draft` template:

1. Export the same object type from the live platform.
2. Compare its current headers and identifier requirements.
3. Test with a small reversible change in the platform's preview/review mode.
4. Have the platform owner approve the template.
5. Update it to `verified` with evidence and a review date.

## 6. Administration model

Recommended roles:

| Role | Responsibility |
| --- | --- |
| GTM Data owner | Approves schema, sources, verification policy, and sensitive-data rules |
| Domain owner | Confirms records and relationships for a platform or process |
| MCP administrator | Deploys, rotates secrets, runs migrations/imports, and reviews sync health |
| Reviewer | Approves or rejects proposed source changes with a reason |
| User | Queries the catalog and uses read-only templates |

### 6.1 Record authoring

The version-controlled bundle is `data/catalog.json`. A record requires:

- a stable ID and unique `(recordType, key)`;
- human-readable name and summary;
- typed `attributes` appropriate to the record;
- `internal` or `restricted` sensitivity;
- lifecycle and verification state;
- source and verification timestamps where available; and
- version/update timestamp.

Suggested attributes by record type:

- `person`: work email, title, timezone, team membership, employment/vendor status. Avoid personal data.
- `team`: charter, escalation channel, operating hours.
- `agency`/`vendor`: scope, contract owner, approved contacts, support path.
- `account`: platform, account/customer ID, region, status, representative/CSM contacts. Never secrets.
- `integration`: API name/version, purpose, auth *method*, credential owner/reference, data direction, cadence.
- `data_term`: business definition, calculation/logic, owner, exclusions.
- `data_field`: system/table/field, type, authority, grain, allowed values, retention.
- `measurement_asset`/`report`: platform, property/container/report ID, purpose, audience, SLA.
- `runbook`: trigger, steps or canonical URL, escalation path, recovery owner.

Use relationships for `owns`, `operates`, `approves`, `backup_for`, `supported_by`, `uses`, `produces`, `consumes`, `feeds`, `documented_by`, and similar edges. Do not encode a relationship only in free text.

### 6.2 Importing a reviewed bundle

Set production database and actor context, then import:

```bash
export DATABASE_URL="postgresql://..."
export GTM_ADMIN_ACTOR="your-work-identity"
export GTM_ADMIN_REASON="Approved catalog update TICKET-123"
npm run admin:import -- ./data/catalog.json
```

The import runs in one transaction and writes an audit event. Review the file diff before import. Importing the bundle does not delete records absent from the file; use lifecycle changes for retirement.

### 6.3 Notion source connector

Notion is an input source, not the database. Add a connector to the bundle and import it. Example:

```json
{
  "id": "gsc_platform_accounts",
  "key": "notion_platform_accounts",
  "name": "Notion platform account directory",
  "sourceType": "notion",
  "status": "active",
  "config": {
    "dataSourceId": "NOTION_DATA_SOURCE_ID",
    "recordType": "account",
    "titleProperty": "Name",
    "keyProperty": "Key",
    "summaryProperty": "Summary",
    "lifecycleProperty": "Lifecycle",
    "sensitivity": "internal",
    "attributeMap": {
      "Account ID": "accountId",
      "Platform": "platform",
      "CSM Email": "csmEmail"
    }
  },
  "credentialRef": "env:NOTION_API_TOKEN",
  "scheduleMinutes": 60,
  "autoApply": false,
  "authoritativeFields": []
}
```

Share only the selected Notion data source with the integration. Store `NOTION_API_TOKEN` in the deployment environment. Run a manual scan with `npm run sync` before enabling the schedule. The connector uses Notion's current [query-a-data-source API](https://developers.notion.com/reference/query-a-data-source).

The scanner:

- reads pages edited since the previous successful run with a five-minute overlap;
- normalizes supported Notion properties;
- stores a content hash and source evidence;
- creates review proposals for new or changed records; and
- uses a lock to prevent overlapping runs.

Keep `autoApply` false initially. If enabled later, list only top-level fields for which that source is unequivocally authoritative. New records still require review.

### 6.4 Reviewing source proposals

Users and agents can list pending proposals through `gtm_list_source_updates`, but cannot decide them. An administrator verifies the source, affected owner, and diff, then runs:

```bash
export GTM_ADMIN_ACTOR="your-work-identity"
npm run admin:review -- PROPOSAL_ID approve "Confirmed by domain owner in TICKET-123"
```

Or reject it:

```bash
npm run admin:review -- PROPOSAL_ID reject "Draft page is not authoritative"
```

A reason is mandatory. If the catalog changed after proposal creation, approval is blocked; rescan and review the new proposal.

### 6.5 Verification and retirement

- Verify a record only after the named domain owner or authoritative source confirms it.
- Record `lastVerifiedAt` and evidence in `sourceUrl`.
- Mark superseded facts `deprecated` or `inactive`; do not recycle keys or IDs.
- Mark a record `conflict` when sources disagree and link the incident/runbook.
- Review restricted records and client access regularly.

### 6.6 Audit and incident response

Administrative imports, auto-applied source updates, and proposal decisions create `gtm_audit_events`. Source runs and errors are stored separately. During an incident:

1. Disable or pause the affected connector.
2. Identify the relevant proposal, source record, and audit events.
3. Correct the catalog through a reviewed import or new source proposal.
4. Re-verify impacted relationships and dependent reports.
5. Rotate any possibly exposed deployment secret; secrets should never appear in audit payloads.

## 7. Known V1 limits

- No graphical admin panel yet; the service layer and audit requirements are ready for one.
- No per-user authorization in fixed-token mode.
- Search is lexical, not semantic.
- Notion is the only implemented reconciliation connector.
- Bulk templates do not make platform API calls.
- UTM batch issuance depends on the independent builder and should be previewed in manageable groups.
