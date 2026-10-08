import { hasProfessionalPermission, type OrganisationRole } from "@surveynt/domain";
import { problem } from "./api";

export type ProfessionalAccess = { role: OrganisationRole; canRecordSurvey?: boolean; canApproveReports?: boolean };
export const canRecord = (context: ProfessionalAccess) => hasProfessionalPermission(context.role, "record_survey", context.canRecordSurvey);
export const canApprove = (context: ProfessionalAccess) => hasProfessionalPermission(context.role, "approve_reports", context.canApproveReports);

/** Applied before demo shortcuts as well as live mutations. Roles alone never grant management judgement rights. */
export function professionalApiGuard(request: Request, context: ProfessionalAccess) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const path = new URL(request.url).pathname;
  const approval = /\/surveys\/[^/]+\/(?:reopen|report\/[^/]+\/approve)$/.test(path);
  const recording = /\/surveys\//.test(path) || /\/jobs\/[^/]+\/survey$/.test(path) || /\/properties\/[^/]+\/identity\/confirm$/.test(path);
  if (approval && !canApprove(context)) return problem(403, "professional_approval_required", "An owner must grant report approval permission before you can approve, issue or reopen a survey report.");
  if (!approval && recording && !canRecord(context)) return problem(403, "professional_recording_required", "An owner must grant professional survey recording permission before you can change surveying information.");
  return null;
}
