import { describe, it, expect } from "vitest";
import { filterCustomers, registerQuery } from "./customer-register";
import { platformCsv } from "./platform-csv";
import { tenants } from "./demo-data";
import { reportQuery, canReadBusinessReports } from "./platform-report-query";
describe("customer register and report boundaries", () => {
  it("retains filters and sorts deterministically", () => {
    const q = registerQuery(
      new URLSearchParams("q=zz-unmatched&sort=seats&direction=desc&page=-2"),
    );
    expect(q.page).toBe(1);
    expect(filterCustomers(tenants, q)).toEqual([]);
    const sorted = filterCustomers(
      tenants,
      registerQuery(new URLSearchParams("sort=seats&direction=desc")),
    );
    expect(sorted.map((t) => t.seats)).toEqual(
      sorted.map((t) => t.seats).sort((a, b) => b - a),
    );
  });
  it("separates account state from subscription state so summary filters match their totals", () => {
    expect(
      filterCustomers(
        tenants,
        registerQuery(new URLSearchParams("status=active")),
      ),
    ).toHaveLength(tenants.filter((t) => t.subscription === "active").length);
    expect(
      filterCustomers(
        tenants,
        registerQuery(new URLSearchParams("account=suspended")),
      ),
    ).toHaveLength(tenants.filter((t) => t.status === "suspended").length);
  });
  it("escapes spreadsheet formulas, commas, quotes and newlines", () => {
    expect(platformCsv([["=cmd", "a,b", 'a"b', "a\nb"]])).toBe(
      '"\'=cmd","a,b","a""b","a\nb"',
    );
  });
  it("uses London date across the DST boundary", () => {
    const q = reportQuery(
      new URLSearchParams("period=7"),
      new Date("2026-03-29T23:30:00Z"),
    );
    expect(q.from).toBe("2026-03-24");
    expect(q.to).toBe("2026-03-30");
    expect(q.includeDemo).toBe(false);
  });
  it("rejects invalid dates, reversed ranges, excessive ranges and invalid customer ids", () => {
    for (const s of [
      "period=custom&from=2026-02-31&to=2026-03-01",
      "period=custom&from=2026-03-01&to=2026-02-01",
      "period=custom&from=2024-01-01&to=2026-01-01",
      "customer=invalid",
    ])
      expect(() => reportQuery(new URLSearchParams(s))).toThrow();
  });
  it("limits business reporting to financial operators", () => {
    expect(canReadBusinessReports("super_admin")).toBe(true);
    expect(canReadBusinessReports("billing")).toBe(true);
    expect(canReadBusinessReports("support")).toBe(false);
  });
});
