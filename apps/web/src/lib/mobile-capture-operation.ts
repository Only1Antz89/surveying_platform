import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { mobileCaptureOperations, type TenantTransaction } from "@surveynt/db";
import { canonicalJson } from "@surveynt/assistant";
import { z } from "zod";

export const mobileOperationId = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
export class MobileCaptureOperationError extends Error {
  readonly status = 409;
  readonly code = "operation_conflict";
  constructor() { super("This operation identifier was used for different capture data. Review the queued change."); }
}

/** Called after current access checks, inside the same transaction as the captured record and audit. */
export async function replayableMobileCapture<T extends object>(tx: TenantTransaction, scope: {organisationId:string;userId:string;operationId?:string;kind:"room"|"cost";resourceId:string;input:unknown}, create:()=>Promise<T>): Promise<T> {
  if (!scope.operationId) return create(); // Existing web forms intentionally create a fresh record.
  const operationId = mobileOperationId.parse(scope.operationId);
  const hash = createHash("sha256").update(canonicalJson(scope.input)).digest("hex");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${JSON.stringify([scope.organisationId,scope.userId,operationId])}))`);
  const [previous] = await tx.select().from(mobileCaptureOperations).where(and(eq(mobileCaptureOperations.organisationId,scope.organisationId),eq(mobileCaptureOperations.userId,scope.userId),eq(mobileCaptureOperations.operationId,operationId))).limit(1);
  if (previous) {
    if (previous.kind !== scope.kind || previous.resourceId !== scope.resourceId || previous.inputSha256 !== hash) throw new MobileCaptureOperationError();
    return previous.result as T;
  }
  const result = await create();
  await tx.insert(mobileCaptureOperations).values({organisationId:scope.organisationId,userId:scope.userId,operationId,kind:scope.kind,resourceId:scope.resourceId,inputSha256:hash,result:JSON.parse(JSON.stringify(result))});
  return result;
}
