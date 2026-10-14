import { z } from "zod";

export const messageKeys = ["appointment_reminder", "on_the_way", "access_request", "review_request"] as const;
export type MessageKey = (typeof messageKeys)[number];
export type MessageChannel = "email" | "sms";
export const messageTokens = ["clientName", "practiceName", "reference", "propertyAddress", "appointmentDate", "appointmentTime", "surveyorName", "reviewLink"] as const;
export type MessageValues = Partial<Record<(typeof messageTokens)[number], string>>;

export const messageMeta: Record<MessageKey, { label: string; when: string; automatic: boolean }> = {
  appointment_reminder: { label: "Appointment reminder", when: "Sent automatically the day before a confirmed visit.", automatic: true },
  on_the_way: { label: "On the way", when: "Sent by the surveyor from the job record when they set off.", automatic: false },
  access_request: { label: "Access request", when: "Sent from the job record to ask for keys, loft access or occupier contact.", automatic: false },
  review_request: { label: "Review request", when: "Sent automatically a few days after the report is issued, when review requests are on.", automatic: true },
};

export const defaultTemplates: Record<MessageKey, { subject: string; body: string; sms: string }> = {
  appointment_reminder: { subject: "Your survey visit tomorrow · {reference}", body: "Dear {clientName},\n\nThis is a reminder that {surveyorName} will visit {propertyAddress} on {appointmentDate} at {appointmentTime}.\n\nPlease make sure we can reach the loft hatch, the boiler and any outbuildings. If the property is occupied, let the occupier know we are coming.\n\nKind regards,\n{practiceName}", sms: "{practiceName}: reminder that your survey at {propertyAddress} is on {appointmentDate} at {appointmentTime}. Ref {reference}." },
  on_the_way: { subject: "Your surveyor is on the way · {reference}", body: "Dear {clientName},\n\n{surveyorName} is on the way to {propertyAddress} and expects to arrive shortly.\n\nKind regards,\n{practiceName}", sms: "{practiceName}: {surveyorName} is on the way to {propertyAddress}." },
  access_request: { subject: "Arranging access for your survey · {reference}", body: "Dear {clientName},\n\nTo complete the inspection at {propertyAddress} we need access to every room, the loft hatch and any outbuildings.\n\nPlease reply with how we should collect keys or contact the occupier.\n\nKind regards,\n{practiceName}", sms: "{practiceName}: please reply to our email about access to {propertyAddress} for your survey. Ref {reference}." },
  review_request: { subject: "How did we do? · {reference}", body: "Dear {clientName},\n\nThank you for choosing {practiceName} for your survey of {propertyAddress}.\n\nIf you have a moment, we would be grateful for a short review. It helps other buyers find us.\n\nKind regards,\n{practiceName}", sms: "{practiceName}: thank you for your survey. A short review would help us: {reviewLink}" },
};

export const templateInput = z.object({ key: z.enum(messageKeys), channel: z.enum(["email", "sms"]), subject: z.string().trim().max(200).nullable().optional(), body: z.string().trim().min(10).max(5000), enabled: z.boolean() })
  .refine((value) => value.channel === "sms" || (value.subject?.length ?? 0) >= 3, { message: "Email messages need a subject." })
  .refine((value) => value.channel === "email" || value.body.length <= 480, { message: "Text messages must be 480 characters or fewer." });

/** Fills {tokens}; unknown or missing values become an empty string and the text is tidied. */
export function fillTemplate(text: string, values: MessageValues) {
  return text.replace(/\{(\w+)\}/g, (_, token: string) => (messageTokens as readonly string[]).includes(token) ? values[token as keyof MessageValues] ?? "" : "").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
}

/** Tokens a template uses that are not supported, so the editor can warn before saving. */
export function unknownTokens(text: string) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).filter((token) => !(messageTokens as readonly string[]).includes(token)))];
}
