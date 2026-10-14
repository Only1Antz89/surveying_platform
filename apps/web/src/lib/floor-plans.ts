import { and, asc, eq, sql } from "drizzle-orm";
import { auditEvents, createDatabase, jobs, surveyRooms, surveys, withTenant, type TenantTransaction } from "@surveynt/db";
import { workspaceAudit } from "./workspace-audit";
import { assignedJobScope } from "./workspace-scope";
import { currentProfessionalPermission } from "./professional-membership";
import { canRecordProfessionalJudgement, type SurveyContext } from "./surveys";
import type { Room, RoomInput } from "./floor-plan-model";

export class FloorPlanError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
const num = (value: string | null) => value == null ? null : Number(value);
const toRoom = (row: typeof surveyRooms.$inferSelect): Room => ({ id: row.id, floor: row.floor as Room["floor"], name: row.name, lengthM: num(row.lengthM), widthM: num(row.widthM), heightM: num(row.heightM), areaOverrideM2: num(row.areaOverrideM2), notes: row.notes, position: row.position, version: row.version });
const decimal = (value: number | null | undefined) => value == null ? null : value.toFixed(2);

async function permittedSurvey(tx: TenantTransaction, context: SurveyContext, surveyId: string, forUpdate: boolean) {
  const query = tx.select({ survey: surveys }).from(surveys).innerJoin(jobs, and(eq(jobs.id, surveys.jobId), eq(jobs.organisationId, surveys.organisationId)))
    .where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId), assignedJobScope(context))).limit(1);
  const [row] = forUpdate ? await query.for("update", { of: surveys }) : await query;
  return row?.survey ?? null;
}

export async function listRooms(context: SurveyContext, surveyId: string): Promise<Room[] | null> {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    if (!await permittedSurvey(tx, context, surveyId, false)) return null;
    const rows = await tx.select().from(surveyRooms).where(and(eq(surveyRooms.organisationId, context.organisationId), eq(surveyRooms.surveyId, surveyId))).orderBy(asc(surveyRooms.position), asc(surveyRooms.createdAt));
    return rows.map(toRoom);
  });
}

async function writable(tx: TenantTransaction, context: SurveyContext, surveyId: string) {
  if (!canRecordProfessionalJudgement(context.actorRole ?? context.role, context.canRecordSurvey)) throw new FloorPlanError(403, "recording_permission_required", "Professional survey recording permission is required.");
  if (!await currentProfessionalPermission(tx, context, "record_survey")) throw new FloorPlanError(403, "recording_permission_required", "Your recording permission has been revoked or your membership has changed.");
  const survey = await permittedSurvey(tx, context, surveyId, true);
  if (!survey) throw new FloorPlanError(404, "survey_not_found", "The survey could not be found.");
  if (survey.status !== "in_progress") throw new FloorPlanError(409, "survey_locked", "Reopen the survey before changing measurements.");
  return survey;
}

export async function addRoom(context: SurveyContext, surveyId: string, input: RoomInput) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    await writable(tx, context, surveyId);
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${surveyRooms.position}), -1)::int + 1` }).from(surveyRooms).where(and(eq(surveyRooms.organisationId, context.organisationId), eq(surveyRooms.surveyId, surveyId)));
    const [row] = await tx.insert(surveyRooms).values({ organisationId: context.organisationId, surveyId, floor: input.floor, name: input.name, lengthM: decimal(input.lengthM), widthM: decimal(input.widthM), heightM: decimal(input.heightM), areaOverrideM2: decimal(input.areaOverrideM2), notes: input.notes || null, position: next, createdByUserId: context.internalUserId }).returning();
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.room_added", resourceType: "survey", resourceId: surveyId, metadata: { roomId: row.id, floor: row.floor } }));
    return toRoom(row);
  });
}

export async function updateRoom(context: SurveyContext, surveyId: string, roomId: string, version: number, input: RoomInput) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    await writable(tx, context, surveyId);
    const [row] = await tx.update(surveyRooms).set({ floor: input.floor, name: input.name, lengthM: decimal(input.lengthM), widthM: decimal(input.widthM), heightM: decimal(input.heightM), areaOverrideM2: decimal(input.areaOverrideM2), notes: input.notes || null, version: sql`${surveyRooms.version} + 1`, updatedAt: new Date() })
      .where(and(eq(surveyRooms.organisationId, context.organisationId), eq(surveyRooms.surveyId, surveyId), eq(surveyRooms.id, roomId), eq(surveyRooms.version, version))).returning();
    if (!row) throw new FloorPlanError(409, "version_conflict", "This room changed elsewhere. Reload to see the latest measurements.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.room_updated", resourceType: "survey", resourceId: surveyId, metadata: { roomId } }));
    return toRoom(row);
  });
}

export async function removeRoom(context: SurveyContext, surveyId: string, roomId: string) {
  return withTenant(createDatabase(), context.organisationId, async (tx) => {
    await writable(tx, context, surveyId);
    const [row] = await tx.delete(surveyRooms).where(and(eq(surveyRooms.organisationId, context.organisationId), eq(surveyRooms.surveyId, surveyId), eq(surveyRooms.id, roomId))).returning({ id: surveyRooms.id });
    if (!row) throw new FloorPlanError(404, "room_not_found", "The room could not be found.");
    await tx.insert(auditEvents).values(workspaceAudit(context, { organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.room_removed", resourceType: "survey", resourceId: surveyId, metadata: { roomId } }));
    return row;
  });
}

/** Rooms for report composition, read inside an existing tenant transaction. */
export async function surveyRoomsFor(tx: TenantTransaction, organisationId: string, surveyId: string) {
  const rows = await tx.select().from(surveyRooms).where(and(eq(surveyRooms.organisationId, organisationId), eq(surveyRooms.surveyId, surveyId))).orderBy(asc(surveyRooms.position));
  return rows.map(toRoom);
}
