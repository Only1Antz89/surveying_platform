import { neon } from "@neondatabase/serverless";

type QueryClient = ReturnType<typeof neon>;

async function inspectRole(client: QueryClient) {
  const role = await client.query("select current_user as role, current_setting('server_version') as server_version", []);
  const extension = await client.query("select default_version, installed_version from pg_available_extensions where name = 'postgis'", []);
  const objects = await client.query("select to_regclass('public.properties') as properties, to_regclass('public.enrichment_runs') as enrichment_runs, to_regclass('public.os_uprn_points') as os_uprn_points", []);
  const installed = Boolean(extension[0]?.installed_version);
  const runtimeAccess = installed
    ? await client.query("select has_function_privilege(current_user, 'st_makepoint(double precision,double precision)', 'EXECUTE') as can_make_point", [])
    : [];

  return {
    role: String(role[0]?.role ?? "unknown"),
    serverVersion: String(role[0]?.server_version ?? "unknown"),
    postgisAvailable: extension.length === 1,
    postgisInstalled: installed,
    postgisDefaultVersion: extension[0]?.default_version ? String(extension[0].default_version) : null,
    canExecuteSpatialFunctions: installed ? runtimeAccess[0]?.can_make_point === true : false,
    propertyTablePresent: Boolean(objects[0]?.properties),
    intelligenceTablesPresent: Boolean(objects[0]?.enrichment_runs && objects[0]?.os_uprn_points),
  };
}

async function main() {
  if (!process.env.DATABASE_APP_URL || !process.env.DATABASE_ADMIN_URL) {
    throw new Error("DATABASE_APP_URL and DATABASE_ADMIN_URL are both required for this read-only capability check.");
  }

  const [application, administrator] = await Promise.all([
    inspectRole(neon(process.env.DATABASE_APP_URL)),
    inspectRole(neon(process.env.DATABASE_ADMIN_URL)),
  ]);

  console.log(JSON.stringify({
    application: { ...application, role: "application-role" },
    administrator: { ...administrator, role: "administrator-role" },
    separateRoles: application.role !== administrator.role,
    safeToPrepareMigration: administrator.postgisAvailable,
    migrationAlreadyApplied: application.intelligenceTablesPresent,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
