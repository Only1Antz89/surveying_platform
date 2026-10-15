import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { platformErrorEvents } from "@surveynt/db";
import { createTestDatabase, integrationEnabled, stopRelay, type TestDatabase } from "@surveynt/db/testing";
vi.mock("server-only",()=>({}));
import { listServerErrors, recordServerError, withheldErrorMessage } from "../src/lib/error-reporting";
let database:TestDatabase;
beforeAll(async()=>{
 if(!integrationEnabled)return;
 database=await createTestDatabase();
 vi.stubEnv("DATABASE_ADMIN_URL",database.adminUrl);
},120000);
afterAll(async()=>{vi.unstubAllEnvs();await database?.drop();await stopRelay();});
it.skipIf(!integrationEnabled)("persists safe diagnostics, shields legacy rows and removes their old exception data",async()=>{
 const db=database.connect(database.adminUrl);
 await recordServerError(Object.assign(new Error("Robin Example SQL params AQ.SyntheticCredential"),{digest:"private"}),{path:"/clients/Robin",method:"GET"},{routePath:"/api/clients/[id]",routeType:"route"});
 const [stored]=await db.select().from(platformErrorEvents);
 expect(stored).toMatchObject({message:withheldErrorMessage,digest:null,routePath:"/api/clients/[id]"});
 expect(JSON.stringify(stored)).not.toMatch(/Robin|SyntheticCredential|private/);
 await db.insert(platformErrorEvents).values({fingerprint:"legacy",errorName:"Robin",message:"private SQL params",digest:"AQ.SyntheticCredential",routePath:"/clients/Robin",method:"GET",routeType:"route"});
 expect(JSON.stringify(await listServerErrors())).not.toMatch(/Robin|SyntheticCredential|private SQL/);
 const migration=await readFile(new URL("../../../packages/db/migrations/generated/0084_mobile_capture_retries.sql",import.meta.url),"utf8");
 const cleanup=migration.split("--> statement-breakpoint").at(-1)!;
 await db.execute(sql.raw(cleanup));
 expect((await db.select().from(platformErrorEvents).where(eq(platformErrorEvents.fingerprint,"legacy")))[0]).toMatchObject({message:withheldErrorMessage,errorName:"Error",digest:null,routePath:"[legacy]"});
});
