/**
 * On narrow screens .data-table rows stack as cards and each cell shows its
 * column name from data-label. Fill in any missing labels from the table's
 * own header row so every table reads correctly on a phone.
 */
export function labelTableCells(root: ParentNode) {
  for (const table of root.querySelectorAll<HTMLTableElement>("table.data-table")) {
    const headers = [...table.querySelectorAll<HTMLTableCellElement>("thead tr:last-child th")];
    if (!headers.length) continue;
    const names: string[] = [];
    for (const th of headers) {
      const name = (th.getAttribute("aria-label") ?? th.textContent ?? "").trim();
      for (let span = 0; span < (th.colSpan || 1); span += 1) names.push(name);
    }
    for (const row of table.querySelectorAll<HTMLTableRowElement>("tbody tr")) {
      let column = 0;
      for (const cell of row.cells) {
        const name = names[column];
        if (name && !cell.hasAttribute("data-label")) cell.setAttribute("data-label", name);
        column += cell.colSpan || 1;
      }
    }
  }
}
