import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CatalogService } from "./catalog-service.js";
import type { CatalogStore } from "./store.js";
import { TemplateService } from "./template-service.js";
import { RECORD_TYPES } from "./types.js";
import type { UtmBuilderClient } from "./utm-client.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const linkShape = {
  destination: z.string().min(1),
  campaignId: z.string().min(1),
  presetKey: z.string().optional(),
  utmSource: z.string().default(""),
  utmMedium: z.string().default(""),
  utmContent: z.string().nullable().optional(),
  utmTerm: z.string().nullable().optional(),
};

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export function createGtmDataServer(options: {
  store: CatalogStore;
  utmClient?: UtmBuilderClient | null;
  includeRestricted?: boolean;
}) {
  const catalog = new CatalogService(options.store, options.includeRestricted ?? false);
  const templates = new TemplateService(options.store);
  const server = new McpServer(
    { name: "runpod-gtm-data", version: "1.0.0" },
    {
      instructions: "Search governed GTM records before assuming names, owners, account IDs, definitions, or runbooks. Treat unverified/stale records and pending source updates as uncertain. Bulk templates marked draft must be checked against a current platform export. For UTMs: search, preview, show duplicate/validation findings, obtain approval, then issue with confirmed=true and a stable idempotency key. Never claim this server stores secrets or live ad-platform state.",
    },
  );

  server.registerTool("gtm_module_status", {
    title: "GTM Data module status",
    description: "Describe the enabled catalog backend, UTM integration availability, and restricted-data policy.",
    inputSchema: {}, annotations: READ_ONLY,
  }, async () => result({
    server: "runpod-gtm-data",
    catalog: "enabled",
    utmModule: options.utmClient ? "enabled" : "not_configured",
    restrictedRecords: options.includeRestricted ? "included" : "excluded",
  }));

  server.registerTool("gtm_search_catalog", {
    title: "Search GTM data catalog",
    description: "Search people, teams, agencies, vendors, systems, accounts, integrations, definitions, measurement assets, runbooks, policies, and reports.",
    inputSchema: {
      query: z.string().optional(),
      recordTypes: z.array(z.enum(RECORD_TYPES)).optional(),
      lifecycle: z.enum(["draft", "active", "inactive", "deprecated"]).optional(),
      verificationState: z.enum(["unverified", "verified", "stale", "conflict"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }, annotations: READ_ONLY,
  }, async (input) => result(await catalog.search(input)));

  server.registerTool("gtm_get_record", {
    title: "Get GTM record",
    description: "Get one governed record by ID or key with active relationships.",
    inputSchema: { id: z.string().optional(), key: z.string().optional(), recordType: z.enum(RECORD_TYPES).optional() },
    annotations: READ_ONLY,
  }, async (input) => result(await catalog.getRecord(input)));

  server.registerTool("gtm_resolve_ownership", {
    title: "Resolve GTM ownership",
    description: "Resolve owners, operators, approvers, backups, agencies, vendors, and escalation contacts.",
    inputSchema: { recordId: z.string().optional(), query: z.string().optional() }, annotations: READ_ONLY,
  }, async (input) => result(await catalog.resolveOwnership(input)));

  server.registerTool("gtm_get_personnel_map", {
    title: "Get GTM personnel map",
    description: "Return people, teams, agencies, and vendors with active responsibility relationships.",
    inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(50).default(25) }, annotations: READ_ONLY,
  }, async (input) => result(await catalog.enrichedSearch({ ...input, recordTypes: ["person", "team", "agency", "vendor"] })));

  server.registerTool("gtm_get_account_context", {
    title: "Get GTM account context",
    description: "Find platform account IDs, contacts, APIs, owners, agencies/vendors, integrations, runbooks, and systems.",
    inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(25).default(10) }, annotations: READ_ONLY,
  }, async (input) => result(await catalog.enrichedSearch({ ...input, recordTypes: ["account", "system", "integration"] })));

  server.registerTool("gtm_get_measurement_inventory", {
    title: "Get GTM measurement inventory",
    description: "Return measurement assets, systems, integrations, reports, ownership, and lineage.",
    inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(50).default(25) }, annotations: READ_ONLY,
  }, async (input) => result(await catalog.enrichedSearch({ ...input, recordTypes: ["measurement_asset", "system", "integration", "report"] })));

  server.registerTool("gtm_trace_lineage", {
    title: "Trace GTM data lineage",
    description: "Trace governed upstream and downstream relationships up to four levels.",
    inputSchema: { recordId: z.string().min(1), direction: z.enum(["upstream", "downstream", "both"]).default("both"), depth: z.number().int().min(1).max(4).default(2) },
    annotations: READ_ONLY,
  }, async ({ recordId, direction, depth }) => result(await catalog.traceLineage(recordId, direction, depth)));

  server.registerTool("gtm_get_data_definition", {
    title: "Get GTM data definition",
    description: "Find governed business-term and technical-field definitions.",
    inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) }, annotations: READ_ONLY,
  }, async ({ query, limit }) => result(await catalog.search({ query, recordTypes: ["data_term", "data_field"], limit })));

  server.registerTool("gtm_find_runbooks", {
    title: "Find GTM runbooks",
    description: "Find active operating, incident, escalation, and recovery runbooks.",
    inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) }, annotations: READ_ONLY,
  }, async ({ query, limit }) => result(await catalog.search({ query, recordTypes: ["runbook"], lifecycle: "active", limit })));

  server.registerTool("gtm_check_readiness", {
    title: "Check GTM readiness",
    description: "Check lifecycle, verification, ownership, runbook linkage, and pending source updates.",
    inputSchema: { recordId: z.string().min(1) }, annotations: READ_ONLY,
  }, async ({ recordId }) => result(await catalog.checkReadiness(recordId)));

  server.registerTool("gtm_list_source_updates", {
    title: "List detected source updates",
    description: "List reviewable changes detected by source reconciliation; this tool cannot approve or apply them.",
    inputSchema: { status: z.enum(["pending", "approved", "rejected", "applied", "superseded"]).default("pending"), connectorKey: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) },
    annotations: READ_ONLY,
  }, async (input) => {
    const updates = await options.store.listSourceUpdates(input);
    return result(options.includeRestricted ? updates : updates.filter((update) => update.after.sensitivity !== "restricted"));
  });

  server.registerTool("gtm_list_bulk_templates", {
    title: "List GTM bulk-change templates",
    description: "List governed mass-change templates, constraints, documentation, and verification state.",
    inputSchema: { platformKey: z.string().optional(), operation: z.string().optional() }, annotations: READ_ONLY,
  }, async (input) => result(await templates.list(input)));

  server.registerTool("gtm_generate_bulk_template", {
    title: "Generate bulk-change CSV",
    description: "Generate safe CSV headers/examples; draft templates require verification against a current platform export.",
    inputSchema: { templateKey: z.string().min(1) }, annotations: READ_ONLY,
  }, async ({ templateKey }) => result(await templates.generate(templateKey)));

  server.registerTool("gtm_validate_bulk_change", {
    title: "Validate bulk-change CSV",
    description: "Validate columns, required values, allowed values, and row limits without uploading or changing a platform.",
    inputSchema: { templateKey: z.string().min(1), csv: z.string().min(1).max(2_000_000) }, annotations: READ_ONLY,
  }, async ({ templateKey, csv }) => result(await templates.validate(templateKey, csv)));

  if (options.utmClient) registerUtmTools(server, options.utmClient);
  return server;
}

