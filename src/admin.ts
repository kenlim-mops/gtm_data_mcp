import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { CatalogBundle, CatalogRecord } from "./types.js";

class CommittedProposalError extends Error {}

export async function readBundle(path: string): Promise<CatalogBundle> {
  return JSON.parse(await readFile(path, "utf8")) as CatalogBundle;
}

export async function importBundle(pool: Pool, bundle: CatalogBundle, actor: string, reason: string) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const record of bundle.records) {
      await client.query(
        `insert into gtm_catalog_records
         (id, record_type, key, name, summary, attributes, sensitivity, lifecycle, verification_state, last_verified_at, source_url, source_updated_at, version, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (record_type, key) do update set
           name=excluded.name, summary=excluded.summary, attributes=excluded.attributes,
           sensitivity=excluded.sensitivity, lifecycle=excluded.lifecycle,
           verification_state=excluded.verification_state, last_verified_at=excluded.last_verified_at,
           source_url=excluded.source_url, source_updated_at=excluded.source_updated_at,
           version=gtm_catalog_records.version+1, updated_at=now()`,
        [record.id, record.recordType, record.key, record.name, record.summary, record.attributes, record.sensitivity, record.lifecycle, record.verificationState, record.lastVerifiedAt, record.sourceUrl, record.sourceUpdatedAt, record.version, record.updatedAt],
      );
    }
    for (const relationship of bundle.relationships) {
      await client.query(
        `insert into gtm_catalog_relationships
         (id, from_record_id, to_record_id, relationship_type, is_primary, context, status)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (from_record_id, to_record_id, relationship_type) do update set
           is_primary=excluded.is_primary, context=excluded.context, status=excluded.status`,
        [relationship.id, relationship.fromRecordId, relationship.toRecordId, relationship.relationshipType, relationship.isPrimary, relationship.context, relationship.status],
      );
    }
    for (const template of bundle.templates) {
      await client.query(
        `insert into gtm_bulk_templates
         (id,key,name,platform_key,object_type,operation,format,columns,examples,max_rows,availability_notes,docs_url,verification_state,lifecycle)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (key) do update set name=excluded.name, platform_key=excluded.platform_key,
           object_type=excluded.object_type, operation=excluded.operation, format=excluded.format,
           columns=excluded.columns, examples=excluded.examples, max_rows=excluded.max_rows,
           availability_notes=excluded.availability_notes, docs_url=excluded.docs_url,
           verification_state=excluded.verification_state, lifecycle=excluded.lifecycle,
           version=gtm_bulk_templates.version+1, updated_at=now()`,
        [template.id, template.key, template.name, template.platformKey, template.objectType, template.operation, template.format, template.columns, template.examples, template.maxRows, template.availabilityNotes, template.docsUrl, template.verificationState, template.lifecycle],
      );
    }
    for (const connector of bundle.connectors ?? []) {
      if (connector.autoApply && !connector.authoritativeFields.length) throw new Error(`Connector ${connector.key} enables auto-apply without authoritative fields.`);
      await client.query(
        `insert into gtm_source_connectors
         (id,key,name,source_type,status,config,credential_ref,schedule_minutes,auto_apply,authoritative_fields)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (key) do update set name=excluded.name, status=excluded.status,
           config=excluded.config, credential_ref=excluded.credential_ref,
           schedule_minutes=excluded.schedule_minutes, auto_apply=excluded.auto_apply,
           authoritative_fields=excluded.authoritative_fields, updated_at=now()`,
        [connector.id, connector.key, connector.name, connector.sourceType, connector.status, connector.config, connector.credentialRef, connector.scheduleMinutes, connector.autoApply, connector.authoritativeFields],
      );
    }
    await client.query(
      `insert into gtm_audit_events (id,actor,action,entity_type,entity_id,after,reason)
       values ($1,$2,'catalog.bundle_imported','catalog_bundle','catalog',$3,$4)`,
      [`gta_${randomUUID()}`, actor, { records: bundle.records.length, relationships: bundle.relationships.length, templates: bundle.templates.length, connectors: bundle.connectors?.length ?? 0 }, reason],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function decideProposal(pool: Pool, proposalId: string, decision: "approve" | "reject", actor: string, reason: string) {
  if (!reason.trim()) throw new Error("A review reason is required.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const proposalResult = await client.query("select * from gtm_change_proposals where id=$1 for update", [proposalId]);
    const proposal = proposalResult.rows[0];
    if (!proposal) throw new Error("Proposal not found.");
    if (proposal.status !== "pending") throw new Error(`Proposal is already ${proposal.status}.`);
    if (decision === "reject") {
      await client.query("update gtm_change_proposals set status='rejected',reason=$2,decided_by=$3,decided_at=now(),updated_at=now() where id=$1", [proposalId, reason, actor]);
      await client.query("update gtm_source_records set status='ignored' where id=$1", [proposal.source_record_id]);
    } else {
      const after = proposal.after as Partial<CatalogRecord>;
      if (!after.recordType || !after.key || !after.name) throw new Error("Proposal payload is invalid.");
      let recordId = proposal.internal_record_id as string | null;
      if (recordId) {
        const currentResult = await client.query("select * from gtm_catalog_records where id=$1 for update", [recordId]);
        const current = currentResult.rows[0];
        if (!current) throw new Error("Target catalog record not found.");
        const expectedVersion = proposal.before?.version;
        if (expectedVersion && current.version !== expectedVersion) {
          await client.query("update gtm_change_proposals set status='superseded',reason='Catalog changed after proposal creation',updated_at=now() where id=$1", [proposalId]);
          await client.query(
            `insert into gtm_audit_events (id,actor,action,entity_type,entity_id,before,reason)
             values ($1,$2,'source_update.superseded','change_proposal',$3,$4,$5)`,
            [`gta_${randomUUID()}`, actor, proposalId, proposal, "Catalog changed after proposal creation"],
          );
          await client.query("commit");
          throw new CommittedProposalError("Catalog changed after proposal creation; proposal marked superseded. Rescan before applying.");
        }
        await client.query(
          `update gtm_catalog_records set record_type=$2,key=$3,name=$4,summary=$5,attributes=$6,
           sensitivity=$7,lifecycle=$8,verification_state=$9,source_url=$10,source_updated_at=$11,
           version=version+1,updated_at=now() where id=$1`,
          [recordId, after.recordType, after.key, after.name, after.summary ?? null, after.attributes ?? {}, after.sensitivity ?? "internal", proposal.proposal_type === "deactivate" ? "inactive" : after.lifecycle ?? "active", after.verificationState ?? "unverified", after.sourceUrl ?? null, after.sourceUpdatedAt ?? null],
        );
      } else {
        recordId = `gdr_${randomUUID()}`;
        await client.query(
          `insert into gtm_catalog_records
           (id,record_type,key,name,summary,attributes,sensitivity,lifecycle,verification_state,source_url,source_updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [recordId, after.recordType, after.key, after.name, after.summary ?? null, after.attributes ?? {}, after.sensitivity ?? "internal", after.lifecycle ?? "active", after.verificationState ?? "unverified", after.sourceUrl ?? null, after.sourceUpdatedAt ?? null],
        );
      }
      await client.query("update gtm_change_proposals set status='applied',internal_record_id=$2,reason=$3,decided_by=$4,decided_at=now(),applied_at=now(),updated_at=now() where id=$1", [proposalId, recordId, reason, actor]);
      await client.query("update gtm_source_records set status='current',internal_record_id=$2 where id=$1", [proposal.source_record_id, recordId]);
    }
    await client.query(
      `insert into gtm_audit_events (id,actor,action,entity_type,entity_id,before,reason)
       values ($1,$2,$3,'change_proposal',$4,$5,$6)`,
      [`gta_${randomUUID()}`, actor, decision === "approve" ? "source_update.applied" : "source_update.rejected", proposalId, proposal, reason],
    );
    await client.query("commit");
  } catch (error) {
    if (!(error instanceof CommittedProposalError)) await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
