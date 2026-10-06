import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { assistantTasks, auditEvents, createDatabase, enrichmentRuns, evidenceLinks, fieldProposals, jobs, organisations, organisationOperationalSettings, preinspectionDocuments, preinspectionSubmissions, properties, propertyIntelligenceSnapshots, surveyElements, surveyFieldValues, surveys, withTenant, type TenantTransaction } from "@surveynt/db";
import { inspectionWeather, type InspectionWeatherResult } from "@surveynt/property-data";
import { generateSourcedProposals, preinspectionAnswersSchema, resolveField, validateFieldValue, type EvidenceRef, type FieldValue, type SnapshotEvidence } from "@surveynt/assistant";
import { propertyFingerprint } from "./fingerprint";
import { assistantEnabled } from "./assistant-flags";
import { canRecordProfessionalJudgement, pinnedTemplate, type SurveyContext } from "./surveys";
import { currentProfessionalPermission } from "./professional-membership";
import { assignedJobScope } from "./workspace-scope";
import { wholeFormEvidenceEnabled } from "./whole-form-evidence";
import { reportIdentityEvidence } from "./report-identity";

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
    if (snapshot.expiresAt && snapshot.expiresAt <= new Date()) continue;
    current.push({ snapshotId: snapshot.id, sourceKey: snapshot.sourceKey, category: snapshot.category, status: snapshot.resultStatus, sourceRecordId: snapshot.sourceRecordId, data: snapshot.data, retrievedAt: snapshot.retrievedAt.toISOString(), sourceUpdatedAt: snapshot.sourceUpdatedAt?.toISOString().slice(0, 10) ?? null, coverage: snapshot.coverageStatus, confidence: snapshot.confidenceLabel ?? String(snapshot.confidence), matchMethod: snapshot.matchMethod });
  }
  return current;
}

/**
 * Regenerates deterministic proposals and discrepancy tasks for an open
 * survey. Pending proposals whose inputs moved on are superseded; reviewed
 * proposals are never recreated.
 */
