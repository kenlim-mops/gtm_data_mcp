# GTM Data MCP — Decisions

This log records the material V1 decisions, their rationale, and the consequences future maintainers should preserve or deliberately revisit.

## D-001 — Keep the MCP and UTM Builder independent

**Status:** Accepted

**Decision:** GTM Data MCP is a standalone service and repository. Its UTM capability is an optional adapter to the UTM Builder's authenticated `/api/v1` interface. It does not import the builder's source, write directly to its database, or become a runtime dependency for redirects or issued campaign links.

**Why:** The MCP has a broader responsibility than URL generation. A clear API boundary prevents either service from becoming a single point of failure and gives the UTM Builder a stable registry authority. It also lets teams use either product independently.

**Consequence:** UTM tools are absent when the builder is not configured and return upstream failures without affecting catalog tools. The UTM API must preserve its versioned contract.

## D-002 — Use standard MCP with two transports

**Status:** Accepted

**Decision:** Support both STDIO for local/private use and stateless Streamable HTTP for the shared deployment.

**Why:** MCP keeps the server client-neutral. Codex and Claude Code both support these transports, while remote HTTP provides one managed service and one current dataset.

**Consequence:** Client setup differs, but server behavior does not. Features must not rely on a proprietary Claude or Codex extension. Compatibility should be tested through the MCP SDK.

## D-003 — PostgreSQL is the production system of record

**Status:** Accepted

**Decision:** Store catalog records, relationships, bulk templates, connector state, source evidence, proposals, synchronization runs, and audit events in PostgreSQL. Keep a JSON-backed store only for local evaluation and version-controlled seed data.

**Why:** The production use case needs durable search, uniqueness constraints, transactions, version checks, and auditable changes. JSON makes onboarding and recovery easier but is not a concurrent production database.

**Consequence:** Remote production deployment requires `DATABASE_URL`, migration execution, backups, and access controls. V1 search is PostgreSQL text matching; add a dedicated search index only when usage proves it necessary.

## D-004 — Model facts once and connect them with relationships

**Status:** Accepted

**Decision:** People, teams, agencies, vendors, systems, accounts, integrations, terms, fields, measurement assets, runbooks, policies, and reports are first-class records. Ownership and lineage are relationships.

**Why:** Repeating names and contacts across many pages causes drift. A relationship model supports questions such as who owns a platform, which agency operates it, which report consumes a field, and what the escalation path is.

**Consequence:** Administrators must update the authoritative record or relationship instead of copying facts into summaries. Relationship types should stay human-readable and documented.

## D-005 — Keep secrets out of the knowledge catalog

**Status:** Accepted

**Decision:** Catalog account IDs, non-secret integration context, API names, internal owners, agencies/vendors, and vendor contacts, but never tokens, passwords, client secrets, private keys, or recovery codes. Connectors use credential references such as `env:NOTION_API_TOKEN`.

**Why:** AI-readable context should not become a credential store. Deployment platforms already provide secret management and access logging.

**Consequence:** Tools may say that an API is used and identify its operational owner, but cannot retrieve the credential. Rotation happens in the deployment secret store.

## D-006 — Reconcile sources; do not blindly mirror them

**Status:** Accepted

**Decision:** Periodic Notion scans create source evidence and change proposals. Human review is the default. Auto-apply is allowed only for changes to existing records whose changed top-level fields are all explicitly listed in that connector's `authoritativeFields`.

**Why:** Notion can contain drafts, conflicting pages, or edits outside the data owner's scope. A review queue makes drift visible without silently replacing governed truth.

**Consequence:** New records, conflicts, and non-allowlisted fields require approval. Approvals include a reason and actor; stale proposals fail an optimistic version check and must be rescanned.

## D-007 — MCP administration is read-first in V1

**Status:** Accepted

**Decision:** Catalog discovery, readiness, source proposal listing, template generation, and template validation are exposed through MCP. Catalog imports and proposal decisions remain explicit administrative commands outside the conversational tool surface.

**Why:** Separating discovery from authority reduces accidental changes and prompt-injection risk while governance is maturing.

