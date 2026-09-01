import type {
  BulkTemplate,
  CatalogRecord,
  RelationshipDetail,
  SearchInput,
  SourceUpdate,
} from "./types.js";

export interface CatalogStore {
  search(input?: SearchInput): Promise<CatalogRecord[]>;
  getRecord(input: { id?: string; key?: string; recordType?: CatalogRecord["recordType"]; includeRestricted?: boolean }): Promise<CatalogRecord | null>;
  relationshipsFor(recordId: string, includeRestricted?: boolean): Promise<RelationshipDetail[]>;
  listTemplates(input?: { platformKey?: string; operation?: string }): Promise<BulkTemplate[]>;
  getTemplate(key: string): Promise<BulkTemplate | null>;
  listSourceUpdates(input?: { status?: SourceUpdate["status"]; connectorKey?: string; limit?: number }): Promise<SourceUpdate[]>;
  close?(): Promise<void>;
}
