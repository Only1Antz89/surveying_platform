import { z } from "zod";

const statement = z.string().trim().max(2000).optional();
const year = z.number().int().min(1700).max(2200).optional();
/** Optional facts only. No condition ratings, safety declarations or staff observations. */
export const preinspectionAnswersSchema = z.object({
  occupancy: statement, access: statement, concerns: statement,
  propertyType: statement, approximateBuildYear: year, accommodation: statement,
  floor: statement, sharedFacilities: statement, services: statement,
  garages: statement, outbuildings: statement, parking: statement, boundaries: statement,
  alterations: statement, extensionCompletionYear: year, conversionCompletionYear: year,
  guarantees: statement, documentsAvailable: statement, reportedTenure: statement,
  agreedPurchasePriceMinor: z.number().int().min(0).max(2_000_000_000).optional(),
}).strict();
export type PreinspectionAnswers = z.infer<typeof preinspectionAnswersSchema>;
export const preinspectionMutationSchema = z.object({
  version: z.number().int().min(0),
  requestId: z.uuid(),
  answers: preinspectionAnswersSchema,
}).strict();
export const preinspectionQuestionLabels: Record<keyof PreinspectionAnswers, string> = {
  occupancy: "Who currently occupies the property?", access: "Access arrangements", concerns: "Your concerns and instructions",
  propertyType: "Reported property type", approximateBuildYear: "Approximate build year, if known", accommodation: "Rooms and accommodation",
  floor: "Floor of the flat or maisonette", sharedFacilities: "Shared facilities and access", services: "Known services and heating",
  garages: "Garages", outbuildings: "Outbuildings", parking: "Parking", boundaries: "Reported boundaries",
  alterations: "Known alterations and associated works", extensionCompletionYear: "Extension completion year, if known",
  conversionCompletionYear: "Conversion completion year, if known", guarantees: "Known guarantees or warranties",
  documentsAvailable: "Certificates and documents available", reportedTenure: "Reported tenure, if known", agreedPurchasePriceMinor: "Agreed purchase price (pence)",
};
