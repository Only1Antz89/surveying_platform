import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideWebProposal, privateNamesFrom, sanitiseWebQuery, verifyProposal } from "./survai-web-router";

describe("SurvAI web decision maker", () => {
  beforeEach(() => vi.stubEnv("SURVAI_WEB_PROPOSAL_SECRET", "test-proposal-secret"));
  afterEach(() => vi.unstubAllEnvs());
  const base = { enabled: true, question: "What are the current Part L requirements for replacement windows?", page: "survey", sources: [{ data: { client: "Elizabeth Harrington", address: "18 Royal York Crescent" } }], organisationId: "org-1", userId: "user-1" };

  it("offers nothing when the records answered, the feature is off, or the page is private", () => {
    expect(decideWebProposal({ ...base, coverage: "answered" })).toBeNull();
    expect(decideWebProposal({ ...base, coverage: "not_in_records", enabled: false })).toBeNull();
    expect(decideWebProposal({ ...base, coverage: "not_in_records", page: "finance" })).toBeNull();
  });
  it("offers a signed, expiring proposal when records fall short", () => {
    const proposal = decideWebProposal({ ...base, coverage: "not_in_records", suggestedQuery: "Approved Document L replacement windows U-value England 2026" })!;
    expect(proposal.query).toBe("Approved Document L replacement windows U-value England 2026");
    expect(proposal.reason).toContain("do not answer");
    expect(verifyProposal(proposal.token, { organisationId: "org-1", userId: "user-1" })).toBe(proposal.query);
  });
  it("strips client names, emails and phone numbers from the query", () => {
    const names = privateNamesFrom(base.sources);
    expect(sanitiseWebQuery("Planning history for Elizabeth Harrington at 18 Royal York Crescent Bristol, call 07700 900124 or liz@example.com", names)).toBe("Planning history for at 18 Royal York Crescent Bristol, call or");
    expect(sanitiseWebQuery("Elizabeth Harrington", names)).toBeNull();
  });
  it("rejects tampered, foreign or expired proposals", () => {
    const proposal = decideWebProposal({ ...base, coverage: "partial", now: Date.now() })!;
    const [body] = proposal.token.split(".");
    expect(verifyProposal(`${body}.forged`, { organisationId: "org-1", userId: "user-1" })).toBeNull();
    expect(verifyProposal(proposal.token, { organisationId: "org-2", userId: "user-1" })).toBeNull();
    expect(verifyProposal(proposal.token, { organisationId: "org-1", userId: "user-2" })).toBeNull();
    expect(verifyProposal(proposal.token, { organisationId: "org-1", userId: "user-1" }, Date.now() + 11 * 60_000)).toBeNull();
  });
  it("cannot sign without a secret", () => {
    vi.stubEnv("SURVAI_WEB_PROPOSAL_SECRET", ""); vi.stubEnv("SURVEYNT_CONNECTION_SECRET_GEMINI", "");
    expect(decideWebProposal({ ...base, coverage: "not_in_records" })).toBeNull();
  });
});
