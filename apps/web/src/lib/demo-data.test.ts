import { describe, expect, it } from "vitest";
import { clients, jobs, tenants } from "./demo-data";

describe("demonstration workspace", () => {
  it("uses stable unique record identifiers", () => {
    const ids = [...clients, ...jobs, ...tenants].map((record) => record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains each billing state needed by platform operations", () => {
    const states = new Set(tenants.map((tenant) => tenant.subscription));
    expect(states).toEqual(expect.objectContaining(new Set(["trialing", "active", "past_due", "incomplete", "unpaid"])));
  });

  it("never uses negative fees", () => {
    expect(jobs.every((job) => job.fee >= 0)).toBe(true);
  });
});
