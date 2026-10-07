import { z } from "zod";

export const alterationSurcharges = [
  { key: "loft-conversion", label: "Loft conversion" },
  { key: "single-storey-extension", label: "Single-storey extension" },
  { key: "double-storey-extension", label: "Double-storey extension" },
  { key: "conservatory", label: "Conservatory" },
] as const;
const surchargeKey = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).refine(key => !["constructor","prototype","__proto__"].includes(key));
export const servicePricingInput = z.object({
  name: z.string().trim().min(2).max(160),
  baseAmountMinor: z.number().int().min(0).max(100_000_000),
  vatBasisPoints: z.number().int().min(0).max(10000).default(2000),
  depositBasisPoints: z.number().int().min(0).max(10000).default(1000),
  durationMinutes: z.number().int().min(15).max(2880),
  validityDays: z.number().int().min(1).max(365).default(7),
  surcharges: z.record(surchargeKey,z.object({label:z.string().trim().min(1).max(120),amountMinor:z.number().int().min(0).max(100_000_000)})).default({}),
  recommendationRules: z.object({source:z.literal("clifton_adviser_v1").optional()}).catchall(z.unknown()).default({}),
  active:z.boolean().default(true),
}).refine(value => Object.keys(value.surcharges).length <= 30 && value.baseAmountMinor + Object.values(value.surcharges).reduce((sum,s)=>sum+s.amountMinor,0) <= 100_000_000, "The combined base fee and surcharges exceed the supported price limit.");
