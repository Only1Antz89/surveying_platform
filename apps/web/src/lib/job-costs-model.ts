import { z } from "zod";

// Job profitability: the agreed fee less time at the practice's staff cost rate,
// mileage at its mileage rate and recorded expenses. Pure and shared with the UI.

export const expenseCategories = ["travel", "parking", "equipment_hire", "specialist", "subsistence", "other"] as const;
export const expenseLabels: Record<(typeof expenseCategories)[number], string> = { travel: "Travel and fares", parking: "Parking and tolls", equipment_hire: "Equipment hire", specialist: "Specialist or sub-contractor", subsistence: "Subsistence", other: "Other" };

const day = z.iso.date().refine((value) => { const time = Date.parse(`${value}T12:00:00Z`); return time <= Date.now() + 86_400_000 && time >= Date.now() - 400 * 86_400_000; }, "Choose a date in the last year.");
export const costEntryInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time"), occurredOn: day, minutes: z.number().int().min(1).max(1440), description: z.string().trim().max(300).nullable().optional() }),
  z.object({ kind: z.literal("mileage"), occurredOn: day, miles: z.number().positive().max(2000).multipleOf(0.1), description: z.string().trim().max(300).nullable().optional() }),
  z.object({ kind: z.literal("expense"), occurredOn: day, amountMinor: z.number().int().min(1).max(10_000_000), category: z.enum(expenseCategories), description: z.string().trim().max(300).nullable().optional() }),
]);
export type CostEntryInput = z.infer<typeof costEntryInput>;
export type CostEntry = { id: string; kind: "time" | "mileage" | "expense"; occurredOn: string; minutes: number | null; miles: number | null; amountMinor: number | null; category: string | null; description: string | null; userId: string; userName: string | null; createdAt: string };
export type CostRates = { staffCostRatePence: number; mileageRatePence: number };
export type JobCostSummary = { minutes: number; miles: number; timeCostMinor: number; mileageCostMinor: number; expensesMinor: number; totalCostMinor: number; feeMinor: number | null; profitMinor: number | null; marginPercent: number | null };

export function costSummary(entries: Pick<CostEntry, "kind" | "minutes" | "miles" | "amountMinor">[], rates: CostRates, feeMinor: number | null): JobCostSummary {
  const minutes = entries.reduce((sum, entry) => sum + (entry.kind === "time" ? entry.minutes ?? 0 : 0), 0);
  const miles = Math.round(entries.reduce((sum, entry) => sum + (entry.kind === "mileage" ? entry.miles ?? 0 : 0), 0) * 10) / 10;
  const expensesMinor = entries.reduce((sum, entry) => sum + (entry.kind === "expense" ? entry.amountMinor ?? 0 : 0), 0);
  const timeCostMinor = Math.round(minutes / 60 * rates.staffCostRatePence);
  const mileageCostMinor = Math.round(miles * rates.mileageRatePence);
  const totalCostMinor = timeCostMinor + mileageCostMinor + expensesMinor;
  const profitMinor = feeMinor == null ? null : feeMinor - totalCostMinor;
  return { minutes, miles, timeCostMinor, mileageCostMinor, expensesMinor, totalCostMinor, feeMinor, profitMinor, marginPercent: feeMinor && profitMinor != null ? Math.round(profitMinor / feeMinor * 1000) / 10 : null };
}

/** jobs.fee is stored in pounds (numeric); costs are calculated in pence. */
export const feeToMinor = (fee: string | number | null) => fee == null || fee === "" ? null : Math.round(Number(fee) * 100);
export const hoursLabel = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
