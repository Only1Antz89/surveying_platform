import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { defaultTemplates, fillTemplate, templateInput, unknownTokens } from "./client-messages-model";
import { renderEmail } from "./email";
import { accountingColumns, accountingRows, toCsv } from "./accounting-export";

describe("client message templates", () => {
  it("fills known placeholders, blanks unknown ones and flags them for the editor", () => {
    expect(fillTemplate("Dear {clientName}, see you on {appointmentDate}. {mystery}", { clientName: "Alex", appointmentDate: "Thursday" })).toBe("Dear Alex, see you on Thursday.");
    expect(unknownTokens("Hi {clientName} {mystery} {mystery}")).toEqual(["mystery"]);
    expect(unknownTokens(Object.values(defaultTemplates).map((item) => `${item.subject} ${item.body} ${item.sms}`).join(" "))).toEqual([]);
  });
  it("requires an email subject and keeps text messages short", () => {
    expect(templateInput.safeParse({ key: "on_the_way", channel: "email", subject: "", body: "On the way now to the property.", enabled: true }).success).toBe(false);
    expect(templateInput.safeParse({ key: "on_the_way", channel: "sms", body: "x".repeat(481), enabled: false }).success).toBe(false);
    expect(templateInput.safeParse({ key: "on_the_way", channel: "sms", body: "On the way to the property now.", enabled: false }).success).toBe(true);
  });
  it("renders a practice message email with escaped content and an optional action", () => {
    const email = renderEmail("client_message", { recipients: ["client@example.test"], organisationName: "Docs <Surveyors>", subject: "Your visit\ntomorrow", body: "Dear Alex,\n\nWe will arrive at <b>10:00</b>.", actionLabel: "Leave a review", actionUrl: "https://example.com/review" });
    expect(email.subject).toBe("Your visit tomorrow");
    expect(email.html).toContain("&lt;b&gt;10:00&lt;/b&gt;");
    expect(email.html).toContain("https://example.com/review");
    expect(email.text).toContain("Leave a review: https://example.com/review");
  });
});

describe("accounting export layouts", () => {
  const line = { contact: "=Alex Morgan", email: "alex@example.test", number: "INV-0001", reference: "SVY-1", issuedAt: new Date("2026-10-01T10:00:00Z"), dueAt: new Date("2026-10-15T10:00:00Z"), description: "Level 2 survey", quantity: 1, unitAmountMinor: 75000, vatBasisPoints: 2000, currency: "GBP" };
  it("maps invoices to Xero and QuickBooks columns with VAT codes and UK dates", () => {
    expect(accountingRows([line], "xero")[0]).toEqual(["=Alex Morgan", "alex@example.test", "INV-0001", "SVY-1", "01/10/2026", "15/10/2026", "Level 2 survey", 1, "750.00", "200", "20% (VAT on Income)", "GBP"]);
    expect(accountingRows([{ ...line, vatBasisPoints: 0, quantity: 2 }], "quickbooks")[0]).toEqual(["INV-0001", "=Alex Morgan", "01/10/2026", "15/10/2026", "Survey services", "Level 2 survey", 2, "750.00", "1500.00", "0.0% Z", "GBP"]);
  });
  it("neutralises spreadsheet formulas in the CSV", () => {
    const csv = toCsv(accountingColumns.xero, accountingRows([line], "xero"));
    expect(csv.split("\r\n")[1]).toContain(`"'=Alex Morgan"`);
  });
});
