export const RECORD_TYPES = [
  "person",
  "team",
  "agency",
  "vendor",
  "system",
  "account",
  "integration",
  "data_term",
  "data_field",
  "measurement_asset",
  "runbook",
  "policy",
  "report",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export interface CatalogRecord {
  id: string;
  recordType: RecordType;
  key: string;
  name: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  sensitivity: "internal" | "restricted";
  lifecycle: "draft" | "active" | "inactive" | "deprecated";
  verificationState: "unverified" | "verified" | "stale" | "conflict";
  lastVerifiedAt: string | null;
  sourceUrl: string | null;
  sourceUpdatedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface CatalogRelationship {
  id: string;
  fromRecordId: string;
  toRecordId: string;
  relationshipType: string;
  isPrimary: boolean;
  context: Record<string, unknown>;
  status: "active" | "inactive";
}

export interface RelationshipDetail {
  edge: CatalogRelationship;
  from: CatalogRecord;
  to: CatalogRecord;
}

export interface BulkTemplateColumn {
  key: string;
  label?: string;
  required?: boolean;
  description?: string;
  allowedValues?: string[];
}

export interface BulkTemplate {
  id: string;
  key: string;
  name: string;
  platformKey: string;
  objectType: string;
  operation: string;
  format: "csv" | "json";
  columns: BulkTemplateColumn[];
  examples: Record<string, unknown>[];
  maxRows: number | null;
  availabilityNotes: string | null;
  docsUrl: string | null;
  verificationState: "draft" | "verified" | "deprecated";
  lifecycle: "active" | "inactive" | "deprecated";
}

export interface SourceUpdate {
  id: string;
  connectorKey: string;
  proposalType: "create" | "update" | "deactivate";
  status: "pending" | "approved" | "rejected" | "applied" | "superseded";
  externalId: string;
  sourceUrl: string | null;
  internalRecordId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  diff: Record<string, { before: unknown; after: unknown }>;
  createdAt: string;
}

export interface SourceConnector {
  id: string;
  key: string;
  name: string;
  sourceType: "notion";
  status: "active" | "paused" | "error";
  config: Record<string, unknown>;
  credentialRef: "env:NOTION_API_TOKEN";
  scheduleMinutes: number;
  autoApply: boolean;
  authoritativeFields: string[];
}

export interface CatalogBundle {
  records: CatalogRecord[];
  relationships: CatalogRelationship[];
  templates: BulkTemplate[];
  sourceUpdates?: SourceUpdate[];
  connectors?: SourceConnector[];
}

export interface SearchInput {
  query?: string;
  recordTypes?: RecordType[];
  lifecycle?: CatalogRecord["lifecycle"];
  verificationState?: CatalogRecord["verificationState"];
  includeRestricted?: boolean;
  limit?: number;
}
