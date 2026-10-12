import {workspaceAudit} from "@/lib/workspace-audit";
import { workspaceApiGuard } from "@/lib/workspace-api-guard";
import { z } from "zod";
import { and,asc,eq,isNull,or,sql } from "drizzle-orm";
import { auditEvents,availabilityBlocks,calendarConflicts,calendarConnections,createDatabase,organisationMemberships,withTenant } from "@surveynt/db";
import { isManagementRole } from "@surveynt/domain";
import { apiContext,canWriteWorkspace } from "@/lib/access";
import { ok,parseBody,problem } from "@/lib/api";
const schema=z.object({startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),reason:z.string().trim().min(1).max(500),userId:z.uuid().nullable()}).refine(v=>v.startsAt<v.endsAt);
export async function GET(request: Request) {
  const c = await apiContext(request);
  if (!c) return problem(401, "unauthorised", "Sign in to view availability.");
  if (c.demo) return ok({ blocks: [], conflicts: [], connections: [] });
  return withTenant(createDatabase(), c.organisationId, async tx => {
    const manager = isManagementRole(c.role);
    const ownConnection = sql`exists (select 1 from calendar_connections connection where connection.id = ${calendarConflicts.connectionId} and connection.organisation_id = ${c.organisationId} and connection.user_id = ${c.internalUserId})`;
    const [blocks, conflicts, connections] = await Promise.all([
      tx.select().from(availabilityBlocks).where(and(eq(availabilityBlocks.organisationId, c.organisationId), manager ? undefined : or(isNull(availabilityBlocks.userId), eq(availabilityBlocks.userId, c.internalUserId!)))).orderBy(asc(availabilityBlocks.startsAt)).limit(200),
      tx.select().from(calendarConflicts).where(and(eq(calendarConflicts.organisationId, c.organisationId), eq(calendarConflicts.status, "open"), manager ? undefined : ownConnection)).limit(100),
      tx.select({ id: calendarConnections.id, provider: calendarConnections.provider, status: calendarConnections.status, lastError: calendarConnections.lastError, lastSyncedAt: calendarConnections.lastSyncedAt }).from(calendarConnections).where(and(eq(calendarConnections.organisationId, c.organisationId), eq(calendarConnections.userId, c.internalUserId!))),
    ]);
    return ok({ blocks, conflicts, connections });
  });
}
export async function POST(request:Request){const c=await apiContext(request);if(!c)return problem(401,"unauthorised","Sign in to manage availability.");const accessDenial=await workspaceApiGuard(request,c);if(accessDenial)return accessDenial;if(!canWriteWorkspace(c)||!isManagementRole(c.role))return problem(403,"forbidden","Only administrators manage practice blocks.");const p=await parseBody(request,schema);if(!p.success)return problem(400,"invalid_request","Check the blocked period.");if(c.demo)return problem(409,"preview_only","Sign in for persistent availability.");return withTenant(createDatabase(),c.organisationId,async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${c.organisationId}:scheduling`}))`);if(p.data.userId){const [m]=await tx.select().from(organisationMemberships).where(and(eq(organisationMemberships.organisationId,c.organisationId),eq(organisationMemberships.userId,p.data.userId),eq(organisationMemberships.active,true))).limit(1);if(!m)return problem(404,"member_not_found","Choose a member of this practice.");}const [row]=await tx.insert(availabilityBlocks).values({organisationId:c.organisationId,...p.data,startsAt:new Date(p.data.startsAt),endsAt:new Date(p.data.endsAt),kind:"unavailable",source:"manual"}).returning();await tx.insert(auditEvents).values(workspaceAudit(c,{organisationId:c.organisationId,actorUserId:c.internalUserId,action:"availability.created",resourceType:"availability_block",resourceId:row.id}));return ok(row);});}
export async function DELETE(request:Request){const c=await apiContext(request);if(!c)return problem(401,"unauthorised","Sign in to manage availability.");const accessDenial=await workspaceApiGuard(request,c);if(accessDenial)return accessDenial;if(!canWriteWorkspace(c)||!isManagementRole(c.role))return problem(403,"forbidden","Only administrators manage practice blocks.");const id=new URL(request.url).searchParams.get("id");if(!z.uuid().safeParse(id).success)return problem(400,"invalid_id","Choose a block.");return withTenant(createDatabase(),c.organisationId,async tx=>{const [row]=await tx.delete(availabilityBlocks).where(and(eq(availabilityBlocks.id,id!),eq(availabilityBlocks.organisationId,c.organisationId),eq(availabilityBlocks.source,"manual"))).returning();if(!row)return problem(404,"not_found","Manual block not found.");await tx.insert(auditEvents).values(workspaceAudit(c,{organisationId:c.organisationId,actorUserId:c.internalUserId,action:"availability.removed",resourceType:"availability_block",resourceId:row.id}));return ok({removed:true});});}
