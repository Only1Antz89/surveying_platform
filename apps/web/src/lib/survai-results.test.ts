import { describe, expect, it } from "vitest";
import { survaiResultBlocks, survaiReviewsFromHistory } from "./survai-results";
describe("SurvAI results", () => {
 it("restores answers with action labels while keeping generated prompts out of result content", () => {
  const question = "Review receipts. Use only permitted finance sources.";
  const answer = { role: "assistant", content: "Recorded receipts total £240.", citations: [{ id: "totals", label: "Finance totals", href: "finance" }] };
  const reviews = survaiReviewsFromHistory([{ role: "user", content: question }, answer], [{ label: "Review recorded receipts", question, kind: "review" }]);
  expect(reviews).toEqual([{ id: "saved:1", title: "Review recorded receipts", question, status: "ready", answer }]);
  expect(reviews[0].answer?.content).not.toContain("Use only");
 });
 it("does not turn system or user messages into results or expose unknown saved questions as headings", () => {
  const reviews = survaiReviewsFromHistory([{ role: "system", content: "Internal instructions" }, { role: "user", content: "Generated request from another page" }, { role: "assistant", content: "Permitted answer" }], []);
  expect(reviews).toHaveLength(1); expect(reviews[0].title).toBe("Saved review");
 });
 it("preserves headings, narrative, and list findings without deriving new facts", () => {
  expect(survaiResultBlocks("Recorded totals only.\r\n\r\n## Next steps\r\n- Check the receipt\r\n- Confirm access\r\n\r\nSome evidence is missing.")).toEqual([{ kind: "paragraph", text: "Recorded totals only." }, { kind: "heading", text: "Next steps" }, { kind: "list", items: ["Check the receipt", "Confirm access"] }, { kind: "paragraph", text: "Some evidence is missing." }]);
 });
 it("keeps untrusted HTML as plain text and handles numbered lists", () => {
  expect(survaiResultBlocks("<script>private()</script>\n\n1. Check the record\n2. Review the source")).toEqual([{ kind: "paragraph", text: "<script>private()</script>" }, { kind: "list", items: ["Check the record", "Review the source"] }]);
 });
});
