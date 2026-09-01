import { describe, expect, it } from "vitest";
import { notionPropertyValue } from "../src/source-sync.js";

describe("Notion normalization", () => {
  it("normalizes supported property types", () => {
    expect(notionPropertyValue({ type: "title", title: [{ plain_text: "Google Ads" }] })).toBe("Google Ads");
    expect(notionPropertyValue({ type: "select", select: { name: "Active" } })).toBe("Active");
    expect(notionPropertyValue({ type: "multi_select", multi_select: [{ name: "Paid" }, { name: "Search" }] })).toEqual(["Paid", "Search"]);
    expect(notionPropertyValue({ type: "relation", relation: [{ id: "page-1" }] })).toEqual(["page-1"]);
  });

  it("does not copy unsupported Notion property payloads", () => {
    expect(notionPropertyValue({ type: "formula", formula: { string: "secret" } })).toBeNull();
  });
});
