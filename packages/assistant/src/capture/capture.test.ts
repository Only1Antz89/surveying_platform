import { describe, expect, it } from "vitest";
import { syncRequestSchema } from "./sync";
import { reinspectTasksFromHistory } from "./history";

describe("sync contract", () => {
  it("accepts well-formed offline operations", () => {
    const parsed = syncRequestSchema.safeParse({ operations: [
      { type: "set_element", operationId: "op_00000001", element: { sectionKey: "outside", elementKey: "roof_coverings" }, inspectionStatus: "partially_inspected", limitationReason: "Viewed from ground level only", baseVersion: null },
      { type: "set_field", operationId: "op_00000002", fieldPath: "outside.roof_coverings.condition_rating", value: { state: "provided", value: "2" }, baseValueId: null },
      { type: "add_observation", operationId: "op_00000003", element: { sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "Rear slope" }, kind: "current_observation", text: "Two slipped slates near the valley." },
      { type: "link_evidence", operationId: "op_00000004", target: { type: "observation", observationOperationId: "op_00000003" }, evidence: { type: "media", id: "5d3f6c1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f" } },
    ] });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown operation types, bad ids and historical observation kinds from clients", () => {
    expect(syncRequestSchema.safeParse({ operations: [{ type: "delete_everything", operationId: "op_00000001" }] }).success).toBe(false);
    expect(syncRequestSchema.safeParse({ operations: [{ type: "set_field", operationId: "x", fieldPath: "a.b.c", value: { state: "unknown" }, baseValueId: null }] }).success).toBe(false);
    expect(syncRequestSchema.safeParse({ operations: [{ type: "add_observation", operationId: "op_00000009", element: null, kind: "historical_reference", text: "Copied" }] }).success).toBe(false);
  });
});

describe("historical context", () => {
  it("turns prior defects into reinspection prompts, never findings", () => {
    const [task] = reinspectTasksFromHistory([{ id: "p1", surveyId: "s0", surveyDate: "2021-05-04", sectionKey: "outside", elementKey: "roof_coverings", locationLabel: "Rear slope", text: "Slipped slates", conditionRating: "2" }]);
    expect(task).toMatchObject({ kind: "reinspect", dedupeKey: "reinspect:p1", title: "Reinspect: roof coverings (Rear slope)" });
    expect(task.detail).toContain("historical context only");
  });
});
