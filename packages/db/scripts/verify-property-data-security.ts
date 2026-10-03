import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { clients, createDatabase, enrichmentRuns, organisations, properties } from "../src/index";

async function main() {
  if (!process.env.DATABASE_APP_URL || !process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_APP_URL and DATABASE_ADMIN_URL are required.");
  const application = createDatabase(process.env.DATABASE_APP_URL);
  const administrator = createDatabase(process.env.DATABASE_ADMIN_URL);

  const [referenceRead, canonicalReferenceRead, propertyRows, policies, triggerRows, rlsRows, operationsPolicies] = await Promise.all([
    application.execute(sql`select count(*)::int as count from data_sources`),
    application.execute(sql`select count(*)::int as count from reference.data_sources`),
    administrator.execute(sql`select id, organisation_id from properties order by created_at asc limit 1`),
    administrator.execute(sql`select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('address_search_cache', 'enrichment_runs', 'property_intelligence_snapshots', 'data_sources', 'dataset_versions', 'dataset_syncs', 'os_uprn_points', 'spatial_reference_features') order by tablename, policyname`),
    administrator.execute(sql`select tgname from pg_trigger where tgrelid = 'property_intelligence_snapshots'::regclass and not tgisinternal`),
    administrator.execute(sql`select relname from pg_class where relname in ('address_search_cache', 'address_provider_rate_limits') and relrowsecurity = true`),
    administrator.execute(sql`select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('organisation_operational_settings','service_pricing_versions','customer_quotes','quote_snapshots','availability_blocks','appointments','calendar_connections','calendar_event_links','calendar_conflicts','invoices','invoice_line_items','client_payments','settlement_ledger','settlement_batches','settlement_batch_items','organisation_documents','communication_templates','communication_deliveries','report_deliveries')`),
  ]);

  const sourceCount = Number((referenceRead.rows[0] as { count?: number } | undefined)?.count ?? 0);
  if (sourceCount < 7) throw new Error("The application role could not read the seeded source register.");
  const canonicalSourceCount = Number((canonicalReferenceRead.rows[0] as { count?: number } | undefined)?.count ?? 0);
  if (canonicalSourceCount < 20) throw new Error("The application role could not read the canonical source register.");

  await application.execute(sql.raw(`DO $property_data_security$
  BEGIN
    BEGIN
      INSERT INTO data_sources (key, name, organisation, category, documentation_url, licence, attribution)
      VALUES ('security-test-${randomUUID()}', 'Security test', 'Surveynt', 'test', 'https://example.test', 'test', 'test');
      RAISE EXCEPTION 'reference_write_was_allowed';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END
  $property_data_security$;`));
  await application.execute(sql.raw(`DO $canonical_reference_security$
  BEGIN
    BEGIN
      UPDATE reference.data_sources SET enabled = false WHERE key = 'historic_england_nhle';
      RAISE EXCEPTION 'canonical_reference_write_was_allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END
  $canonical_reference_security$;`));

  let property = propertyRows.rows[0] as { id?: string; organisation_id?: string } | undefined;
  let fixture: { organisationId: string; clientId: string; propertyId: string; runId: string } | null = null;
  if (!property?.id || !property.organisation_id) {
    const organisationId = randomUUID();
    const clientId = randomUUID();
    const propertyId = randomUUID();
    const runId = randomUUID();
    await administrator.insert(organisations).values({ id: organisationId, clerkOrganisationId: `security-test-${organisationId}`, name: "Property security verification", slug: `security-test-${organisationId}`, practiceType: "surveying", region: "England", status: "active" });
    await administrator.insert(clients).values({ id: clientId, organisationId, kind: "individual", displayName: "Temporary security fixture" });
    await administrator.insert(properties).values({ id: propertyId, organisationId, clientId, line1: "Temporary security fixture", city: "Bristol", postcode: "BS1 1AA" });
    await administrator.insert(enrichmentRuns).values({ id: runId, organisationId, propertyId, idempotencyKey: `security-test-${runId}`, propertyVersion: 1, locationFingerprint: `security-test-${propertyId}` });
    fixture = { organisationId, clientId, propertyId, runId };
    property = { id: propertyId, organisation_id: organisationId };
  }
  let ownTenantPropertyVisible: boolean | null = null;
  let guessedTenantPropertyHidden: boolean | null = null;
  let ownTenantRunVisible: boolean | null = null;
  let guessedTenantRunHidden: boolean | null = null;
  let fixtureCleanupVerified: boolean | null = null;
  try {
    if (property?.id && property.organisation_id) {
      const runId = fixture?.runId;
      const own = await application.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_organisation_id', ${property.organisation_id}, true)`);
        const propertyResult = await tx.execute(sql`select count(*)::int as count from properties where id = ${property.id}`);
        const runResult = runId ? await tx.execute(sql`select count(*)::int as count from enrichment_runs where id = ${runId}`) : null;
        return { property: Number((propertyResult.rows[0] as { count?: number } | undefined)?.count ?? 0) === 1, run: runResult ? Number((runResult.rows[0] as { count?: number } | undefined)?.count ?? 0) === 1 : null };
      });
      const guessed = await application.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_organisation_id', ${randomUUID()}, true)`);
        const propertyResult = await tx.execute(sql`select count(*)::int as count from properties where id = ${property.id}`);
        const runResult = runId ? await tx.execute(sql`select count(*)::int as count from enrichment_runs where id = ${runId}`) : null;
        return { property: Number((propertyResult.rows[0] as { count?: number } | undefined)?.count ?? 0) === 0, run: runResult ? Number((runResult.rows[0] as { count?: number } | undefined)?.count ?? 0) === 0 : null };
      });
      ownTenantPropertyVisible = own.property;
      guessedTenantPropertyHidden = guessed.property;
      ownTenantRunVisible = own.run;
      guessedTenantRunHidden = guessed.run;
    }
  } finally {
    if (fixture) {
      await administrator.delete(enrichmentRuns).where(eq(enrichmentRuns.id, fixture.runId));
      await administrator.delete(properties).where(eq(properties.id, fixture.propertyId));
      await administrator.delete(clients).where(eq(clients.id, fixture.clientId));
      await administrator.delete(organisations).where(eq(organisations.id, fixture.organisationId));
      const cleanup = await administrator.execute(sql`select
        (select count(*) from enrichment_runs where id = ${fixture.runId})::int as runs,
        (select count(*) from properties where id = ${fixture.propertyId})::int as properties,
        (select count(*) from clients where id = ${fixture.clientId})::int as clients,
        (select count(*) from organisations where id = ${fixture.organisationId})::int as organisations`);
      const counts = cleanup.rows[0] as { runs?: number; properties?: number; clients?: number; organisations?: number } | undefined;
      fixtureCleanupVerified = Boolean(counts && Object.values(counts).every((count) => Number(count) === 0));
    }
  }

  const policyNames = policies.rows.map((row) => String((row as { policyname?: string }).policyname));
  const requiredPolicies = [
    "address_search_cache_tenant_policy",
    "enrichment_runs_tenant_policy",
    "property_intelligence_snapshots_tenant_policy",
    "data_sources_read_policy",
    "dataset_versions_read_policy",
    "dataset_syncs_read_policy",
    "os_uprn_points_read_policy",
    "spatial_reference_features_read_policy",
  ];
  const missingPolicies = requiredPolicies.filter((policy) => !policyNames.includes(policy));
  const immutableTriggerPresent = triggerRows.rows.some((row) => (row as { tgname?: string }).tgname === "property_intelligence_snapshots_immutable");
  const geocoderTablesRlsProtected = rlsRows.rows.length === 2;
  const expectedOperationsPolicies = 19;
  const operationsRlsProtected = new Set(operationsPolicies.rows.map((row) => String((row as { tablename?: string }).tablename))).size === expectedOperationsPolicies;
  if (missingPolicies.length) throw new Error(`Missing RLS policies: ${missingPolicies.join(", ")}`);
  if (!immutableTriggerPresent) throw new Error("The immutable snapshot trigger is missing.");
  if (!geocoderTablesRlsProtected) throw new Error("The geocoder cache or global rate gate is missing RLS protection.");
  if (!operationsRlsProtected) throw new Error("One or more firm-operations tables is missing its tenant policy.");
  if (ownTenantPropertyVisible !== true || guessedTenantPropertyHidden !== true) throw new Error("Tenant property isolation verification failed.");
  if (ownTenantRunVisible !== null && (ownTenantRunVisible !== true || guessedTenantRunHidden !== true)) throw new Error("Tenant enrichment-run isolation verification failed.");
  if (fixtureCleanupVerified === false) throw new Error("Temporary security fixtures were not fully removed.");

  console.log(JSON.stringify({
    sourceRegisterReadable: true,
    sourceCount,
    canonicalSourceCount,
    referenceWritesDenied: true,
    canonicalReferenceWritesDenied: true,
    ownTenantPropertyVisible,
    guessedTenantPropertyHidden,
    ownTenantRunVisible,
    guessedTenantRunHidden,
    fixtureCleanupVerified,
    requiredPoliciesPresent: true,
    geocoderTablesRlsProtected,
    operationsRlsProtected,
    immutableSnapshotTriggerPresent: true,
  }, null, 2));
}

main().catch((error) => {
  const messages: string[] = []; let current: unknown = error;
  while (current instanceof Error && messages.length < 4) { messages.push(current.message); current = current.cause; }
  console.error(messages.join("\nCaused by: ") || String(error));
  process.exitCode = 1;
});
