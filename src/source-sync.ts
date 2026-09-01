import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CatalogRecord, RecordType } from "./types.js";

type ConnectorRow = {
  id: string; key: string; name: string; config: Record<string, unknown>;
  credential_ref: string | null; auto_apply: boolean; authoritative_fields: string[];
  last_succeeded_at: Date | null;
};

type Candidate = {
  externalId: string; recordType: RecordType; key: string; name: string;
  summary: string | null; attributes: Record<string, unknown>;
  sensitivity: "internal" | "restricted"; lifecycle: CatalogRecord["lifecycle"];
  sourceUrl: string | null; sourceUpdatedAt: string | null;
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
  return value;
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function text(parts: unknown) {
  return Array.isArray(parts) ? parts.map((item) => (item as { plain_text?: string })?.plain_text ?? "").join("") : "";
}

export function notionPropertyValue(property: unknown): unknown {
  if (!property || typeof property !== "object") return null;
  const p = property as Record<string, unknown>;
  switch (p.type) {
    case "title": return text(p.title);
    case "rich_text": return text(p.rich_text);
    case "number": return p.number ?? null;
    case "checkbox": return Boolean(p.checkbox);
    case "url": case "email": case "phone_number": return p[String(p.type)] ?? null;
    case "select": return (p.select as { name?: string } | null)?.name ?? null;
    case "status": return (p.status as { name?: string } | null)?.name ?? null;
    case "multi_select": return Array.isArray(p.multi_select) ? p.multi_select.map((item) => (item as { name?: string }).name).filter(Boolean) : [];
    case "people": return Array.isArray(p.people) ? p.people.map((item) => { const person = item as { id?: string; name?: string; person?: { email?: string } }; return { id: person.id ?? null, name: person.name ?? null, email: person.person?.email ?? null }; }) : [];
    case "relation": return Array.isArray(p.relation) ? p.relation.map((item) => (item as { id?: string }).id).filter(Boolean) : [];
    case "date": return p.date ?? null;
    case "unique_id": { const value = p.unique_id as { prefix?: string | null; number?: number } | null; return value ? `${value.prefix ?? ""}${value.number ?? ""}` : null; }
    default: return null;
  }
}

async function fetchNotion(connector: ConnectorRow, fetcher: typeof fetch = fetch): Promise<Candidate[]> {
  if (!process.env.NOTION_API_TOKEN || !["env:NOTION_API_TOKEN", "NOTION_API_TOKEN"].includes(connector.credential_ref ?? "")) throw new Error("NOTION_API_TOKEN is not configured for this connector.");
  const config = connector.config as {
    dataSourceId?: string; recordType?: RecordType; titleProperty?: string; keyProperty?: string;
    summaryProperty?: string; lifecycleProperty?: string; sensitivity?: "internal" | "restricted";
    attributeMap?: Record<string, string>;
  };
  if (!config.dataSourceId || !config.recordType) throw new Error("Notion connector requires dataSourceId and recordType.");
  const records: Candidate[] = [];
  let cursor: string | null = null;
  const since = connector.last_succeeded_at ? new Date(connector.last_succeeded_at.getTime() - 5 * 60_000) : null;
  do {
    const response = await fetcher(`https://api.notion.com/v1/data_sources/${encodeURIComponent(config.dataSourceId)}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NOTION_API_TOKEN}`, "Notion-Version": "2026-03-11", "Content-Type": "application/json" },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...(since ? { filter: { timestamp: "last_edited_time", last_edited_time: { after: since.toISOString() } } } : {}) }),
    });
    if (!response.ok) throw new Error(`Notion query failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const page = await response.json() as { results?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null };
    for (const raw of page.results ?? []) {
      if (raw.object !== "page" || typeof raw.id !== "string") continue;
      const properties = (raw.properties ?? {}) as Record<string, unknown>;
      const name = String(notionPropertyValue(properties[config.titleProperty ?? "Name"]) ?? "").trim();
      if (!name) continue;
      const keyValue = config.keyProperty ? String(notionPropertyValue(properties[config.keyProperty]) ?? "") : name;
      const attributes: Record<string, unknown> = {};
      for (const [source, target] of Object.entries(config.attributeMap ?? {})) attributes[target] = notionPropertyValue(properties[source]);
      const rawLifecycle = config.lifecycleProperty ? String(notionPropertyValue(properties[config.lifecycleProperty]) ?? "active").toLowerCase() : "active";
      const lifecycle = raw.archived === true || raw.in_trash === true ? "inactive" : ["draft", "active", "inactive", "deprecated"].includes(rawLifecycle) ? rawLifecycle as CatalogRecord["lifecycle"] : "active";
      records.push({
        externalId: raw.id,
        recordType: config.recordType,
        key: slug(keyValue) || raw.id.replace(/-/g, ""),
        name,
        summary: config.summaryProperty ? String(notionPropertyValue(properties[config.summaryProperty]) ?? "").trim() || null : null,
        attributes,
        sensitivity: config.sensitivity ?? "internal",
        lifecycle,
        sourceUrl: typeof raw.url === "string" ? raw.url : null,
        sourceUpdatedAt: typeof raw.last_edited_time === "string" ? raw.last_edited_time : null,
      });
    }
    cursor = page.has_more && page.next_cursor ? page.next_cursor : null;
  } while (cursor);
  return records;
}

function payload(candidate: Candidate) {
  return { recordType: candidate.recordType, key: candidate.key, name: candidate.name, summary: candidate.summary, attributes: candidate.attributes, sensitivity: candidate.sensitivity, lifecycle: candidate.lifecycle, verificationState: "unverified", sourceUrl: candidate.sourceUrl, sourceUpdatedAt: candidate.sourceUpdatedAt };
}

function currentPayload(row: Record<string, unknown> | null) {
  if (!row) return null;
  return { recordType: row.record_type, key: row.key, name: row.name, summary: row.summary, attributes: row.attributes, sensitivity: row.sensitivity, lifecycle: row.lifecycle, verificationState: row.verification_state, sourceUrl: row.source_url, sourceUpdatedAt: row.source_updated_at ? new Date(String(row.source_updated_at)).toISOString() : null, version: row.version };
}

function difference(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
    if (key === "version") continue;
    if (hash({ value: before?.[key] }) !== hash({ value: after[key] })) diff[key] = { before: before?.[key] ?? null, after: after[key] ?? null };
  }
  return diff;
}

async function applyExisting(client: PoolClient, recordId: string, after: ReturnType<typeof payload>, actor: string) {
  const before = (await client.query("select * from gtm_catalog_records where id=$1", [recordId])).rows[0];
  await client.query(
    `update gtm_catalog_records set record_type=$2,key=$3,name=$4,summary=$5,attributes=$6,sensitivity=$7,lifecycle=$8,
     verification_state=$9,source_url=$10,source_updated_at=$11,version=version+1,updated_at=now() where id=$1`,
    [recordId, after.recordType, after.key, after.name, after.summary, after.attributes, after.sensitivity, after.lifecycle, after.verificationState, after.sourceUrl, after.sourceUpdatedAt],
  );
  await client.query("insert into gtm_audit_events (id,actor,action,entity_type,entity_id,before,after,reason) values ($1,$2,'source_update.auto_applied','catalog_record',$3,$4,$5,$6)", [`gta_${randomUUID()}`, actor, recordId, before, after, "Explicit connector authoritative-field allowlist"]);
}

export async function syncConnector(pool: Pool, connectorId: string, trigger: "schedule" | "manual" = "manual") {
  const owner = `lock_${randomUUID()}`;
  const lock = await pool.query(
    `update gtm_source_connectors set lock_owner=$2,lock_expires_at=now()+interval '10 minutes',last_started_at=now(),updated_at=now()
     where id=$1 and (lock_expires_at is null or lock_expires_at < now()) returning *`,
    [connectorId, owner],
  );
  if (!lock.rows[0]) return { skipped: true, reason: "Connector is already running or missing." };
  const connector = lock.rows[0] as ConnectorRow;
  const runId = `gss_${randomUUID()}`;
  await pool.query("insert into gtm_source_sync_runs (id,connector_id,trigger) values ($1,$2,$3)", [runId, connectorId, trigger]);
  let seen = 0, changed = 0, applied = 0, proposed = 0;
  try {
    const candidates = await fetchNotion(connector);
    for (const candidate of candidates) {
      seen++;
      const after = payload(candidate);
      const contentHash = hash(after);
      const priorResult = await pool.query("select * from gtm_source_records where connector_id=$1 and external_id=$2", [connectorId, candidate.externalId]);
      const prior = priorResult.rows[0];
      if (prior?.content_hash === contentHash) { await pool.query("update gtm_source_records set last_seen_at=now() where id=$1", [prior.id]); continue; }
      changed++;
      let internal = prior?.internal_record_id ? (await pool.query("select * from gtm_catalog_records where id=$1", [prior.internal_record_id])).rows[0] : null;
      if (!internal) internal = (await pool.query("select * from gtm_catalog_records where record_type=$1 and key=$2 limit 1", [candidate.recordType, candidate.key])).rows[0] ?? null;
      const before = currentPayload(internal ?? null);
      const diff = difference(before, after);
      const sourceId = prior?.id ?? `gsr_${randomUUID()}`;
      await pool.query(
        `insert into gtm_source_records (id,connector_id,external_id,internal_record_id,source_url,content_hash,source_updated_at,payload,status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'proposed')
         on conflict (connector_id,external_id) do update set internal_record_id=excluded.internal_record_id,source_url=excluded.source_url,
           content_hash=excluded.content_hash,source_updated_at=excluded.source_updated_at,payload=excluded.payload,status='proposed',last_seen_at=now()`,
        [sourceId, connectorId, candidate.externalId, internal?.id ?? null, candidate.sourceUrl, contentHash, candidate.sourceUpdatedAt, after],
      );
      await pool.query("update gtm_change_proposals set status='superseded',reason='Newer source version detected',updated_at=now() where source_record_id=$1 and status='pending'", [sourceId]);
      if (!Object.keys(diff).length) { await pool.query("update gtm_source_records set status='current' where id=$1", [sourceId]); continue; }
      const allowed = new Set(connector.authoritative_fields ?? []);
      if (internal && connector.auto_apply && Object.keys(diff).every((field) => allowed.has(field))) {
        const client = await pool.connect();
        try { await client.query("begin"); await applyExisting(client, internal.id, after, `source:${connector.key}`); await client.query("update gtm_source_records set status='current',internal_record_id=$2 where id=$1", [sourceId, internal.id]); await client.query("commit"); applied++; continue; }
        catch (error) { await client.query("rollback"); throw error; }
        finally { client.release(); }
      }
      await pool.query(
        `insert into gtm_change_proposals (id,connector_id,source_record_id,internal_record_id,proposal_type,before,after,diff)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [`gcp_${randomUUID()}`, connectorId, sourceId, internal?.id ?? null, internal ? candidate.lifecycle === "inactive" ? "deactivate" : "update" : "create", before, after, diff],
      );
      proposed++;
    }
    await pool.query("update gtm_source_sync_runs set status='succeeded',finished_at=now(),seen_count=$2,changed_count=$3,applied_count=$4,proposed_count=$5 where id=$1", [runId, seen, changed, applied, proposed]);
    await pool.query("update gtm_source_connectors set lock_owner=null,lock_expires_at=null,last_succeeded_at=now(),last_error=null,updated_at=now() where id=$1 and lock_owner=$2", [connectorId, owner]);
    return { skipped: false, runId, seen, changed, applied, proposed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    await pool.query("update gtm_source_sync_runs set status='failed',finished_at=now(),seen_count=$2,changed_count=$3,applied_count=$4,proposed_count=$5,error=$6 where id=$1", [runId, seen, changed, applied, proposed, message]);
    await pool.query("update gtm_source_connectors set lock_owner=null,lock_expires_at=null,last_error=$3,updated_at=now() where id=$1 and lock_owner=$2", [connectorId, owner, message]);
    throw error;
  }
}

export async function syncDueConnectors(pool: Pool) {
  const due = await pool.query(
    `select id from gtm_source_connectors where status='active'
     and (last_started_at is null or last_started_at + make_interval(mins => schedule_minutes) <= now())`,
  );
  const results = [];
  for (const row of due.rows) {
    try { results.push({ connectorId: row.id, result: await syncConnector(pool, row.id, "schedule") }); }
    catch (error) { results.push({ connectorId: row.id, error: error instanceof Error ? error.message : "Sync failed." }); }
  }
  return { due: due.rowCount ?? 0, results };
}
