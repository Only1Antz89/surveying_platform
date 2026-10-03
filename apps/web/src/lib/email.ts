import { z } from "zod";

export const emailJobTypes = [
  "trial_started_notice",
  "trial_ending_notice",
  "payment_issue_notice",
  "support_approval_requested",
  "support_break_glass_notification",
  "customer_quote_issued",
] as const;

export type EmailJobType = (typeof emailJobTypes)[number];

type EmailMessage = { to: string[]; subject: string; text: string; html: string };

const recipients = z.array(z.email()).min(1).max(50);
const basePayload = z.object({ recipients, organisationName: z.string().trim().min(1).max(160) });
const payloadSchemas = {
  trial_started_notice: basePayload.extend({ trialEndsAt: z.iso.datetime(), workspaceUrl: z.url() }),
  trial_ending_notice: basePayload.extend({ daysRemaining: z.union([z.literal(7), z.literal(3), z.literal(1)]), trialEndsAt: z.iso.datetime(), billingUrl: z.url() }),
  payment_issue_notice: basePayload.extend({ status: z.enum(["past_due", "unpaid"]), graceEndsAt: z.iso.datetime().nullable(), billingUrl: z.url() }),
  support_approval_requested: basePayload.extend({ ticketReference: z.string().min(3).max(80), reason: z.string().min(10).max(500), approvalUrl: z.url(), expiresAt: z.iso.datetime() }),
  support_break_glass_notification: basePayload.extend({ ticketReference: z.string().min(3).max(80), reason: z.string().min(10).max(500), expiresAt: z.iso.datetime() }),
  customer_quote_issued: basePayload.extend({ customerName: z.string().min(1).max(160), quoteReference: z.string().min(3).max(80), total: z.string().min(1).max(40), expiresAt: z.iso.datetime(), quoteUrl: z.url() }),
} satisfies Record<EmailJobType, z.ZodType>;

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const formatDate = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" });

function frame(title: string, intro: string, details: string[], action?: { label: string; url: string }) {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const detailHtml = details.map((detail) => `<p style="margin:0 0 8px;color:#334155;font-size:14px;line-height:1.5">${escapeHtml(detail)}</p>`).join("");
  const actionHtml = action ? `<p style="margin:24px 0 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px;font-weight:600;font-size:14px">${escapeHtml(action.label)}</a></p>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f7f9fc;font-family:Arial,sans-serif;color:#0f1b2d"><div style="display:none;max-height:0;overflow:hidden">${safeIntro}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f9fc;padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e5e7eb;border-radius:8px"><tr><td style="padding:18px 24px;background:#0f1b2d;color:#fff;font-weight:700;letter-spacing:.04em">Surveynt</td></tr><tr><td style="padding:28px 24px"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${safeTitle}</h1><p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6">${safeIntro}</p>${detailHtml}${actionHtml}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#64748b;font-size:12px">This is an operational email from Surveynt.</td></tr></table></td></tr></table></body></html>`;
}

