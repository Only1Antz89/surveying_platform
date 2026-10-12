import {workspaceAudit} from "@/lib/workspace-audit";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { isManagementRole } from "@surveynt/domain";
import { auditEvents, createDatabase, organisationOperationalSettings, withTenant } from "@surveynt/db";
import { eq } from "drizzle-orm";
import { apiContext, canWriteWorkspace } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";

import { canConfigureClientPayments } from "@/lib/integration-access";
const schema = z.object({ section:z.enum(["office","hours","booking","notifications","public"]).optional(), timezone: z.string().max(80).default("Europe/London"), officeAddress: z.string().trim().max(500).nullable().optional(), officeLatitude: z.number().min(-90).max(90).nullable().optional(), officeLongitude: z.number().min(-180).max(180).nullable().optional(), workingDays: z.array(z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"])).min(1), workingHours: z.record(z.string(), z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })), holidayDates: z.array(z.iso.date()).max(366), customerBranding: z.object({ displayName: z.string().trim().max(120).optional(), logoUrl: z.url().optional(), accentColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }), notificationPreferences: z.record(z.string(), z.boolean()), bookingHorizonDays: z.number().int().min(1).max(365), travelBufferMinutes: z.number().int().min(0).max(240), mileageRatePence: z.number().int().min(0).max(1000), documentRetentionDays: z.number().int().min(30).max(36500), publicQuotesEnabled: z.boolean(), clientPaymentsEnabled: z.boolean() }).refine((value) => (value.officeLatitude == null) === (value.officeLongitude == null), { message: "Office coordinates must be provided together." });

export async function GET(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (context.demo) return ok({ timezone: "Europe/London", workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"], workingHours: {}, holidayDates: [], customerBranding: {}, notificationPreferences: {}, bookingHorizonDays: 90, travelBufferMinutes: 30, mileageRatePence: 45, documentRetentionDays: 2555, publicQuotesEnabled: false, clientPaymentsEnabled: false }, { demo: true });
  const rows = await withTenant(createDatabase(), context.organisationId, (tx) => tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).limit(1));
  return ok(rows[0] ?? null);
}

export async function PATCH(request: Request) {
  const context = await apiContext(request); if (!context) return problem(401, "unauthorised", "Authentication is required.");
  const accessDenial = await workspaceApiGuard(request, context);
  if (accessDenial) return accessDenial;
  if (!canWriteWorkspace(context)) return problem(402, "workspace_read_only", "Restore billing before changing settings.");
  if (!isManagementRole(context.role)) return problem(403, "forbidden", "Only owners and administrators can change operational settings.");
  const parsed = await parseBody(request, schema); if (!parsed.success) return problem(400, "invalid_request", "The settings are invalid.", parsed.error.flatten());
  try { new Intl.DateTimeFormat("en-GB", { timeZone: parsed.data.timezone }).format(); } catch { return problem(400, "invalid_timezone", "Enter a recognised timezone such as Europe/London."); }
  if(Object.values(parsed.data.workingHours).some(hours=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.end)||hours.start>=hours.end))return problem(400,"invalid_hours","Opening and closing times must be valid, with closing after opening.");
  if ((!parsed.data.section||parsed.data.section==="public") && parsed.data.clientPaymentsEnabled && process.env.CLIENT_PAYMENTS_LAUNCH_APPROVED !== "true") return problem(409, "launch_approval_required", "Legal, accounting, VAT, refund and client-money approval is required before enabling client payments.");
  if (context.demo) return ok(parsed.data, { demo: true, persisted: false });
  const saved = await withTenant(createDatabase(), context.organisationId, async (tx) => {
    if ((!parsed.data.section||parsed.data.section==="public") && !canConfigureClientPayments(context.role)) {
      const [current] = await tx.select({enabled:organisationOperationalSettings.clientPaymentsEnabled}).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).limit(1);
      if(parsed.data.clientPaymentsEnabled!==(current?.enabled??false))return null;
    }
    const {clientPaymentsEnabled,section, ...operational} = parsed.data;
    const fields:Record<string,string[]>={office:["officeAddress","officeLatitude","officeLongitude","mileageRatePence","travelBufferMinutes"],hours:["timezone","workingHours","customerBranding"],booking:["workingDays","bookingHorizonDays","holidayDates"],notifications:["notificationPreferences"],public:["publicQuotesEnabled","clientPaymentsEnabled"]};
    const all = canConfigureClientPayments(context.role) ? {...operational,clientPaymentsEnabled} : operational;
    const subset=section?Object.fromEntries(Object.entries(all).filter(([key])=>fields[section].includes(key))):all;
    const permittedSettings = subset;
    const [row] = await tx.insert(organisationOperationalSettings).values({ organisationId: context.organisationId, ...permittedSettings }).onConflictDoUpdate({ target: organisationOperationalSettings.organisationId, set: { ...permittedSettings, updatedAt: new Date() } }).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context,{ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "operations.settings_updated", resourceType: "organisation", resourceId: context.organisationId, metadata: { publicQuotesEnabled: row.publicQuotesEnabled, clientPaymentsEnabled: row.clientPaymentsEnabled, notificationPreferences: row.notificationPreferences } }));
    return row;
  });
  if(!saved)return problem(403,"forbidden","Only practice owners and administrators can configure client payments.");
  return ok(saved);
}
