import { describe, expect, it } from "vitest";
import { emailTemplatesSchema, fillQuoteTemplate } from "./email-template-settings";
import { renderEmail } from "./email";

const payload = {recipients:["customer@example.test"],organisationName:"Example & <Practice>",customerName:"Alex {{total}}",quoteReference:"QUO-123",total:"£450.00",expiresAt:"2026-10-08T00:00:00Z",quoteUrl:"https://example.test/quote"};
describe("reviewed quote email templates",()=>{
  it("rejects unknown variables, header newlines, oversized text and unsupported email types",()=>{
    for (const template of [{subject:"{{secret}}",introduction:"Hello"},{subject:"Subject\nBcc: someone",introduction:"Hello"},{subject:"Subject",introduction:"a".repeat(1501)}]) expect(emailTemplatesSchema.safeParse({customer_quote_issued:template}).success).toBe(false);
    expect(emailTemplatesSchema.safeParse({payment_issue_notice:{subject:"Change",introduction:"Changed"}}).success).toBe(false);
  });
  it("substitutes once, escapes HTML and retains quote facts and secure link",()=>{
    const message=renderEmail("customer_quote_issued",payload,{customer_quote_issued:{subject:"Quote {{quoteReference}} from {{organisationName}}",introduction:"Hello {{customerName}} <welcome>"}});
    expect(message.subject).toContain("QUO-123");expect(message.text).toContain("Alex {{total}}");
    expect(message.html).toContain("&lt;welcome&gt;");expect(message.html).not.toContain("<welcome>");
    expect(message.text).toContain("Total including VAT: £450.00");expect(message.text).toContain("Quote valid until:");expect(message.text).toContain(payload.quoteUrl);
  });
  it("restores the default and keeps platform notices unchanged",()=>{
    expect(renderEmail("customer_quote_issued",payload,{}).subject).toBe("Your survey quote · QUO-123");
    expect(fillQuoteTemplate("{{customerName}}",payload)).toBe("Alex {{total}}");
    const billing={recipients:payload.recipients,organisationName:payload.organisationName,status:"past_due",graceEndsAt:null,billingUrl:"https://example.test/billing"};
    expect(renderEmail("payment_issue_notice",billing,{customer_quote_issued:{subject:"Custom",introduction:"Custom"}})).toEqual(renderEmail("payment_issue_notice",billing));
  });
});
