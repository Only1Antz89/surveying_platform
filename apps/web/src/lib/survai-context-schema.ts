import { z } from "zod";
import { survaiPages } from "./survai-context";
export const survaiPageContextInput = z.object({ page: z.enum(survaiPages), resourceId: z.uuid().optional() }).strict().refine(value => !value.resourceId || ["job", "survey", "property", "customer"].includes(value.page), "Selected records are limited to case, property and customer pages.");
