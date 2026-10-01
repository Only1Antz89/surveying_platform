import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/generated/0006_mysterious_nightshade.sql", import.meta.url);

describe("property intelligence migration safeguards", () => {
  it("installs PostGIS and validates property identity fields", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS postgis");
    expect(migration).toContain('geometry(Point,4326)');
    expect(migration).toContain('CONSTRAINT "properties_coordinates_pair_check"');
    expect(migration).toContain('CONSTRAINT "properties_latitude_check"');
    expect(migration).toContain('CONSTRAINT "properties_longitude_check"');
    expect(migration).toContain('CONSTRAINT "properties_uprn_check"');
    expect(migration).not.toContain('UNIQUE INDEX "properties_uprn');
  });

  it("isolates tenant intelligence and makes snapshots immutable", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain('ALTER TABLE "enrichment_runs" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "enrichment_runs_tenant_policy"');
    expect(migration).toContain('ALTER TABLE "property_intelligence_snapshots" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('CREATE POLICY "property_intelligence_snapshots_tenant_policy"');
    expect(migration).toContain("organisation_id = nullif(current_setting('app.current_organisation_id', true), '')::uuid");
    expect(migration).toContain("CREATE TRIGGER property_intelligence_snapshots_immutable BEFORE UPDATE OR DELETE");
  });

  it("exposes global reference data through select-only RLS policies", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const referenceTables = ["data_sources", "dataset_versions", "dataset_syncs", "os_uprn_points", "spatial_reference_features"];

    for (const table of referenceTables) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`CREATE POLICY "${table}_read_policy" ON "${table}" FOR SELECT USING (true)`);
      expect(migration).not.toContain(`ON "${table}" FOR INSERT`);
      expect(migration).not.toContain(`ON "${table}" FOR UPDATE`);
      expect(migration).not.toContain(`ON "${table}" FOR DELETE`);
    }
  });

  it("keeps active reference versions atomic and spatially indexed", async () => {
    const migration = await readFile(migrationUrl, "utf8");

    expect(migration).toContain('CREATE UNIQUE INDEX "dataset_versions_one_active_per_source_uidx"');
    expect(migration).toContain('WHERE "active" = true');
    expect(migration).toContain('CREATE INDEX "os_uprn_points_location_gix"');
    expect(migration).toContain('CREATE INDEX "spatial_reference_geometry_gix"');
  });
});
