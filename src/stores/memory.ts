import type { CatalogStore } from "../store.js";
import type {
  BulkTemplate,
  CatalogBundle,
  CatalogRecord,
  RelationshipDetail,
  SearchInput,
  SourceUpdate,
} from "../types.js";

export class MemoryCatalogStore implements CatalogStore {
  constructor(protected readonly bundle: CatalogBundle) {}

  async search(input: SearchInput = {}): Promise<CatalogRecord[]> {
    const needle = input.query?.trim().toLowerCase();
    return this.bundle.records
      .filter((record) => input.includeRestricted || record.sensitivity !== "restricted")
      .filter((record) => !input.recordTypes?.length || input.recordTypes.includes(record.recordType))
      .filter((record) => !input.lifecycle || record.lifecycle === input.lifecycle)
      .filter((record) => !input.verificationState || record.verificationState === input.verificationState)
      .filter((record) => !needle || [record.key, record.name, record.summary ?? "", JSON.stringify(record.attributes)].some((value) => value.toLowerCase().includes(needle)))
      .sort((a, b) => a.recordType.localeCompare(b.recordType) || a.name.localeCompare(b.name))
      .slice(0, Math.min(Math.max(input.limit ?? 50, 1), 200));
  }

  async getRecord(input: { id?: string; key?: string; recordType?: CatalogRecord["recordType"]; includeRestricted?: boolean }) {
    return this.bundle.records.find((record) =>
      (!input.id || record.id === input.id) &&
      (!input.key || record.key === input.key) &&
      (!input.recordType || record.recordType === input.recordType) &&
      (input.includeRestricted || record.sensitivity !== "restricted"),
    ) ?? null;
  }

  async relationshipsFor(recordId: string, includeRestricted = false): Promise<RelationshipDetail[]> {
    const records = new Map(this.bundle.records.map((record) => [record.id, record]));
    return this.bundle.relationships
      .filter((edge) => edge.status === "active" && (edge.fromRecordId === recordId || edge.toRecordId === recordId))
      .map((edge) => ({ edge, from: records.get(edge.fromRecordId), to: records.get(edge.toRecordId) }))
      .filter((value): value is RelationshipDetail => Boolean(value.from && value.to))
      .filter(({ from, to }) => includeRestricted || (from.sensitivity !== "restricted" && to.sensitivity !== "restricted"));
  }

  async listTemplates(input: { platformKey?: string; operation?: string } = {}): Promise<BulkTemplate[]> {
    return this.bundle.templates.filter((template) =>
      template.lifecycle === "active" &&
      (!input.platformKey || template.platformKey === input.platformKey) &&
      (!input.operation || template.operation === input.operation),
    );
  }

  async getTemplate(key: string): Promise<BulkTemplate | null> {
    return this.bundle.templates.find((template) => template.key === key) ?? null;
  }

  async listSourceUpdates(input: { status?: SourceUpdate["status"]; connectorKey?: string; limit?: number } = {}) {
    return (this.bundle.sourceUpdates ?? [])
      .filter((update) => !input.status || update.status === input.status)
      .filter((update) => !input.connectorKey || update.connectorKey === input.connectorKey)
      .slice(0, Math.min(Math.max(input.limit ?? 50, 1), 200));
  }
}
