export function platformCsv(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          let text = value == null ? "" : String(value);
          if (/^[\s]*[=+@\-\t\r]/.test(text)) text = "'" + text;
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
