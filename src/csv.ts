const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function safeCell(value: string) {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map((cell) => {
    const value = safeCell(String(cell ?? ""));
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",")).join("\r\n");
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((value) => !(value.length === 1 && value[0].trim() === ""));
}
