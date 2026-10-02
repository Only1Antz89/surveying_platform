/**
 * Parses one RFC 4180 CSV record held on a single line (quoted fields,
 * doubled quotes, commas inside quotes). Returns null for an unterminated
 * quote. Price Paid and the look-up files never span lines.
 */
export function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  let atFieldStart = true;
  while (index < line.length) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') { field += '"'; index += 2; continue; }
        quoted = false; index += 1; continue;
      }
      field += char; index += 1; continue;
    }
    if (char === '"' && atFieldStart) { quoted = true; atFieldStart = false; index += 1; continue; }
    if (char === ",") { fields.push(field); field = ""; atFieldStart = true; index += 1; continue; }
    field += char; atFieldStart = false; index += 1;
  }
  if (quoted) return null;
  fields.push(field);
  return fields;
}
