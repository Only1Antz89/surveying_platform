import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { clients, organisations, properties } from "../src/index";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "./harness";

describe.skipIf(!integrationEnabled)("tenant isolation baseline", () => {
  let database: TestDatabase;
  const firmA = "00000000-0000-0000-0000-00000000000a";
  const firmB = "00000000-0000-0000-0000-00000000000b";
  let propertyB = "";

  beforeAll(async () => {
    database = await createTestDatabase();
    const admin = database.connect(database.adminUrl);
    await admin.insert(organisations).values([
      { id: firmA, clerkOrganisationId: "org_a", name: "Firm A", slug: "firm-a", practiceType: "residential", region: "Bristol" },
      { id: firmB, clerkOrganisationId: "org_b", name: "Firm B", slug: "firm-b", practiceType: "residential", region: "Leeds" },
    ]);
    const [clientB] = await admin.insert(clients).values({ organisationId: firmB, kind: "individual", displayName: "Client B" }).returning();
    const [created] = await admin.insert(properties).values({ organisationId: firmB, clientId: clientB.id, line1: "1 Example Street", city: "Leeds", postcode: "LS1 1AA" }).returning();
    propertyB = created.id;
  }, 60_000);

  afterAll(async () => {
    await database?.drop();
    await stopRelay();
  });

  it("hides another firm's property even when its id is guessed", async () => {
    const app = database.connect(database.appUrl);
    const rows = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${firmA}, true)`);
      return tx.select().from(properties).where(eq(properties.id, propertyB));
    });
    expect(rows).toHaveLength(0);
  });

  it("cannot update another firm's property", async () => {
    const app = database.connect(database.appUrl);
    const updated = await app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_organisation_id', ${firmA}, true)`);
      return tx.update(properties).set({ line1: "Hijacked" }).where(and(eq(properties.id, propertyB))).returning();
    });
    expect(updated).toHaveLength(0);
  });

  it("returns nothing without a tenant context", async () => {
    const app = database.connect(database.appUrl);
    const rows = await app.select().from(properties);
    expect(rows).toHaveLength(0);
  });
});
