import type { CatalogStore } from "./store.js";
import type { CatalogRecord, RecordType, RelationshipDetail } from "./types.js";

const OWNERSHIP = new Set(["owns", "operates", "approves", "backup_for", "agency_for", "vendor_for", "escalates_to", "member_of"]);

type OwnershipResolution =
  | { target: CatalogRecord; ownership: RelationshipDetail[] }
  | { matches: CatalogRecord[]; ownership: RelationshipDetail[] };

export class CatalogService {
  constructor(
    private readonly store: CatalogStore,
    private readonly includeRestricted = false,
  ) {}

  search(input: { query?: string; recordTypes?: RecordType[]; lifecycle?: CatalogRecord["lifecycle"]; verificationState?: CatalogRecord["verificationState"]; limit?: number }) {
    return this.store.search({ ...input, includeRestricted: this.includeRestricted });
  }

  async getRecord(input: { id?: string; key?: string; recordType?: RecordType }) {
    const record = await this.store.getRecord({ ...input, includeRestricted: this.includeRestricted });
    if (!record) throw new Error("GTM catalog record not found.");
    return { record, relationships: await this.store.relationshipsFor(record.id, this.includeRestricted) };
  }

  async resolveOwnership(input: { recordId?: string; query?: string }): Promise<OwnershipResolution> {
    if (input.recordId) {
      const target = await this.getRecord({ id: input.recordId });
      return { target: target.record, ownership: target.relationships.filter(({ edge }) => OWNERSHIP.has(edge.relationshipType)) };
    }
    const matches = await this.search({ query: input.query, limit: 10 });
    if (matches.length !== 1) return { matches, ownership: [] };
    return this.resolveOwnership({ recordId: matches[0].id });
  }

  async enrichedSearch(input: { query?: string; recordTypes: RecordType[]; limit?: number }) {
    const records = await this.search({ ...input, lifecycle: "active" });
    return Promise.all(records.map((record) => this.getRecord({ id: record.id })));
  }

  async traceLineage(recordId: string, direction: "upstream" | "downstream" | "both", depth: number) {
    await this.getRecord({ id: recordId });
    let frontier = [recordId];
    const seen = new Set(frontier);
    const levels: Array<{ depth: number; relationships: Awaited<ReturnType<CatalogStore["relationshipsFor"]>> }> = [];
    for (let current = 1; current <= Math.min(Math.max(depth, 1), 4) && frontier.length; current++) {
      const relationships = (await Promise.all(frontier.map((id) => this.store.relationshipsFor(id, this.includeRestricted)))).flat();
      const filtered = relationships.filter(({ edge }) => direction === "both" || (direction === "downstream" ? frontier.includes(edge.fromRecordId) : frontier.includes(edge.toRecordId)));
      const unique = [...new Map(filtered.map((item) => [item.edge.id, item])).values()];
      levels.push({ depth: current, relationships: unique });
      const next: string[] = [];
      for (const { edge } of unique) for (const id of [edge.fromRecordId, edge.toRecordId]) if (!seen.has(id)) { seen.add(id); next.push(id); }
      frontier = next;
    }
    return { rootRecordId: recordId, direction, levels };
  }

  async checkReadiness(recordId: string) {
    const { record, relationships } = await this.getRecord({ id: recordId });
    const findings: Array<{ severity: "error" | "warning"; code: string; message: string }> = [];
    if (record.lifecycle !== "active") findings.push({ severity: "warning", code: "not_active", message: `Lifecycle is ${record.lifecycle}.` });
    if (record.verificationState !== "verified") findings.push({ severity: "warning", code: "not_verified", message: `Verification is ${record.verificationState}.` });
    if (!relationships.some(({ edge }) => edge.relationshipType === "owns" || edge.relationshipType === "operates")) findings.push({ severity: "error", code: "owner_missing", message: "No active owner or operator is mapped." });
    if (!relationships.some(({ edge, from, to }) => edge.relationshipType === "documented_by" || from.recordType === "runbook" || to.recordType === "runbook")) findings.push({ severity: "warning", code: "runbook_missing", message: "No runbook is linked." });
    const pending = await this.store.listSourceUpdates({ status: "pending", limit: 200 });
    const count = pending.filter((update) => update.internalRecordId === recordId).length;
    if (count) findings.push({ severity: "warning", code: "pending_source_updates", message: `${count} source update(s) await review.` });
    return { record, ready: !findings.some((finding) => finding.severity === "error"), findings };
  }
}
