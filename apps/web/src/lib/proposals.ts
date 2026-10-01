import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { assistantTasks, auditEvents, createDatabase, enrichmentRuns, evidenceLinks, fieldProposals, jobs, properties, propertyIntelligenceSnapshots, surveyElements, surveyFieldValues, surveys, withTenant, type TenantTransaction } from "@surveynt/db";
import { generateSourcedProposals, resolveField, validateFieldValue, type EvidenceRef, type FieldValue, type SnapshotEvidence } from "@surveynt/assistant";
import { propertyFingerprint } from "./fingerprint";
import { canRecordProfessionalJudgement, pinnedTemplate, type SurveyContext } from "./surveys";

/** Current (same identity, non-superseded run) snapshots per source and category, including "no record" results. */
async function currentSnapshots(tx: TenantTransaction, organisationId: string, property: typeof properties.$inferSelect): Promise<SnapshotEvidence[]> {
  const fingerprint = await propertyFingerprint(property);
  const rows = await tx.select({ snapshot: propertyIntelligenceSnapshots, runStatus: enrichmentRuns.status }).from(propertyIntelligenceSnapshots)
    .innerJoin(enrichmentRuns, eq(propertyIntelligenceSnapshots.enrichmentRunId, enrichmentRuns.id))
    .where(and(eq(propertyIntelligenceSnapshots.organisationId, organisationId), eq(propertyIntelligenceSnapshots.propertyId, property.id), eq(propertyIntelligenceSnapshots.inputFingerprint, fingerprint), ne(enrichmentRuns.status, "superseded")))
    .orderBy(desc(propertyIntelligenceSnapshots.retrievedAt)).limit(1000);
  const latestRun = new Map<string, string>();
  const current: SnapshotEvidence[] = [];
  for (const { snapshot } of rows) {
    const key = `${snapshot.sourceKey}|${snapshot.category}`;
    if (!latestRun.has(key)) latestRun.set(key, snapshot.enrichmentRunId);
    if (latestRun.get(key) !== snapshot.enrichmentRunId) continue;
    current.push({ snapshotId: snapshot.id, sourceKey: snapshot.sourceKey, category: snapshot.category, status: snapshot.resultStatus, sourceRecordId: snapshot.sourceRecordId, data: snapshot.data, retrievedAt: snapshot.retrievedAt.toISOString(), sourceUpdatedAt: snapshot.sourceUpdatedAt?.toISOString().slice(0, 10) ?? null });
  }
  return current;
}

/**
 * Regenerates deterministic proposals and discrepancy tasks for an open
 * survey. Pending proposals whose inputs moved on are superseded; reviewed
 * proposals are never recreated.
 */
