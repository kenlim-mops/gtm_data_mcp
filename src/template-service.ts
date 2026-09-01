import { parseCsv, toCsv } from "./csv.js";
import type { CatalogStore } from "./store.js";

export class TemplateService {
  constructor(private readonly store: CatalogStore) {}

  list(input: { platformKey?: string; operation?: string } = {}) {
    return this.store.listTemplates(input);
  }

  async generate(key: string) {
    const template = await this.store.getTemplate(key);
    if (!template) throw new Error("Bulk template not found.");
    return {
      template,
      csv: toCsv([
        template.columns.map((column) => column.label ?? column.key),
        ...template.examples.map((example) => template.columns.map((column) => example[column.key] ?? "")),
      ]),
    };
  }

  async validate(key: string, csv: string) {
    const template = await this.store.getTemplate(key);
    if (!template) throw new Error("Bulk template not found.");
    const rows = parseCsv(csv);
    if (!rows.length) throw new Error("CSV is empty.");
    const headers = rows[0].map((value) => value.trim());
    const findings: Array<{ row: number; column: string | null; severity: "error" | "warning"; message: string }> = [];
    const known = new Set(template.columns.map((column) => column.label ?? column.key));
    for (const header of headers) if (!known.has(header)) findings.push({ row: 1, column: header, severity: "warning", message: "Column is not defined by this template." });
    for (const column of template.columns) {
      const label = column.label ?? column.key;
      const index = headers.indexOf(label);
      if (column.required && index < 0) findings.push({ row: 1, column: label, severity: "error", message: "Required column is missing." });
      rows.slice(1).forEach((row, rowIndex) => {
        const value = index >= 0 ? (row[index] ?? "").trim() : "";
        if (column.required && !value) findings.push({ row: rowIndex + 2, column: label, severity: "error", message: "Required value is missing." });
        if (value && column.allowedValues?.length && !column.allowedValues.includes(value)) findings.push({ row: rowIndex + 2, column: label, severity: "error", message: `Value must be one of: ${column.allowedValues.join(", ")}.` });
      });
    }
    if (template.maxRows && rows.length - 1 > template.maxRows) findings.push({ row: 1, column: null, severity: "error", message: `Template permits at most ${template.maxRows} rows.` });
    return { templateKey: key, rowCount: Math.max(rows.length - 1, 0), valid: !findings.some((finding) => finding.severity === "error"), findings };
  }
}
