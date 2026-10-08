import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(import.meta.dirname, "../migrations/generated/0026_silent_whizzer.sql"), "utf8");
const calendarMigration = readFileSync(resolve(import.meta.dirname, "../migrations/generated/0029_hard_sue_storm.sql"), "utf8");
const settlementMigration = readFileSync(resolve(import.meta.dirname, "../migrations/generated/0030_empty_nitro.sql"), "utf8");
const deliveryMigration = readFileSync(resolve(import.meta.dirname, "../migrations/generated/0031_complex_lady_deathstrike.sql"), "utf8");
describe("firm operations schema", () => {
  it("enforces tenant isolation across the operations foundation", () => {
    for (const table of ["customer_quotes", "appointments", "client_payments", "organisation_documents", "calendar_connections"]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(calendarMigration).toContain("calendar_event_links_tenant_isolation");
    expect(settlementMigration).toContain("ARRAY['settlement_batches','settlement_batch_items']");
    expect(settlementMigration).toContain("tenant_table || '_tenant_isolation'");
    expect(deliveryMigration).toContain("ARRAY['communication_deliveries','report_deliveries']");
    expect(deliveryMigration).toContain("tenant_table || '_tenant_isolation'");
  });
  it("keeps quote evidence and finance history immutable", () => {
    expect(migration).toContain("quote_snapshots_immutable");
    expect(migration).toContain("settlement_ledger_immutable");
    expect(settlementMigration).toContain("settlement_batches_immutable");
  });
});
