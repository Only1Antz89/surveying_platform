import { describe, expect, it } from "vitest";
import { labelTableCells } from "./table-labels";

function cell(text: string, attrs: Record<string, string> = {}, colSpan = 1) {
  const map = new Map(Object.entries(attrs));
  return { textContent: text, colSpan, getAttribute: (k: string) => map.get(k) ?? null, hasAttribute: (k: string) => map.has(k), setAttribute: (k: string, v: string) => void map.set(k, v), label: () => map.get("data-label") };
}

describe("labelTableCells", () => {
  it("copies header names onto unlabelled cells, honouring colspan and existing labels", () => {
    const headers = [cell("Source"), cell("Jobs", {}, 2), cell("Fees")];
    const row = [cell("Agent"), cell("18"), cell("15"), cell("£21,540", { "data-label": "Total fees" })];
    const table = { querySelectorAll: (q: string) => (q.startsWith("thead") ? headers : [{ cells: row }]) };
    labelTableCells({ querySelectorAll: () => [table] } as unknown as ParentNode);
    expect(row.map((c) => c.label())).toEqual(["Source", "Jobs", "Jobs", "Total fees"]);
  });
});
