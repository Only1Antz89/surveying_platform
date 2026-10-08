import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDeliveryError, renderEmail, sendEmail } from "./email";
import { trialDaysRemaining } from "./email-queue";

const originalKey = process.env.SMTP2GO_API_KEY;
const originalSender = process.env.SMTP2GO_SENDER;

afterEach(() => {
  process.env.SMTP2GO_API_KEY = originalKey;
  process.env.SMTP2GO_SENDER = originalSender;
});

describe("scheduled email dates", () => {
  it("uses UTC calendar days rather than partial 24-hour windows", () => {
    expect(trialDaysRemaining(new Date("2026-10-08T00:05:00.000Z"), new Date("2026-10-01T23:55:00.000Z"))).toBe(7);
  });
});

describe("email templates", () => {
  it("renders trial reminders with plain-text and escaped HTML content", () => {
    const message = renderEmail("trial_ending_notice", {
      recipients: ["owner@example.com"],
      organisationName: "North & <South>",
      daysRemaining: 3,
      trialEndsAt: "2026-10-08T08:00:00.000Z",
      billingUrl: "https://example.com/app/north/settings/billing",
    });
    expect(message.subject).toContain("3 days");
    expect(message.text).toContain("North & <South>");
    expect(message.html).toContain("North &amp; &lt;South&gt;");
    expect(message.html).not.toContain("North & <South>");
  });

  it("renders approval requests with the controlling ticket and expiry", () => {
    const message = renderEmail("support_approval_requested", {
      recipients: ["owner@example.com"],
      organisationName: "North Star Surveying",
      ticketReference: "SUP-1042",
      reason: "Investigate failed workspace synchronisation.",
      approvalUrl: "https://example.com/app/north/team",
      expiresAt: "2026-10-01T10:00:00.000Z",
    });
    expect(message.subject).toContain("SUP-1042");
    expect(message.text).toContain("No write access is granted");
  });
});

describe("SMTP2GO delivery", () => {
  it("uses the authenticated standard email endpoint and records the provider id", async () => {
    process.env.SMTP2GO_API_KEY = "api-test";
    process.env.SMTP2GO_SENDER = "Surveynt <notifications@example.com>";
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({ data: { succeeded: 1, failed: 0, failures: [], email_id: "email-123" } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await sendEmail({ to: ["owner@example.com"], subject: "Test", text: "Plain", html: "<p>Plain</p>" }, fetcher as typeof fetch);
    expect(result.providerMessageId).toBe("email-123");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(requests[0].input).toBe("https://api.smtp2go.com/v3/email/send");
    expect(requests[0].init?.headers).toMatchObject({ "X-Smtp2go-Api-Key": "api-test" });
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({ sender: "Surveynt <notifications@example.com>", to: ["owner@example.com"], subject: "Test" });
  });

  it("rejects an unconfirmed provider response", async () => {
    process.env.SMTP2GO_API_KEY = "api-test";
    process.env.SMTP2GO_SENDER = "notifications@example.com";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { succeeded: 0, failed: 1, failures: [{}] } }), { status: 200 }));
    await expect(sendEmail({ to: ["owner@example.com"], subject: "Test", text: "Plain", html: "<p>Plain</p>" }, fetcher as typeof fetch)).rejects.toThrow("did not confirm");
  });
  it("keeps connection loss and partial acceptance distinct from verified rejection", async () => {
    process.env.SMTP2GO_API_KEY = "api-test"; process.env.SMTP2GO_SENDER = "notifications@example.com";
    const message={to:["owner@example.com"],subject:"Test",text:"Plain",html:"<p>Plain</p>"};
    for (const fetcher of [vi.fn(async()=>{throw new Error("Connection lost");}),vi.fn(async()=>new Response(JSON.stringify({data:{succeeded:1,failed:1}}),{status:200}))]) {
      try { await sendEmail(message,fetcher as typeof fetch); throw new Error("Expected uncertainty"); } catch (error) { expect(error).toBeInstanceOf(EmailDeliveryError); expect((error as EmailDeliveryError).rejected).toBe(false); }
    }
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:{succeeded:0,failed:1}}),{status:200}));
    await expect(sendEmail(message,fetcher as typeof fetch)).rejects.toMatchObject({rejected:true});
  });
  it("adds provider correlation headers and bounds the network wait",async()=>{
    process.env.SMTP2GO_API_KEY="api-test";process.env.SMTP2GO_SENDER="notifications@example.com";
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:{succeeded:1,failed:0,email_id:"mail-test"}}),{status:200}));
    await sendEmail({to:["owner@example.com"],subject:"Test",text:"Plain",html:"Plain"},fetcher as typeof fetch,{jobId:"job-test",attemptId:"attempt-test"});
    const options=(fetcher.mock.calls as unknown as [string,RequestInit][])[0][1];
    expect(options.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(String(options.body)).custom_headers).toEqual([{header:"X-Surveynt-Job-Id",value:"job-test"},{header:"X-Surveynt-Attempt-Id",value:"attempt-test"}]);
  });

});
