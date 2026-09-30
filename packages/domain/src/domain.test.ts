import { describe, expect, it } from "vitest";
import { canApproveSupportAccess, canManageBilling, canManageTeam, canManageTenants, canMutateOperations, canTransitionJob, membershipChangeBlocker, resolveAccess } from "./index";

describe("job transitions", () => {
  it("allows the normal instructed to scheduled transition", () => {
    expect(canTransitionJob("instructed", "scheduled")).toBe(true);
  });

  it("prevents bypassing professional review", () => {
    expect(canTransitionJob("report_drafting", "issued")).toBe(false);
  });
});

describe("access policy", () => {
  it("lets an active firm work", () => {
    expect(resolveAccess("active", "active")).toBe("full");
  });

  it("lets a platform suspension override healthy billing", () => {
    expect(resolveAccess("suspended", "active")).toBe("blocked");
  });

  it("reduces expired past-due accounts to read only", () => {
    expect(resolveAccess("active", "past_due", new Date("2026-01-01"), new Date("2026-01-08"))).toBe("read_only");
  });
});

describe("firm permissions", () => {
  it("allows operational roles to create and update records", () => {
    expect(canMutateOperations("owner")).toBe(true);
    expect(canMutateOperations("administrator")).toBe(true);
    expect(canMutateOperations("surveyor")).toBe(true);
    expect(canMutateOperations("coordinator")).toBe(true);
  });

  it("keeps finance and read-only roles from mutating operations", () => {
    expect(canMutateOperations("finance")).toBe(false);
    expect(canMutateOperations("read_only")).toBe(false);
  });

  it("limits team management to owners and administrators", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("administrator")).toBe(true);
    expect(canManageTeam("surveyor")).toBe(false);
    expect(canManageTeam("coordinator")).toBe(false);
    expect(canManageTeam("finance")).toBe(false);
    expect(canManageTeam("read_only")).toBe(false);
  });

  it("allows owners, administrators and finance to manage billing", () => {
    expect(canManageBilling("owner")).toBe(true);
    expect(canManageBilling("administrator")).toBe(true);
    expect(canManageBilling("finance")).toBe(true);
    expect(canManageBilling("surveyor")).toBe(false);
    expect(canManageBilling("coordinator")).toBe(false);
    expect(canManageBilling("read_only")).toBe(false);
  });

  it("reserves support write approval for tenant owners", () => {
    expect(canApproveSupportAccess("owner")).toBe(true);
    expect(canApproveSupportAccess("administrator")).toBe(false);
    expect(canApproveSupportAccess("surveyor")).toBe(false);
  });

  it("limits tenant lifecycle controls to super administrators", () => {
    expect(canManageTenants("super_admin")).toBe(true);
    expect(canManageTenants("support")).toBe(false);
    expect(canManageTenants("billing")).toBe(false);
    expect(canManageTenants("compliance")).toBe(false);
  });

  it("protects owner membership changes", () => {
    expect(membershipChangeBlocker("administrator", "owner", "surveyor", 2)).toBe("owner_permission");
    expect(membershipChangeBlocker("owner", "owner", "administrator", 1)).toBe("final_owner");
    expect(membershipChangeBlocker("owner", "owner", "administrator", 2)).toBeNull();
    expect(membershipChangeBlocker("administrator", "surveyor", "coordinator", 1)).toBeNull();
  });
});
