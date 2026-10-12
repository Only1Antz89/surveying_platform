import { z } from "zod";
import { demoRecordId, survaiPages } from "./survai-context";
export const survaiPageContextInput = z.object({ page: z.enum(survaiPages), resourceId: z.union([z.uuid(), z.string().regex(demoRecordId)]).optional() }).strict().refine(value => !value.resourceId || ["job", "survey", "property", "customer"].includes(value.page), "Selected records are limited to case, property and customer pages.");