export function renderEmail(type: EmailJobType, rawPayload: unknown): EmailMessage {
  const payload = payloadSchemas[type].parse(rawPayload) as z.infer<(typeof payloadSchemas)[EmailJobType]>;
  if (type === "trial_started_notice") {
    const value = payloadSchemas.trial_started_notice.parse(payload);
    const title = `Your ${value.organisationName} trial is active`;
    const intro = `Your 14-day Surveynt trial has started and your workspace is ready.`;
    const details = [`Trial ends: ${formatDate(value.trialEndsAt)}`, "A payment method is already on file. Billing starts automatically unless the subscription is cancelled before the trial ends."];
    return { to: value.recipients, subject: title, text: `${title}\n\n${intro}\n\n${details.join("\n")}\n\nOpen workspace: ${value.workspaceUrl}`, html: frame(title, intro, details, { label: "Open workspace", url: value.workspaceUrl }) };
  }
  if (type === "trial_ending_notice") {
    const value = payloadSchemas.trial_ending_notice.parse(payload);
    const title = `Your Surveynt trial ends in ${value.daysRemaining} ${value.daysRemaining === 1 ? "day" : "days"}`;
    const intro = `${value.organisationName}'s trial is approaching its end.`;
    const details = [`Trial ends: ${formatDate(value.trialEndsAt)}`, "Your saved payment method will be charged automatically. Review the subscription or cancel before the trial ends if you do not want service to continue."];
    return { to: value.recipients, subject: title, text: `${title}\n\n${intro}\n\n${details.join("\n")}\n\nReview billing: ${value.billingUrl}`, html: frame(title, intro, details, { label: "Review billing", url: value.billingUrl }) };
  }
  if (type === "payment_issue_notice") {
    const value = payloadSchemas.payment_issue_notice.parse(payload);
    const title = `Action required: Surveynt payment issue`;
    const intro = `We could not confirm payment for ${value.organisationName}.`;
    const details = value.graceEndsAt ? [`Your workspace remains available during the grace period until ${formatDate(value.graceEndsAt)}.`, "Update the payment method to prevent the workspace becoming read-only."] : ["Workspace changes are restricted until billing is restored."];
    return { to: value.recipients, subject: title, text: `${title}\n\n${intro}\n\n${details.join("\n")}\n\nRestore billing: ${value.billingUrl}`, html: frame(title, intro, details, { label: "Restore billing", url: value.billingUrl }) };
  }
  if (type === "support_approval_requested") {
    const value = payloadSchemas.support_approval_requested.parse(payload);
    const title = `Support access approval requested`;
    const intro = `Surveynt support has requested time-limited write access to ${value.organisationName}.`;
    const details = [`Ticket: ${value.ticketReference}`, `Reason: ${value.reason}`, `Request expires: ${formatDate(value.expiresAt)}`, "No write access is granted unless a practice owner approves this request."];
    return { to: value.recipients, subject: `${title} · ${value.ticketReference}`, text: `${title}\n\n${intro}\n\n${details.join("\n")}\n\nReview request: ${value.approvalUrl}`, html: frame(title, intro, details, { label: "Review request", url: value.approvalUrl }) };
  }
  if (type === "customer_quote_issued") {
    const value = payloadSchemas.customer_quote_issued.parse(payload);
    const title = `Your survey quote · ${value.quoteReference}`;
    const intro = `Hello ${value.customerName}, ${value.organisationName} has prepared your survey quote.`;
    const details = [`Total including VAT: ${value.total}`, `Quote valid until: ${formatDate(value.expiresAt)}`, "Use the secure link to review the quote, provide the property address and pay the deposit."];
    return { to: value.recipients, subject: title, text: `${title}\n\n${intro}\n\n${details.join("\n")}\n\nReview quote: ${value.quoteUrl}`, html: frame(title, intro, details, { label: "Review quote", url: value.quoteUrl }) };
  }
  const value = payloadSchemas.support_break_glass_notification.parse(payload);
  const title = `Emergency support access started`;
  const intro = `A Surveynt super administrator started emergency write access to ${value.organisationName}.`;
  const details = [`Ticket: ${value.ticketReference}`, `Reason: ${value.reason}`, `Access expires: ${formatDate(value.expiresAt)}`, "The session is fully audited and cannot impersonate a customer account."];
  return { to: value.recipients, subject: `${title} · ${value.ticketReference}`, text: `${title}\n\n${intro}\n\n${details.join("\n")}`, html: frame(title, intro, details) };
}

export function emailDeliveryConfigured() {
  return Boolean(process.env.SMTP2GO_API_KEY && process.env.SMTP2GO_SENDER);
}

export async function sendEmail(message: EmailMessage, fetcher: typeof fetch = fetch) {
  if (!process.env.SMTP2GO_API_KEY || !process.env.SMTP2GO_SENDER) throw new Error("SMTP2GO email delivery is not configured.");
  const response = await fetcher("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "X-Smtp2go-Api-Key": process.env.SMTP2GO_API_KEY },
    body: JSON.stringify({ sender: process.env.SMTP2GO_SENDER, to: message.to, subject: message.subject, text_body: message.text, html_body: message.html }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`SMTP2GO rejected the email with status ${response.status}.`);
  const result = z.object({ data: z.object({ succeeded: z.number(), failed: z.number(), email_id: z.string().optional(), failures: z.array(z.unknown()).optional() }) }).safeParse(payload);
  if (!result.success || result.data.data.succeeded < 1 || result.data.data.failed > 0) throw new Error("SMTP2GO did not confirm email delivery acceptance.");
  return { providerMessageId: result.data.data.email_id ?? null };
}

export function applicationUrl() {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const hostname = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return hostname ? `https://${hostname}` : "http://localhost:3000";
}