function registerUtmTools(server: McpServer, client: UtmBuilderClient) {
  server.registerTool("utm_list_reference_data", { title: "List UTM reference data", description: "List canonical initiatives, campaigns, presets, sources, and mediums from the independent UTM Builder.", inputSchema: {}, annotations: READ_ONLY }, async () => result(await client.referenceData()));
  server.registerTool("utm_search_links", { title: "Search governed UTM links", description: "Search before creating a possible duplicate.", inputSchema: { query: z.string().optional(), campaignId: z.string().optional(), initiativeId: z.string().optional(), utmSource: z.string().optional(), utmMedium: z.string().optional(), status: z.enum(["draft", "issued", "retired"]).optional(), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(200).default(25) }, annotations: READ_ONLY }, async (input) => result(await client.searchLinks(input)));
  server.registerTool("utm_preview_link", { title: "Preview governed UTM link", description: "Normalize, validate, and check duplicates without writing.", inputSchema: linkShape, annotations: READ_ONLY }, async (input) => result(await client.previewLink(input)));
  server.registerTool("utm_issue_link", { title: "Issue governed UTM link", description: "Issue one validated URL through the independent UTM Builder. Preview first; exact duplicates remain blocked.", inputSchema: { ...linkShape, idempotencyKey: z.string().min(8).max(200), confirmed: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } }, async ({ confirmed, idempotencyKey, ...input }) => { if (!confirmed) throw new Error("Set confirmed=true only after the user approves issuance."); return result(await client.issueLink(input, idempotencyKey)); });
  server.registerTool("utm_issue_batch", { title: "Issue governed UTM batch", description: "Issue 1–200 links with row-level results through the independent UTM Builder.", inputSchema: { rows: z.array(z.object(linkShape)).min(1).max(200), source: z.enum(["grid", "paste", "csv"]).default("grid"), confirmed: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }, async ({ rows, source, confirmed }) => { if (!confirmed) throw new Error("Set confirmed=true only after the user approves the batch."); return result(await client.issueBatch(rows, source)); });
}
