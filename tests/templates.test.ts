import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../src/csv.js";
import { MemoryCatalogStore } from "../src/stores/memory.js";
import { TemplateService } from "../src/template-service.js";
import type { CatalogBundle } from "../src/types.js";

const bundle: CatalogBundle = {
  records: [],
  relationships: [],
  templates: [{
    id: "template",
    key: "review",
    name: "Review",
    platformKey: "runpod",
    objectType: "record",
    operation: "update",
    format: "csv",
    columns: [
      { key: "id", label: "ID", required: true },
      { key: "action", label: "Action", required: true, allowedValues: ["update", "deactivate"] },
    ],
    examples: [{ id: "abc", action: "update" }],
    maxRows: 2,
    availabilityNotes: null,
    docsUrl: null,
    verificationState: "verified",
    lifecycle: "active",
  }],
};

describe("CSV and bulk templates", () => {
  it("round-trips quoted CSV and neutralizes spreadsheet formulas", () => {
    const csv = toCsv([["Name", "Value"], ["a,b", "=IMPORTXML()"]]);
    expect(csv).toContain("\"a,b\"");
    expect(csv).toContain("'=IMPORTXML()");
    expect(parseCsv(csv)[1]).toEqual(["a,b", "'=IMPORTXML()"]);
  });

  it("generates the governed template", async () => {
    const service = new TemplateService(new MemoryCatalogStore(bundle));
    const output = await service.generate("review");
    expect(output.csv).toBe("ID,Action\r\nabc,update");
    expect(output.template.verificationState).toBe("verified");
  });

  it("finds missing, invalid, and over-limit values", async () => {
    const service = new TemplateService(new MemoryCatalogStore(bundle));
    const output = await service.validate("review", "ID,Action\nabc,create\n,update\ndef,update");
    expect(output.valid).toBe(false);
    expect(output.rowCount).toBe(3);
    expect(output.findings.map((item) => item.message)).toEqual(expect.arrayContaining([
      "Value must be one of: update, deactivate.",
      "Required value is missing.",
      "Template permits at most 2 rows.",
    ]));
  });
});
