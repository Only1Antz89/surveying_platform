import { sql } from "drizzle-orm";
import type { Database, TenantTransaction } from "@surveynt/db";

export function csvCell(value: unknown) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** One repeatable-read tenant snapshot, bounded pages, and consumer backpressure. */
export function tenantCsv(db: Database, organisationId: string, columns: string[], page: (tx: TenantTransaction) => Promise<unknown[][]>) {
  let cancelled = false, credits = 1;
  let wake: (() => void) | undefined;
  let completion: Promise<void> | undefined;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      async function write(rows: unknown[][]) {
        while (!cancelled && !credits) await new Promise<void>(resolve => { wake = resolve; });
        if (cancelled) return;
        credits--;
        controller.enqueue(encoder.encode(rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n"));
      }
      completion = db.transaction(async tx => {
        await tx.execute(sql`select set_config('app.current_organisation_id', ${organisationId}, true)`);
        await write([columns]);
        while (!cancelled) {
          const rows = await page(tx);
          if (!rows.length) break;
          await write(rows);
        }
      }, { isolationLevel: "repeatable read", accessMode: "read only" }).then(() => {
        if (!cancelled) controller.close();
      }).catch(error => {
        if (!cancelled) controller.error(error);
      }).finally(() => db.$client.end().catch(() => undefined));
    },
    pull() { credits++; wake?.(); wake = undefined; },
    cancel() { cancelled = true; wake?.(); wake = undefined; return completion; },
  });
}
