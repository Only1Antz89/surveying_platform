import { z } from "zod";

export const quoteTemplateDefaults = {
  subject: "Your survey quote · {{quoteReference}}",
  introduction: "Hello {{customerName}}, {{organisationName}} has prepared your survey quote.",
};
type TemplateToken = "customerName" | "organisationName" | "quoteReference" | "total";
const templateText = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => {
  const remainder = value.replace(/\{\{(customerName|organisationName|quoteReference|total)\}\}/g, "");
  return !/[{}]/.test(remainder);
}, "Use only the listed template variables.");
export const quoteEmailTemplateSchema = z.object({
  subject: templateText(160).refine(value => !/[\r\n]/.test(value), "The subject must be one line."),
  introduction: templateText(1500),
}).strict();
export const emailTemplatesSchema = z.object({customer_quote_issued:quoteEmailTemplateSchema.optional()}).strict();
export type EmailTemplates = z.infer<typeof emailTemplatesSchema>;
export function fillQuoteTemplate(template: string, values: Record<TemplateToken, string>) {
  // One pass prevents customer data containing braces from becoming executable variables.
  return template.replace(/\{\{(customerName|organisationName|quoteReference|total)\}\}/g, (_, token: TemplateToken) => values[token]);
}
