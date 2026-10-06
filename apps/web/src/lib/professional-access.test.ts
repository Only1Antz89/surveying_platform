import { describe, expect, it, vi } from "vitest";
import { hasProfessionalPermission, organisationRoles } from "@surveynt/domain";
import { professionalApiGuard } from "./professional-access";
import { workspaceApiGuard } from "./workspace-api-guard";
vi.mock("./workspace-scope", () => ({ canAccessAssignedResource: vi.fn(async () => false) }));

describe("professional permissions", () => {
  it.each(["owner", "administrator", "manager"] as const)("%s has no implicit professional rights", role => {
    expect(hasProfessionalPermission(role, "record_survey")).toBe(false);
    expect(hasProfessionalPermission(role, "approve_reports")).toBe(false);
    expect(hasProfessionalPermission(role, "record_survey", true)).toBe(true);
    expect(hasProfessionalPermission(role, "approve_reports", true)).toBe(true);
  });
  it("surveyors inherit recording, never approval", () => {
    expect(hasProfessionalPermission("surveyor", "record_survey")).toBe(true);
    expect(hasProfessionalPermission("surveyor", "approve_reports")).toBe(false);
  });
  it.each(["finance", "coordinator", "read_only"] as const)("%s cannot gain professional access from a stale flag", role => {
    expect(hasProfessionalPermission(role, "record_survey", true)).toBe(false);
    expect(hasProfessionalPermission(role, "approve_reports", true)).toBe(false);
  });
  it("approval and capture remain independent", () => {
    const approveOnly = { role: "manager" as const, canApproveReports: true, canRecordSurvey: false };
    expect(professionalApiGuard(new Request("https://example.test/api/v1/surveys/id/sync", { method: "POST" }), approveOnly)?.status).toBe(403);
    expect(professionalApiGuard(new Request("https://example.test/api/v1/surveys/id/report/version/approve", { method: "POST" }), approveOnly)).toBeNull();
    expect(professionalApiGuard(new Request("https://example.test/api/v1/surveys/id/report/version/approve", { method: "POST" }), { role: "owner", canRecordSurvey: true })?.status).toBe(403);
  });
  it.each(["surveys/id/sync", "surveys/id/media", "surveys/id/proposals/proposal", "jobs/id/survey", "properties/id/identity/confirm"])("gates %s before demo shortcuts", path => {
    expect(professionalApiGuard(new Request(`https://example.test/api/v1/${path}`, { method: "POST" }), { role: "owner" })?.status).toBe(403);
  });
  it("allows read-only survey access without management judgement", () => {
    expect(professionalApiGuard(new Request("https://example.test/api/v1/surveys/id"), { role: "owner" })).toBeNull();
  });
});

describe("workspace role boundaries", () => {
  const context = { organisationId: "org", internalUserId: "user", role: "surveyor" as const };
  it.each(["finance/invoices", "insights", "operations/settings", "quotes", "service-catalogue", "team"])("surveyor cannot access %s", async path => {
    expect((await workspaceApiGuard(new Request(`https://example.test/api/v1/${path}`), context))?.status).toBe(403);
  });
  it("guessed survey IDs cannot bypass assignment", async () => {
    expect((await workspaceApiGuard(new Request("https://example.test/api/v1/surveys/other-surveyor-id"), context))?.status).toBe(404);
  });
  it("finance has no operational or insights access", async () => {
    for (const path of ["jobs", "clients", "surveys/id", "insights", "operations/settings"]) expect((await workspaceApiGuard(new Request(`https://example.test/api/v1/${path}`), { ...context, role: "finance" }))?.status).toBe(403);
    expect(await workspaceApiGuard(new Request("https://example.test/api/v1/finance/invoices"), { ...context, role: "finance" })).toBeNull();
  });
  it("manager is a distinct role, not staff administrator", async () => {
    expect(organisationRoles).toContain("manager");
    expect((await workspaceApiGuard(new Request("https://example.test/api/v1/team"), { ...context, role: "manager" }))?.status).toBe(403);
    expect(await workspaceApiGuard(new Request("https://example.test/api/v1/operations/settings"), { ...context, role: "manager" })).toBeNull();
  });
});