export async function refreshSurveyProposals(context: Pick<SurveyContext, "organisationId">, surveyId: string) {
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    if (!survey || survey.status !== "in_progress") return { created: 0, superseded: 0, discrepancies: 0 };
    const [[job], [property]] = await Promise.all([
      tx.select().from(jobs).where(and(eq(jobs.id, survey.jobId), eq(jobs.organisationId, context.organisationId))).limit(1),
      tx.select().from(properties).where(and(eq(properties.id, survey.propertyId), eq(properties.organisationId, context.organisationId))).limit(1),
    ]);
    const template = await pinnedTemplate(tx, survey);
    const values = await tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.organisationId, context.organisationId), isNull(surveyFieldValues.supersededAt)));
    const { proposals, discrepancies } = await generateSourcedProposals({
      template,
      snapshots: property ? await currentSnapshots(tx, context.organisationId, property) : [],
      currentValues: new Map(values.map((value) => [value.fieldPath, { id: value.id, value: value.value as unknown as FieldValue }])),
      job: { id: job.id, reference: job.reference, targetDate: job.targetDate },
    });
    const pending = await tx.select({ id: fieldProposals.id, dedupeKey: fieldProposals.dedupeKey }).from(fieldProposals).where(and(eq(fieldProposals.surveyId, surveyId), eq(fieldProposals.organisationId, context.organisationId), eq(fieldProposals.reviewStatus, "pending")));
    const keep = new Set(proposals.map((proposal) => proposal.dedupeKey));
    const stale = pending.filter((proposal) => !keep.has(proposal.dedupeKey)).map((proposal) => proposal.id);
    if (stale.length) await tx.update(fieldProposals).set({ reviewStatus: "superseded", reviewedAt: new Date(), reviewNote: "Inputs changed; superseded automatically." }).where(and(inArray(fieldProposals.id, stale), eq(fieldProposals.reviewStatus, "pending")));
    const elements = await tx.select({ id: surveyElements.id, sectionKey: surveyElements.sectionKey, elementKey: surveyElements.elementKey }).from(surveyElements).where(and(eq(surveyElements.surveyId, surveyId), eq(surveyElements.locationLabel, "")));
    let created = 0;
    for (const proposal of proposals) {
      const [section, element] = proposal.fieldPath.split(".");
      const [inserted] = await tx.insert(fieldProposals).values({
        organisationId: context.organisationId, surveyId, elementId: elements.find((item) => item.sectionKey === section && item.elementKey === element)?.id ?? null,
        fieldPath: proposal.fieldPath, proposedValue: proposal.proposedValue as unknown as Record<string, unknown>, valueType: proposal.valueType, evidenceRefs: proposal.evidenceRefs as unknown as Record<string, unknown>[],
        originClass: proposal.originClass, limitations: proposal.limitations, inputVersion: proposal.inputVersion, baseValueId: proposal.baseValueId, generator: proposal.generator,
        modelVersion: proposal.modelVersion, promptVersion: proposal.promptVersion, knowledgeVersion: proposal.knowledgeVersion, dedupeKey: proposal.dedupeKey,
      }).onConflictDoNothing().returning({ id: fieldProposals.id });
      if (inserted) created += 1;
    }
    let discrepancyCount = 0;
    for (const discrepancy of discrepancies) {
      const [inserted] = await tx.insert(assistantTasks).values({ organisationId: context.organisationId, surveyId, kind: "discrepancy", dedupeKey: discrepancy.dedupeKey, fieldPath: discrepancy.fieldPath, title: discrepancy.title, detail: discrepancy.detail, evidence: discrepancy.evidence }).onConflictDoNothing().returning({ id: assistantTasks.id });
      if (inserted) discrepancyCount += 1;
    }
    return { created, superseded: stale.length, discrepancies: discrepancyCount };
  });
}

/** Best-effort refresh for every open survey of a property (after enrichment completes). */
export async function refreshProposalsForProperty(organisationId: string, propertyId: string) {
  const db = createDatabase();
  const open = await withTenant(db, organisationId, (tx) => tx.select({ id: surveys.id }).from(surveys).where(and(eq(surveys.organisationId, organisationId), eq(surveys.propertyId, propertyId), eq(surveys.status, "in_progress"))));
  for (const survey of open) await refreshSurveyProposals({ organisationId }, survey.id).catch(() => undefined);
  return open.length;
}

export async function listSurveyProposals(context: Pick<SurveyContext, "organisationId">, surveyId: string) {
  const db = createDatabase();
  return withTenant(db, context.organisationId, (tx) => tx.select().from(fieldProposals).where(and(eq(fieldProposals.surveyId, surveyId), eq(fieldProposals.organisationId, context.organisationId))).orderBy(desc(fieldProposals.createdAt)).limit(200));
}

export type ReviewInput = { decision: "accept" | "edit" | "reject"; value?: FieldValue; note?: string | null; confirmProfessional?: boolean };

export type ReviewOutcome =
  | { kind: "missing" }
  | { kind: "conflict"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "reviewed"; status: "accepted" | "edited" | "rejected"; valueId: string | null };

/**
 * Applies one authorised review decision. Acceptance writes a new field value
 * with origin, source, dates and evidence links; it fails safely if the field
 * changed after the proposal was made (a stale proposal can never overwrite an edit).
 */