**Consequence:** Administrators use reviewed files and the CLI. A future graphical admin panel can call the same service layer, but must preserve actor, reason, version, and audit requirements.

## D-008 — Bulk templates are safe plans, not direct platform automation

**Status:** Accepted

**Decision:** V1 generates and validates CSVs but does not upload to Google Ads, LinkedIn, CM360, HubSpot, Meta, Reddit, or other platforms. Templates have a verification state.

**Why:** Platform headers, eligible workflows, and account capabilities change. Offline validation provides immediate value without granting broad write access.

**Consequence:** `draft` templates must begin from a current platform export and be certified before operational use. Formula-like CSV cells are neutralized when generated.

## D-009 — Use a fixed bearer token for the first internal deployment

**Status:** Accepted with follow-up

**Decision:** Protect the remote endpoint with HTTPS plus a high-entropy bearer token stored in the deployment platform and each authorized user's environment.

**Why:** It is supported by both target clients and is small enough for V1.

**Consequence:** This is not the final enterprise identity model. Before wide distribution, replace it with Runpod-approved OAuth or put the endpoint behind an identity-aware gateway with per-user attribution and revocation.

## D-010 — Deploy the HTTP service on Vercel with managed PostgreSQL

**Status:** Accepted

**Decision:** Use Vercel functions for `/api/mcp` and scheduled source reconciliation, connected to a Runpod-approved PostgreSQL provider.

**Why:** It matches the approved application path, supports managed HTTPS and secrets, and keeps deployment simple.

**Consequence:** The HTTP transport is stateless, database connections are pooled conservatively, and long-running ingestion must stay bounded. If connectors outgrow function limits, move synchronization to a worker without changing the MCP contract.

## D-011 — Preserve provenance and uncertainty

**Status:** Accepted

**Decision:** Every record carries verification state, source URL/timestamp, last verification time, lifecycle, and version. Readiness checks surface uncertainty rather than presenting every value as equally trustworthy.

**Why:** Operational context is useful only when users can judge whether it is current and authoritative.

**Consequence:** Agents and users should treat `unverified`, `stale`, and `conflict` records as leads requiring confirmation, not settled facts.

## D-012 — Reuse UTM registry identifiers rather than minting duplicates

**Status:** Accepted

**Decision:** The UTM Builder remains authoritative for `utm_id`, `rp_link_id`, `rp_initiative_id`, duplicate detection, and issuance. The MCP can explain these fields and invoke the builder but does not mint parallel IDs.

**Why:** Two ID issuers would create the exact stitching and duplication risks the registry is intended to prevent.

**Consequence:** UTM issuance requires the UTM API. Catalog-only usage does not.

## D-013 — Use one Slack app with two independent service paths

**Status:** Accepted

**Decision:** Present one **Runpod GTM Ops** Slack app. Connect GTM Data to Slackbot through a Slack-identity MCP endpoint, and route deterministic `/utm` commands, shortcuts, and CSV uploads directly to the UTM Builder. Keep the normal bearer MCP endpoint for Codex/Claude and keep both repositories independently deployable.

**Why:** Slack's conversational agent surface is well suited to discovery and context, while UTM issuance benefits from a fixed preview/confirm workflow that cannot depend on probabilistic tool choice. A thin Slack adapter avoids duplicating governance logic.

**Consequence:** The Slack app requires administrator approval and scopes across both services. The MCP endpoint verifies Slack signatures and signed identity; the UTM endpoint resolves Slack users to existing Builder accounts. Failure of either backend is contained to its own path.

## D-014 — Keep public source code separate from private operational data

**Status:** Accepted

**Decision:** The repository may be public, but production catalog records, personnel/vendor mappings, account identifiers, source evidence, audit history, database credentials, and Slack tokens remain in PostgreSQL and approved secret storage. The bundled JSON contains only generic schema examples and non-secret identifier definitions.

**Why:** Public implementation supports review and reuse without publishing Runpod's operating graph or credentials.

**Consequence:** Every pull request and seed change needs a secret/PII/internal-data review. Notion imports and production exports must never be committed.
