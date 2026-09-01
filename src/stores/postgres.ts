import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { CatalogStore } from "../store.js";
import type {
  BulkTemplate,
  CatalogRecord,
  RelationshipDetail,
  SearchInput,
  SourceUpdate,
} from "../types.js";

function record(row: Record<string, unknown>): CatalogRecord {
  return {
    id: String(row.id),
    recordType: row.record_type as CatalogRecord["recordType"],
    key: String(row.key),
    name: String(row.name),
    summary: row.summary as string | null,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    sensitivity: row.sensitivity as CatalogRecord["sensitivity"],
    lifecycle: row.lifecycle as CatalogRecord["lifecycle"],
    verificationState: row.verification_state as CatalogRecord["verificationState"],
    lastVerifiedAt: row.last_verified_at ? new Date(String(row.last_verified_at)).toISOString() : null,
    sourceUrl: row.source_url as string | null,
    sourceUpdatedAt: row.source_updated_at ? new Date(String(row.source_updated_at)).toISOString() : null,
    version: Number(row.version),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function template(row: Record<string, unknown>): BulkTemplate {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    platformKey: String(row.platform_key),
    objectType: String(row.object_type),
    operation: String(row.operation),
    format: row.format as BulkTemplate["format"],
    columns: (row.columns ?? []) as BulkTemplate["columns"],
    examples: (row.examples ?? []) as BulkTemplate["examples"],
    maxRows: row.max_rows === null ? null : Number(row.max_rows),
    availabilityNotes: row.availability_notes as string | null,
    docsUrl: row.docs_url as string | null,
    verificationState: row.verification_state as BulkTemplate["verificationState"],
    lifecycle: row.lifecycle as BulkTemplate["lifecycle"],
  };
}

export class PostgresCatalogStore implements CatalogStore {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async search(input: SearchInput = {}) {
    const values: unknown[] = [];
    const where: string[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (!input.includeRestricted) where.push("sensitivity <> 'restricted'");
    if (input.recordTypes?.length) where.push(`record_type = any(${bind(input.recordTypes)}::text[])`);
    if (input.lifecycle) where.push(`lifecycle = ${bind(input.lifecycle)}`);
    if (input.verificationState) where.push(`verification_state = ${bind(input.verificationState)}`);
    if (input.query?.trim()) {
      const value = bind(`%${input.query.trim()}%`);
      where.push(`(name ilike ${value} or key ilike ${value} or coalesce(summary, '') ilike ${value} or attributes::text ilike ${value})`);
    }
    const limit = bind(Math.min(Math.max(input.limit ?? 50, 1), 200));
    const result = await this.pool.query(`select * from gtm_catalog_records ${where.length ? `where ${where.join(" and ")}` : ""} order by record_type, name limit ${limit}`, values);
    return result.rows.map(record);
  }

  async getRecord(input: { id?: string; key?: string; recordType?: CatalogRecord["recordType"]; includeRestricted?: boolean }) {
    const values: unknown[] = [];
    const where: string[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    if (input.id) where.push(`id = ${bind(input.id)}`);
    if (input.key) where.push(`key = ${bind(input.key)}`);
    if (input.recordType) where.push(`record_type = ${bind(input.recordType)}`);
    if (!input.includeRestricted) where.push("sensitivity <> 'restricted'");
    if (!where.length) throw new Error("A catalog record id or key is required.");
    const result = await this.pool.query(`select * from gtm_catalog_records where ${where.join(" and ")} limit 1`, values);
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async relationshipsFor(recordId: string, includeRestricted = false): Promise<RelationshipDetail[]> {
    const result = await this.pool.query(
      `select r.*, row_to_json(f.*) as from_record, row_to_json(t.*) as to_record
       from gtm_catalog_relationships r
       join gtm_catalog_records f on f.id = r.from_record_id
       join gtm_catalog_records t on t.id = r.to_record_id
       where r.status = 'active' and (r.from_record_id = $1 or r.to_record_id = $1)
       ${includeRestricted ? "" : "and f.sensitivity <> 'restricted' and t.sensitivity <> 'restricted'"}
       order by r.relationship_type`,
      [recordId],
    );
    return result.rows.map((row) => ({
      edge: {
        id: row.id,
        fromRecordId: row.from_record_id,
        toRecordId: row.to_record_id,
        relationshipType: row.relationship_type,
        isPrimary: row.is_primary,
        context: row.context ?? {},
        status: row.status,
      },
      from: record(row.from_record),
      to: record(row.to_record),
    }));
  }

  async listTemplates(input: { platformKey?: string; operation?: string } = {}) {
    const result = await this.pool.query(
      `select * from gtm_bulk_templates where lifecycle = 'active'
       and ($1::text is null or platform_key = $1)
       and ($2::text is null or operation = $2)
       order by platform_key, name`,
      [input.platformKey ?? null, input.operation ?? null],
    );
    return result.rows.map(template);
  }

  async getTemplate(key: string) {
    const result = await this.pool.query("select * from gtm_bulk_templates where key = $1 limit 1", [key]);
    return result.rows[0] ? template(result.rows[0]) : null;
  }

  async listSourceUpdates(input: { status?: SourceUpdate["status"]; connectorKey?: string; limit?: number } = {}) {
    const result = await this.pool.query(
      `select p.*, c.key as connector_key, s.external_id, s.source_url
       from gtm_change_proposals p
       join gtm_source_connectors c on c.id = p.connector_id
       join gtm_source_records s on s.id = p.source_record_id
       where ($1::text is null or p.status = $1) and ($2::text is null or c.key = $2)
       order by p.created_at desc limit $3`,
      [input.status ?? null, input.connectorKey ?? null, Math.min(Math.max(input.limit ?? 50, 1), 200)],
    );
    return result.rows.map((row) => ({
      id: row.id,
      connectorKey: row.connector_key,
      proposalType: row.proposal_type,
      status: row.status,
      externalId: row.external_id,
      sourceUrl: row.source_url,
      internalRecordId: row.internal_record_id,
      before: row.before,
      after: row.after,
      diff: row.diff,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }

  async recordInvocation(event: {
    actor: string;
    action: string;
    entityType: string;
    entityId: string;
    after?: Record<string, unknown>;
    reason?: string;
  }) {
    await this.pool.query(
      `insert into gtm_audit_events (id, actor, action, entity_type, entity_id, after, reason)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `gta_${randomUUID()}`,
        event.actor,
        event.action,
        event.entityType,
        event.entityId,
        event.after ?? null,
        event.reason ?? null,
      ],
    );
  }

  async close() {
    await this.pool.end();
  }
}
