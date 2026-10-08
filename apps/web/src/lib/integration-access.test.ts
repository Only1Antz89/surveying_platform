import { describe, expect, it } from "vitest";
import { canManagePlatformIntegrations, canConfigureClientPayments, firmCapabilityVisible } from "./integration-access";
describe("integration ownership", () => {
  it("restricts platform provisioning to Surveynt administrators", () => {
    for (const role of ["owner", "administrator", "manager", "surveyor", "finance", "support", "compliance"]) expect(canManagePlatformIntegrations(role)).toBe(false);
    expect(canManagePlatformIntegrations("super_admin")).toBe(true);
  });
  it("separates firm payment activation from professional and managerial roles", () => {
    expect(canConfigureClientPayments("owner")).toBe(true);
    expect(canConfigureClientPayments("administrator")).toBe(true);
    for (const role of ["manager", "surveyor", "finance", "coordinator", "read_only"]) expect(canConfigureClientPayments(role)).toBe(false);
  });
  it("makes personal calendars available to every membership without exposing provisioning", () => {
    for (const role of ["owner", "administrator", "manager", "surveyor", "finance", "coordinator", "read_only"]) {
      expect(firmCapabilityVisible(role, "google")).toBe(true);
      expect(firmCapabilityVisible(role, "microsoft")).toBe(true);
      for (const key of ["hmlr", "epc", "routing"]) expect(firmCapabilityVisible(role, key)).toBe(false);
    }
  });
});
