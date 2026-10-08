import type { EmailJobType } from "./email";

// Only customer communications can be disabled by practice settings.
// Billing and privileged access notices must reach the responsible owners.
export function shouldSendNotification(type: EmailJobType, preferences?: Record<string, boolean> | null) {
  return type !== "customer_quote_issued" || preferences?.customer_quote_issued !== false;
}
