import { describe, expect, it } from "vitest";
import { emailJobTypes } from "./email";
import { shouldSendNotification } from "./notification-preferences";

describe("practice notification preferences", () => {
  it("enables customer quote email by default", () => {
    const cases: Array<Record<string,boolean> | null | undefined> = [undefined, null, {}, {customer_quote_issued:true}];
    for (const preferences of cases) {
      expect(shouldSendNotification("customer_quote_issued", preferences)).toBe(true);
    }
  });
  it("honours explicit customer quote opt out", () => {
    expect(shouldSendNotification("customer_quote_issued", {customer_quote_issued:false})).toBe(false);
  });
  it("never suppresses billing or privileged access notices", () => {
    const preferences = Object.fromEntries(emailJobTypes.map(type => [type,false]));
    for (const type of emailJobTypes.filter(type => type !== "customer_quote_issued")) {
      expect(shouldSendNotification(type, preferences)).toBe(true);
    }
  });
});
