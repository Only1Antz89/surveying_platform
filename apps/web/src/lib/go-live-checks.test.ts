import { describe, expect, it } from "vitest";
import { goLiveChecks } from "./go-live-checks";

const complete = {
  APP_URL: "https://app.surveynt.example",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc", CLERK_SECRET_KEY: "sk_live_abc", CLERK_WEBHOOK_SECRET: "whsec_abc",
  STRIPE_SECRET_KEY: "sk_live_abc", STRIPE_WEBHOOK_SECRET: "whsec_abc", STRIPE_BASE_PRICE_ID: "price_base", STRIPE_SEAT_PRICE_ID: "price_seat",
  STRIPE_CLIENT_PAYMENTS_KEY: "rk_live_abc", CLIENT_PAYMENTS_LAUNCH_APPROVED: "true",
  SMTP2GO_API_KEY: "api-abc", SMTP2GO_SENDER: "Surveynt <hello@surveynt.example>",
  QUOTE_TOKEN_SECRET: "q".repeat(40),
  CALENDAR_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), CALENDAR_WEBHOOK_SECRET: "w".repeat(40),
  GOOGLE_CALENDAR_CLIENT_ID: "id", GOOGLE_CALENDAR_CLIENT_SECRET: "secret", MICROSOFT_CALENDAR_CLIENT_ID: "id", MICROSOFT_CALENDAR_CLIENT_SECRET: "secret",
  CRON_SECRET: "c".repeat(40), QUEUE_CONSUMER_SECRET: "u".repeat(40),
};
const byKey = (env: Record<string, string | undefined>) => Object.fromEntries(goLiveChecks(env).map((check) => [check.key, check]));

describe("go-live checks", () => {
  it("passes a complete, well-formed production configuration", () => {
    expect(goLiveChecks(complete).filter((check) => !check.ready)).toEqual([]);
  });

  it("lists every missing variable by name when nothing is set", () => {
    const checks = byKey({});
    expect(Object.values(checks).every((check) => !check.ready)).toBe(true);
    expect(checks.email.missing).toEqual(["SMTP2GO_API_KEY", "SMTP2GO_SENDER", "APP_URL", "QUEUE_CONSUMER_SECRET"]);
    expect(checks.quotes.missing).toContain("QUOTE_TOKEN_SECRET");
    expect(checks.billing.missing).toContain("STRIPE_WEBHOOK_SECRET");
  });

  it("catches malformed keys without echoing their values", () => {
    const checks = byKey({ ...complete, STRIPE_WEBHOOK_SECRET: "not-a-secret-value", CALENDAR_TOKEN_ENCRYPTION_KEY: "dG9vLXNob3J0", QUOTE_TOKEN_SECRET: "short-quote-value", SMTP2GO_SENDER: "nobody" });
    expect(checks.billing.problems.join()).toContain("whsec_");
    expect(checks.calendar_google.problems.join()).toContain("32 bytes");
    expect(checks.quotes.ready).toBe(false);
    expect(checks.email.ready).toBe(false);
    const output = JSON.stringify(goLiveChecks({ ...complete, STRIPE_WEBHOOK_SECRET: "not-a-secret-value", QUOTE_TOKEN_SECRET: "short-quote-value" }));
    expect(output).not.toContain("not-a-secret-value");
    expect(output).not.toContain("short-quote-value");
  });

  it("refuses mixed live and test Stripe keys and keeps payments closed until approved", () => {
    expect(byKey({ ...complete, STRIPE_CLIENT_PAYMENTS_KEY: "rk_test_abc" }).client_payments.problems.join()).toContain("both be live");
    expect(byKey({ ...complete, CLIENT_PAYMENTS_LAUNCH_APPROVED: "false" }).client_payments.ready).toBe(false);
  });

  it("gives the exact webhook and OAuth URLs to register", () => {
    const checks = byKey(complete);
    expect(checks.billing.register[0].url).toBe("https://app.surveynt.example/api/webhooks/stripe");
    expect(checks.authentication.register[0].url).toBe("https://app.surveynt.example/api/webhooks/clerk");
    expect(checks.calendar_google.register.map((entry) => entry.url)).toEqual(["https://app.surveynt.example/api/v1/calendar/oauth/callback", "https://app.surveynt.example/api/webhooks/calendar/google"]);
  });

  it("requires https outside local development", () => {
    expect(byKey({ ...complete, APP_URL: "http://app.surveynt.example" }).quotes.problems.join()).toContain("https");
  });
});
