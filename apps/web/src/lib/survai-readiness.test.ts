import { describe, expect, it } from "vitest";
import { survaiReadiness, type SurvaiReadinessInput } from "./survai-readiness";

const complete: SurvaiReadinessInput = {
  connection: { providerKey: "gemini", modelId: "gemini-2.5-flash" },
  register: [{ providerKey: "gemini", modelId: "gemini-2.5-flash", uses: ["business_chat", "case_chat"], status: "approved" }],
  settings: { aiFeaturesEnabled: true, permittedUses: ["business_chat", "case_chat"], disclosureText: "SurvAI helps our surveyors; a surveyor reviews every output." },
  riskAssessments: [{ use: "business_chat", status: "approved", reviewDue: "2027-01-01" }, { use: "case_chat", status: "approved", reviewDue: null }],
  openIncidents: [],
  today: "2026-10-15",
};

describe("survaiReadiness", () => {
  it("is ready once every sign-off is recorded, with client consent still per case", () => {
    const result = survaiReadiness(complete);
    expect(result).toMatchObject({ businessReady: true, caseReady: true });
    expect(result.steps.find((step) => step.key === "case_consent")).toMatchObject({ owner: "client", done: false });
  });

  it("stays off with nothing configured and names who owns each step", () => {
    const result = survaiReadiness({ connection: null, register: [], settings: null, riskAssessments: [], openIncidents: [], today: "2026-10-15" });
    expect(result.businessReady).toBe(false);
    expect(result.steps.filter((step) => !step.done).map((step) => step.owner)).toEqual(expect.arrayContaining(["platform", "practice", "client"]));
  });

  it("keeps business chat ready when only the case-chat assessment is missing", () => {
    const result = survaiReadiness({ ...complete, riskAssessments: [complete.riskAssessments[0]] });
    expect(result).toMatchObject({ businessReady: true, caseReady: false });
  });

  it("blocks on an overdue review, an unapproved model or a critical incident", () => {
    expect(survaiReadiness({ ...complete, riskAssessments: complete.riskAssessments.map((item) => ({ ...item, reviewDue: "2026-01-01" })) }).businessReady).toBe(false);
    expect(survaiReadiness({ ...complete, register: [{ ...complete.register[0], status: "proposed" }] }).businessReady).toBe(false);
    expect(survaiReadiness({ ...complete, register: [{ ...complete.register[0], modelId: "other" }] }).businessReady).toBe(false);
    expect(survaiReadiness({ ...complete, openIncidents: [{ severity: "critical", status: "open" }] }).businessReady).toBe(false);
  });
});
