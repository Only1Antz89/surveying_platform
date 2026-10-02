import { z } from "zod";
import { fieldValueSchema, inspectionStatuses } from "../forms/types";

// Offline capture contract shared by the browser outbox and the sync API.
// Every operation carries a client-generated id; replaying it is idempotent.

const operationId = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);
const key = z.string().regex(/^[a-z][a-z0-9_]*$/).max(60);
const elementRef = z.object({ sectionKey: key, elementKey: key, locationLabel: z.string().trim().max(120).default("") });

export const observationKinds = ["current_observation", "measurement", "client_claim"] as const;

/** Surveynt-owned next actions for an observation the surveyor classifies as a defect. */
export const nextActions = ["monitor", "repair", "replace", "further_investigation", "specialist_report", "obtain_documents"] as const;
export type NextAction = (typeof nextActions)[number];
export const nextActionLabels: Record<NextAction, string> = {
  monitor: "Monitor",
  repair: "Repair",
  replace: "Replace",
  further_investigation: "Further investigation",
  specialist_report: "Specialist report",
  obtain_documents: "Obtain documents or guarantees",
};

export const syncOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_element"),
    operationId,
    element: elementRef,
    inspectionStatus: z.enum(inspectionStatuses).nullable(),
    limitationReason: z.string().trim().max(2000).nullable(),
    /** Version the client last saw, or null if it believes the element is new. */
    baseVersion: z.number().int().positive().nullable(),
  }),
  z.object({
    type: z.literal("set_field"),
    operationId,
    fieldPath: z.string().max(200),
    value: fieldValueSchema,
    /** Current value id the client edited from, or null for a first value. */
    baseValueId: z.uuid().nullable(),
    correctionReason: z.string().trim().max(1000).nullable().optional(),
  }),
  z.object({
    type: z.literal("add_observation"),
    operationId,
    element: elementRef.nullable(),
    kind: z.enum(observationKinds),
    text: z.string().trim().min(1).max(8000),
    measurement: z.object({ value: z.number().finite(), unit: z.string().trim().min(1).max(20), method: z.string().trim().max(200).optional() }).optional(),
    /** A professional classification: only surveyor roles may record it. */
    defect: z.object({ nextAction: z.enum(nextActions) }).optional(),
    observedAt: z.iso.datetime().optional(),
  }),
  z.object({
    type: z.literal("revise_observation"),
    operationId,
    observationId: z.uuid(),
    text: z.string().trim().min(1).max(8000),
    baseVersion: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("withdraw_observation"),
    operationId,
    observationId: z.uuid(),
    reason: z.string().trim().min(3).max(1000),
    baseVersion: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("link_evidence"),
    operationId,
    target: z.discriminatedUnion("type", [
      z.object({ type: z.literal("element"), element: elementRef }),
      z.object({ type: z.literal("observation"), observationId: z.uuid().optional(), observationOperationId: operationId.optional() }).refine((value) => Boolean(value.observationId ?? value.observationOperationId), "An observation reference is required."),
      z.object({ type: z.literal("field_value"), fieldPath: z.string().max(200) }),
    ]),
    evidence: z.object({ type: z.enum(["media", "observation", "intelligence_snapshot"]), id: z.string().min(1).max(80) }),
    region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
]);

export type SyncOperation = z.infer<typeof syncOperationSchema>;

export const syncRequestSchema = z.object({ operations: z.array(syncOperationSchema).min(1).max(100) });

export type SyncResult =
  | { operationId: string; status: "applied" | "duplicate"; record?: Record<string, unknown> }
  | { operationId: string; status: "conflict"; message: string; current: Record<string, unknown> | null }
  | { operationId: string; status: "rejected"; message: string };
