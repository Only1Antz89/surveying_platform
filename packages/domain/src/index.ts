export const organisationStatuses = ["provisioning", "active", "suspended", "closed"] as const;
export type OrganisationStatus = (typeof organisationStatuses)[number];

export const subscriptionStatuses = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

export const organisationRoles = [
  "owner",
  "administrator",
  "surveyor",
  "coordinator",
  "finance",
  "read_only",
] as const;
export type OrganisationRole = (typeof organisationRoles)[number];

export const platformRoles = ["super_admin", "support", "billing", "compliance"] as const;
export type PlatformRole = (typeof platformRoles)[number];

export const jobStages = [
  "enquiry",
  "quoted",
  "instructed",
  "scheduled",
  "inspection_complete",
  "report_drafting",
  "internal_review",
  "issued",
  "paid",
  "archived",
] as const;
export type JobStage = (typeof jobStages)[number];

export const roleLabels: Record<OrganisationRole, string> = {
  owner: "Owner",
  administrator: "Administrator",
  surveyor: "Surveyor",
  coordinator: "Coordinator",
  finance: "Finance",
  read_only: "Read only",
};

export const jobStageLabels: Record<JobStage, string> = {
  enquiry: "Enquiry",
  quoted: "Quoted",
  instructed: "Instructed",
  scheduled: "Scheduled",
  inspection_complete: "Inspection complete",
  report_drafting: "Report drafting",
  internal_review: "Internal review",
  issued: "Issued",
  paid: "Paid",
  archived: "Archived",
};

export function canMutateOperations(role: OrganisationRole) {
  return role === "owner" || role === "administrator" || role === "surveyor" || role === "coordinator";
}

export function canManageTeam(role: OrganisationRole) {
  return role === "owner" || role === "administrator";
}

const stageTransitions: Record<JobStage, readonly JobStage[]> = {
  enquiry: ["quoted", "archived"],
  quoted: ["instructed", "archived"],
  instructed: ["scheduled", "archived"],
  scheduled: ["inspection_complete", "archived"],
  inspection_complete: ["report_drafting"],
  report_drafting: ["internal_review"],
  internal_review: ["report_drafting", "issued"],
  issued: ["paid"],
  paid: ["archived"],
  archived: [],
};

export function canTransitionJob(from: JobStage, to: JobStage) {
  return stageTransitions[from].includes(to);
}

export type AccessLevel = "full" | "billing_only" | "read_only" | "blocked";

export function resolveAccess(
  organisation: OrganisationStatus,
  subscription: SubscriptionStatus,
  graceEndsAt?: Date | null,
  now = new Date(),
): AccessLevel {
  if (organisation === "suspended" || organisation === "closed") return "blocked";
  if (organisation === "provisioning" || subscription === "incomplete") return "billing_only";
  if (subscription === "trialing" || subscription === "active") return "full";
  if (subscription === "past_due") {
    return graceEndsAt && graceEndsAt > now ? "full" : "read_only";
  }
  return "billing_only";
}