export async function reviewProposal(context: SurveyContext, surveyId: string, proposalId: string, input: ReviewInput): Promise<ReviewOutcome> {
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const [proposal] = await tx.select().from(fieldProposals).where(and(eq(fieldProposals.id, proposalId), eq(fieldProposals.surveyId, surveyId), eq(fieldProposals.organisationId, context.organisationId))).limit(1);
    const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    if (!proposal || !survey) return { kind: "missing" };
    if (proposal.reviewStatus !== "pending") return { kind: "conflict", message: "This suggestion has already been reviewed or replaced." };
    if (survey.status !== "in_progress") return { kind: "conflict", message: "This survey is no longer open." };
    const template = await pinnedTemplate(tx, survey);
    const resolved = resolveField(template, proposal.fieldPath);
    if (!resolved) return { kind: "invalid", message: "The field is not part of this survey's template." };
    const now = new Date();
    if (input.decision === "reject") {
      await tx.update(fieldProposals).set({ reviewStatus: "rejected", reviewedAt: now, reviewedByUserId: context.internalUserId, reviewNote: input.note ?? null }).where(and(eq(fieldProposals.id, proposal.id), eq(fieldProposals.reviewStatus, "pending")));
      await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.proposal_rejected", resourceType: "field_proposal", resourceId: proposal.id, metadata: { surveyId, fieldPath: proposal.fieldPath } });
      return { kind: "reviewed", status: "rejected", valueId: null };
    }
    if (resolved.field.fieldClass === "professional_assessment" && (!canRecordProfessionalJudgement(context.role) || !input.confirmProfessional)) return { kind: "invalid", message: "Professional assessments need explicit confirmation by a surveyor." };
    const [current] = await tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.fieldPath, proposal.fieldPath), isNull(surveyFieldValues.supersededAt))).limit(1);
    if ((current?.id ?? null) !== proposal.baseValueId) {
      await tx.update(fieldProposals).set({ reviewStatus: "superseded", reviewedAt: now, reviewNote: "The field changed after this suggestion was made." }).where(and(eq(fieldProposals.id, proposal.id), eq(fieldProposals.reviewStatus, "pending")));
      return { kind: "conflict", message: "The field changed after this suggestion was made, so it was not applied." };
    }
    const chosen = input.decision === "edit" ? input.value : (proposal.proposedValue as unknown as FieldValue);
    const validation = validateFieldValue(resolved.field, chosen);
    if (!validation.ok) return { kind: "invalid", message: validation.message };
    const evidence = proposal.evidenceRefs as unknown as EvidenceRef[];
    const datedEvidence = evidence.find((item) => item.date && /^\d{4}-\d{2}-\d{2}/.test(item.date));
    if (current) await tx.update(surveyFieldValues).set({ supersededAt: now }).where(eq(surveyFieldValues.id, current.id));
    const [value] = await tx.insert(surveyFieldValues).values({
      organisationId: context.organisationId, surveyId, fieldPath: proposal.fieldPath, value: validation.value as unknown as Record<string, unknown>,
      origin: input.decision === "edit" ? "edited_proposal" : "accepted_proposal", sourceKind: evidence[0]?.type ?? "proposal", sourceRef: evidence.map((item) => item.id).join(",").slice(0, 500),
      sourceEventDate: datedEvidence?.date?.slice(0, 10) ?? null, retrievedAt: proposal.createdAt, authorUserId: context.internalUserId, supersedesId: current?.id ?? null,
      correctionReason: input.decision === "edit" ? input.note ?? "Edited from suggestion" : null, clientGeneratedId: `proposal_${proposal.id}`,
    }).returning();
    for (const ref of evidence.filter((item) => item.type === "intelligence_snapshot" || item.type === "media")) {
      await tx.insert(evidenceLinks).values({ organisationId: context.organisationId, surveyId, targetType: "field_value", targetId: value.id, evidenceType: ref.type, evidenceId: ref.id, note: ref.label.slice(0, 500), createdByUserId: context.internalUserId, clientGeneratedId: `proposal_${proposal.id}_${ref.id}` });
    }
    const status = input.decision === "edit" ? "edited" as const : "accepted" as const;
    await tx.update(fieldProposals).set({ reviewStatus: status, reviewedAt: now, reviewedByUserId: context.internalUserId, reviewNote: input.note ?? null, acceptedValueId: value.id }).where(and(eq(fieldProposals.id, proposal.id), eq(fieldProposals.reviewStatus, "pending")));
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: `survey.proposal_${status}`, resourceType: "field_proposal", resourceId: proposal.id, metadata: { surveyId, fieldPath: proposal.fieldPath, valueId: value.id } });
    return { kind: "reviewed", status, valueId: value.id };
  });
}

export async function updateTask(context: SurveyContext, surveyId: string, taskId: string, input: { status: "resolved" | "dismissed"; note: string | null }) {
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const [task] = await tx.update(assistantTasks).set({ status: input.status, resolvedAt: new Date(), resolvedByUserId: context.internalUserId, resolutionNote: input.note, updatedAt: new Date() })
      .where(and(eq(assistantTasks.id, taskId), eq(assistantTasks.surveyId, surveyId), eq(assistantTasks.organisationId, context.organisationId), eq(assistantTasks.status, "open"))).returning();
    if (task) await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: `survey.task_${input.status}`, resourceType: "assistant_task", resourceId: task.id, metadata: { surveyId, kind: task.kind } });
    return task ?? null;
  });
}
