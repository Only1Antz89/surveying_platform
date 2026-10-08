import { describe, expect, it } from "vitest";
import { evaluateAiGate, getGovernedModel, type AiGateInput } from "./gate";

// A fully permitted configuration, then broken one condition at a time.
const allowed = (): AiGateInput => ({
  providerKey: "example-provider",
  register: [{ providerKey: "example-provider", modelId: "example-model", modelVersion: "2026-09", uses: ["field_proposals"], status: "approved" }],
  settings: { aiFeaturesEnabled: true, permittedUses: ["field_proposals"], disclosureVersion: 2 },
  riskAssessments: [{ use: "field_proposals", status: "approved", reviewDue: "2027-01-01" }],
  consent: { status: "granted", uses: ["field_proposals"], disclosureVersion: 2 },
  openIncidents: [],
  today: "2026-10-02",
});
const codes = (input: AiGateInput, use: Parameters<typeof evaluateAiGate>[1] = "field_proposals") => evaluateAiGate(input, use).reasons.map((reason) => reason.code);

describe("AI governance gate", () => {
  it("allows a use only when every condition holds", () => {
    expect(evaluateAiGate(allowed(), "field_proposals")).toMatchObject({ allowed: true, model: { modelId: "example-model" }, reasons: [] });
  });

  it("blocks by default: no provider, nothing registered, nothing enabled", () => {
    expect(codes({ providerKey: "none", register: [], settings: null, riskAssessments: [], consent: null, openIncidents: [], today: "2026-10-02" })).toEqual(["provider_none", "firm_disabled", "no_risk_assessment", "no_consent"]);
  });

  it("names each broken condition", () => {
    expect(codes({ ...allowed(), register: [{ ...allowed().register[0], status: "suspended" }] })).toEqual(["not_registered"]);
    expect(codes(allowed(), "photo_observation")).toEqual(["not_registered", "use_not_permitted", "no_risk_assessment", "consent_scope"]);
    expect(codes({ ...allowed(), riskAssessments: [{ use: "field_proposals", status: "approved", reviewDue: "2026-09-01" }] })).toEqual(["risk_review_overdue"]);
    expect(codes({ ...allowed(), consent: { status: "withdrawn", uses: [], disclosureVersion: 2 } })).toEqual(["consent_withdrawn"]);
    expect(codes({ ...allowed(), consent: { status: "granted", uses: ["field_proposals"], disclosureVersion: 1 } })).toEqual(["consent_disclosure_outdated"]);
    expect(codes({ ...allowed(), openIncidents: [{ severity: "critical", status: "investigating" }, { severity: "high", status: "open" }] })).toEqual(["open_critical_incident"]);
    expect(codes({ ...allowed(), openIncidents: [{ severity: "critical", status: "closed" }] })).toEqual([]);
  });

  it("returns an unavailable model with the reasons when blocked", async () => {
    const blocked = getGovernedModel({ AI_PROVIDER: "example-provider" }, evaluateAiGate({ ...allowed(), consent: null }, "field_proposals"));
    expect(await blocked.propose({ task: "field_proposals", template: {} as never, fieldPaths: [], evidence: [] })).toEqual({ status: "unavailable", reason: "No AI consent is recorded for this job." });
  });
});

describe("conversational governance",()=>{
 const chat=(use:"case_chat"|"business_chat"):AiGateInput=>({...allowed(),register:[{...allowed().register[0],uses:[use]}],settings:{aiFeaturesEnabled:true,permittedUses:[use],disclosureVersion:2},riskAssessments:[{use,status:"approved",reviewDue:"2027-01-01"}],consent:null});
 it("requires explicit case consent even with an approved conversation model",()=>expect(evaluateAiGate(chat("case_chat"),"case_chat").reasons.map(r=>r.code)).toContain("no_consent"));
 it("permits business conversations without inventing a client consent record",()=>expect(evaluateAiGate(chat("business_chat"),"business_chat").allowed).toBe(true));
 it("still blocks unapproved business models and overdue risk review",()=>expect(evaluateAiGate({...chat("business_chat"),register:[]},"business_chat").allowed).toBe(false));
});
