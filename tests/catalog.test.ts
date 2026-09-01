import { describe, expect, it } from "vitest";
import { CatalogService } from "../src/catalog-service.js";
import { MemoryCatalogStore } from "../src/stores/memory.js";
import type { CatalogBundle, CatalogRecord } from "../src/types.js";

const timestamp = "2026-08-31T00:00:00.000Z";
const record = (value: Partial<CatalogRecord> & Pick<CatalogRecord, "id" | "recordType" | "key" | "name">): CatalogRecord => ({
  summary: null,
  attributes: {},
  sensitivity: "internal",
  lifecycle: "active",
  verificationState: "verified",
  lastVerifiedAt: timestamp,
  sourceUrl: null,
  sourceUpdatedAt: null,
  version: 1,
  updatedAt: timestamp,
  ...value,
});
function bundle(): CatalogBundle {
  return {
    records: [
      record({ id: "system", recordType: "system", key: "google_ads", name: "Google Ads" }),
      record({ id: "owner", recordType: "person", key: "alex", name: "Alex Owner" }),
      record({ id: "runbook", recordType: "runbook", key: "ads_incident", name: "Ads incident runbook" }),
      record({ id: "secret", recordType: "account", key: "restricted_account", name: "Restricted account", sensitivity: "restricted" }),
    ],
    relationships: [
      { id: "owns", fromRecordId: "owner", toRecordId: "system", relationshipType: "owns", isPrimary: true, context: {}, status: "active" },
      { id: "docs", fromRecordId: "system", toRecordId: "runbook", relationshipType: "documented_by", isPrimary: true, context: {}, status: "active" },
    ],
    templates: [],
    sourceUpdates: [],
  };
}

describe("CatalogService", () => {
  it("searches records and excludes restricted data by default", async () => {
    const service = new CatalogService(new MemoryCatalogStore(bundle()));
    expect((await service.search({ query: "Google" })).map((item) => item.id)).toEqual(["system"]);
    expect(await service.search({ query: "Restricted" })).toEqual([]);
  });

  it("resolves ownership and traces lineage", async () => {
    const service = new CatalogService(new MemoryCatalogStore(bundle()));
    const ownership = await service.resolveOwnership({ recordId: "system" });
    expect("target" in ownership && ownership.target.id).toBe("system");
    expect(ownership.ownership.map((item) => item.edge.id)).toEqual(["owns"]);

    const lineage = await service.traceLineage("system", "both", 2);
    expect(lineage.levels[0].relationships.map((item) => item.edge.id).sort()).toEqual(["docs", "owns"]);
  });

  it("reports a mapped owner and runbook as ready", async () => {
    const service = new CatalogService(new MemoryCatalogStore(bundle()));
    const readiness = await service.checkReadiness("system");
    expect(readiness.ready).toBe(true);
    expect(readiness.findings).toEqual([]);
  });
});