export async function refreshSurveyProposals(context: Pick<SurveyContext, "organisationId"> & Partial<SurveyContext>, surveyId: string, loadWeather = false): Promise<{ created: number; superseded: number; discrepancies: number; weather?: { status: InspectionWeatherResult["status"]; message: string } }> {
  if (!assistantEnabled()) return { created: 0, superseded: 0, discrepancies: 0 };
  const db = createDatabase();
  // Network work stays outside the transaction; recheck date/identity after it completes.
  const weatherInput = loadWeather ? await withTenant(db, context.organisationId, async tx => {
    const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId), eq(surveys.status, "in_progress"))).limit(1);
    if (!survey) return null;
    const [[property], [date], [organisation]] = await Promise.all([
      tx.select().from(properties).where(and(eq(properties.id, survey.propertyId), eq(properties.organisationId, context.organisationId))).limit(1),
      tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.fieldPath, "a.details.inspection_date"), isNull(surveyFieldValues.supersededAt))).limit(1),
      tx.select({ isDemo: organisations.isDemo }).from(organisations).where(eq(organisations.id, context.organisationId)).limit(1),
    ]);
    const value = date?.value as FieldValue | undefined;
    if (!property || !date || value?.state !== "provided" || typeof value.value !== "string") return null;
    return { date: value.value, dateId: date.id, latitude: property.latitude, longitude: property.longitude, fingerprint: await propertyFingerprint(property), confirmed: Boolean(property.confirmedByUserId), demo: organisation?.isDemo === true };
  }) : null;
  const weather: InspectionWeatherResult | null = !loadWeather ? null : !weatherInput ? { status: "not_checked", message: "Save the actual inspection date before loading weather. Manual entry remains available." } : weatherInput.demo ? { status: "not_checked", message: "Demo practice: no external weather request was made. Enter simulated observations manually." } : !weatherInput.confirmed ? { status: "not_checked", message: "Confirm the property location before loading weather." } : await inspectionWeather(weatherInput, { env: process.env });
  return withTenant(db, context.organisationId, async (tx) => {
    const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    if (!survey || survey.status !== "in_progress") return { created: 0, superseded: 0, discrepancies: 0 };
    const [[job], [property]] = await Promise.all([
      tx.select().from(jobs).where(and(eq(jobs.id, survey.jobId), eq(jobs.organisationId, context.organisationId))).limit(1),
      tx.select().from(properties).where(and(eq(properties.id, survey.propertyId), eq(properties.organisationId, context.organisationId))).limit(1),
    ]);
    const template = await pinnedTemplate(tx, survey);
    if (template.version === "1.2.0" && template.key.startsWith("surveynt-home-survey-") && !await wholeFormEvidenceEnabled(tx, context.organisationId)) return { created: 0, superseded: 0, discrepancies: 0 };
    const values = await tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.organisationId, context.organisationId), isNull(surveyFieldValues.supersededAt)));
    const weatherCurrent = weather?.status === "available" && weatherInput && property && weatherInput.fingerprint === await propertyFingerprint(property) && values.some(value => value.id === weatherInput.dateId);
    const [submission] = template.version === "1.2.0" ? await tx.select({ submission: preinspectionSubmissions }).from(preinspectionSubmissions).innerJoin(organisations, eq(organisations.id, preinspectionSubmissions.organisationId)).innerJoin(organisationOperationalSettings, eq(organisationOperationalSettings.organisationId, organisations.id)).where(and(eq(preinspectionSubmissions.organisationId, context.organisationId), eq(preinspectionSubmissions.jobId, survey.jobId), eq(preinspectionSubmissions.propertyId, survey.propertyId), eq(organisations.isDemo, true), eq(organisationOperationalSettings.surveyEvidenceEnabled, true))).orderBy(desc(preinspectionSubmissions.version)).limit(1) : [];
    const answers = preinspectionAnswersSchema.safeParse(submission?.submission.answers);
    const documents = template.version === "1.2.0" && property ? await tx.select().from(preinspectionDocuments).where(and(eq(preinspectionDocuments.organisationId, context.organisationId), eq(preinspectionDocuments.jobId, survey.jobId), eq(preinspectionDocuments.propertyId, survey.propertyId), isNull(preinspectionDocuments.supersededAt))).limit(100) : [];
    const fingerprint = property ? await propertyFingerprint(property) : null;
    const { proposals, discrepancies } = await generateSourcedProposals({
      template,
      documents: documents.flatMap(document => {
        const analysis = document.analysis as { status?: string; facts?: { worksCompletionDate?: { value: string; span: { page: number; excerpt: string } } | null } };
        const fact = analysis.facts?.worksCompletionDate;
        if (analysis.status !== "completed" || !fact || !document.associatedAt || document.associationFingerprint !== fingerprint || !["extension", "conversion"].includes(document.worksKind ?? "")) return [];
        return [{ id: document.id, name: document.name, context: `${document.checksum}|${fingerprint}|${document.associatedAt.toISOString()}`, worksKind: document.worksKind as "extension" | "conversion", completionDate: fact.value, page: fact.span.page, excerpt: fact.span.excerpt }];
      }),
      snapshots: property ? await currentSnapshots(tx, context.organisationId, property) : [],
      currentValues: new Map(values.map((value) => [value.fieldPath, { id: value.id, value: value.value as unknown as FieldValue }])),
      job: { id: job.id, reference: job.reference, targetDate: job.targetDate },
      questionnaire: submission && answers.success && property ? { id: submission.submission.id, version: submission.submission.version, submittedAt: submission.submission.createdAt.toISOString(), answers: answers.data, propertyFingerprint: await propertyFingerprint(property) } : undefined,
      identity: template.version === "1.2.0" ? await reportIdentityEvidence(tx, context.organisationId, context.internalUserId) : undefined,
      weather: weatherCurrent && weather?.status === "available" && weatherInput ? { ...weather, inspectionDate: weather.date, contextId: `${weatherInput.dateId}|${weatherInput.fingerprint}` } : undefined,
    });
    const pending = await tx.select({ id: fieldProposals.id, dedupeKey: fieldProposals.dedupeKey, evidence: fieldProposals.evidenceRefs }).from(fieldProposals).where(and(eq(fieldProposals.surveyId, surveyId), eq(fieldProposals.organisationId, context.organisationId), eq(fieldProposals.reviewStatus, "pending")));
    const keep = new Set(proposals.map((proposal) => proposal.dedupeKey));
    // Property-worker refreshes must not erase independently retrieved weather context.
    const stale = pending.filter((proposal) => !keep.has(proposal.dedupeKey) && (loadWeather || !proposal.dedupeKey.startsWith("a.details.weather:")) && (context.internalUserId || !(proposal.evidence as EvidenceRef[]).some(ref => ref.type === "practitioner_profile"))).map((proposal) => proposal.id);
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
    return { created, superseded: stale.length, discrepancies: discrepancyCount, weather: weather ? { status: weatherCurrent ? "available" : weather.status === "available" ? "not_checked" : weather.status, message: weather.status === "available" ? weatherCurrent ? "Historical day-wide weather context loaded. Confirm against the actual visit." : "Inspection date or location changed; weather was discarded. Load evidence again." : weather.message } : undefined };
  });
}

/** Best-effort refresh for every open survey of a property (after enrichment completes). */
export async function refreshProposalsForProperty(organisationId: string, propertyId: string) {
  if (!assistantEnabled()) return 0;
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
    if (!await currentProfessionalPermission(tx, context, "record_survey")) return { kind: "invalid", message: "Professional recording permission is required." };
    const pack = await tx.select({ id: surveys.id }).from(surveys).innerJoin(jobs, eq(jobs.id, surveys.jobId)).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId), assignedJobScope(context))).for("update", { of: jobs }).limit(1);
    if (!pack.length) return { kind: "missing" };
    const [proposal] = await tx.select().from(fieldProposals).where(and(eq(fieldProposals.id, proposalId), eq(fieldProposals.surveyId, surveyId), eq(fieldProposals.organisationId, context.organisationId))).limit(1);
    const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    if (!proposal || !survey) return { kind: "missing" };
    if (proposal.reviewStatus !== "pending") return { kind: "conflict", message: "This suggestion has already been reviewed or replaced." };
    if (survey.status !== "in_progress") return { kind: "conflict", message: "This survey is no longer open." };
    const template = await pinnedTemplate(tx, survey);
    const resolved = resolveField(template, proposal.fieldPath);
    if (template.version === "1.2.0" && template.key.startsWith("surveynt-home-survey-") && !await wholeFormEvidenceEnabled(tx, context.organisationId)) return { kind: "invalid", message: "Whole-form evidence has been disabled for this practice." };
    if (!resolved) return { kind: "invalid", message: "The field is not part of this survey's template." };
    const now = new Date();
    if (input.decision === "reject") {
      await tx.update(fieldProposals).set({ reviewStatus: "rejected", reviewedAt: now, reviewedByUserId: context.internalUserId, reviewNote: input.note ?? null }).where(and(eq(fieldProposals.id, proposal.id), eq(fieldProposals.reviewStatus, "pending")));
      await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.proposal_rejected", resourceType: "field_proposal", resourceId: proposal.id, metadata: { surveyId, fieldPath: proposal.fieldPath } });
      return { kind: "reviewed", status: "rejected", valueId: null };
    }
    if (resolved.field.fieldClass === "professional_assessment" && (!canRecordProfessionalJudgement(context.role, context.canRecordSurvey) || !input.confirmProfessional)) return { kind: "invalid", message: "Professional assessments need explicit confirmation by a surveyor." };
    const [current] = await tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.fieldPath, proposal.fieldPath), isNull(surveyFieldValues.supersededAt))).limit(1);
    if ((current?.id ?? null) !== proposal.baseValueId) {
      await tx.update(fieldProposals).set({ reviewStatus: "superseded", reviewedAt: now, reviewNote: "The field changed after this suggestion was made." }).where(and(eq(fieldProposals.id, proposal.id), eq(fieldProposals.reviewStatus, "pending")));
      return { kind: "conflict", message: "The field changed after this suggestion was made, so it was not applied." };
    }
    const chosen = input.decision === "edit" ? input.value : (proposal.proposedValue as unknown as FieldValue);
    const validation = validateFieldValue(resolved.field, chosen);
    if (!validation.ok) return { kind: "invalid", message: validation.message };
    const evidence = proposal.evidenceRefs as unknown as EvidenceRef[];
    const [property] = await tx.select().from(properties).where(and(eq(properties.id, survey.propertyId), eq(properties.organisationId, context.organisationId))).for("share").limit(1);
    const snapshotIds = new Set(property ? (await currentSnapshots(tx, context.organisationId, property)).map(item => item.snapshotId) : []);
    const [inspectionDate] = await tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.fieldPath, "a.details.inspection_date"), isNull(surveyFieldValues.supersededAt))).limit(1);
    const weatherContext = property && inspectionDate ? `${inspectionDate.id}|${await propertyFingerprint(property)}` : null;
    if (evidence.some(ref => ["practitioner_profile", "firm_report_identity"].includes(ref.type))) {
      const identity = await reportIdentityEvidence(tx, context.organisationId, context.internalUserId);
      if (evidence.some(ref => ref.type === "practitioner_profile" && (ref.id !== context.internalUserId || ref.context !== identity.practitioner?.fingerprint) || ref.type === "firm_report_identity" && (ref.id !== context.organisationId || ref.context !== identity.firm?.fingerprint))) return { kind: "conflict", message: "Practitioner or firm report identity changed, or belongs to another practitioner. Load evidence again." };
    }
    for (const ref of evidence.filter(ref => ref.type === "document_span" && ref.context)) {
      const [document] = await tx.select().from(preinspectionDocuments).where(and(eq(preinspectionDocuments.id, ref.id), eq(preinspectionDocuments.organisationId, context.organisationId), eq(preinspectionDocuments.jobId, survey.jobId), eq(preinspectionDocuments.propertyId, survey.propertyId), isNull(preinspectionDocuments.supersededAt))).for("share").limit(1);
      const fingerprint = property ? await propertyFingerprint(property) : null;
      if (!document || document.associationFingerprint !== fingerprint || !document.associatedAt || ref.context !== `${document.checksum}|${fingerprint}|${document.associatedAt.toISOString()}`) return { kind: "conflict", message: "The document, works association or property identity changed. Load evidence again." };
    }
    if (evidence.some(ref => ref.type === "customer_submission")) {
      const [[latest], [settings], [organisation]] = await Promise.all([
        tx.select().from(preinspectionSubmissions).where(and(eq(preinspectionSubmissions.organisationId, context.organisationId), eq(preinspectionSubmissions.jobId, survey.jobId), eq(preinspectionSubmissions.propertyId, survey.propertyId))).orderBy(desc(preinspectionSubmissions.version)).limit(1),
        tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId, context.organisationId)).for("share").limit(1),
        tx.select().from(organisations).where(eq(organisations.id, context.organisationId)).for("share").limit(1),
      ]);
      const fingerprint = property ? await propertyFingerprint(property) : null;
      if (!settings?.surveyEvidenceEnabled || !organisation?.isDemo || !latest || evidence.some(ref => ref.type === "customer_submission" && (ref.id !== latest.id || ref.context !== fingerprint))) return { kind: "conflict", message: "Customer information, property identity or the evidence feature changed. Load evidence again." };
    }
    if (evidence.some(ref => ref.type === "intelligence_snapshot" && !snapshotIds.has(ref.id) || ref.type === "weather_record" && ref.id !== weatherContext)) return { kind: "conflict", message: "The source, inspection date or property identity changed. Load evidence again before applying this suggestion." };
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
