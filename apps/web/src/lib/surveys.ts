import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  assistantTasks,
  auditEvents,
  createDatabase,
  evidenceLinks,
  fieldProposals,
  jobs,
  mediaAssets,
  observations,
  practicePackVersions,
  properties,
  propertyIntelligenceSnapshots,
  surveyElements,
  surveyFieldValues,
  surveys,
  syncOperations,
  withTenant,
  type TenantTransaction,
} from "@surveynt/db";
import {
  canonicalJson,
  defaultTemplate,
  getBuiltInTemplate,
  parseTemplate,
  reinspectTasksFromHistory,
  resolveElement,
  resolveField,
  serviceLevels,
  templateFingerprint,
  validateFieldValue,
  type FormTemplate,
  type ServiceLevel,
  type SyncOperation,
  type SyncResult,
} from "@surveynt/assistant";
import { canConfirmPropertyIdentity, type OrganisationRole, type UkCountry } from "@surveynt/domain";
import { assistantEnabled } from "./assistant-flags";
import { getObjectStorage, maxUploadBytes } from "./storage";

export type SurveyContext = { organisationId: string; internalUserId: string | null; role: OrganisationRole };

export class TemplateIntegrityError extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Professional assessments (ratings, opinions) are recorded only by roles that exercise professional judgement. */
export const canRecordProfessionalJudgement = canConfirmPropertyIdentity;

async function resolveTemplate(tx: TenantTransaction, key: string, version: string): Promise<FormTemplate | null> {
  const builtIn = getBuiltInTemplate(key, version);
  if (builtIn) return builtIn;
  const [row] = await tx.select({ definition: practicePackVersions.definition }).from(practicePackVersions)
    .where(and(eq(practicePackVersions.status, "published"), sql`${practicePackVersions.definition}->'form'->>'key' = ${key}`, sql`${practicePackVersions.definition}->'form'->>'version' = ${version}`)).limit(1);
  const parsed = row ? parseTemplate((row.definition as { form?: unknown }).form) : null;
  return parsed?.success ? parsed.data : null;
}

/** Loads the pinned template and refuses to continue if it no longer matches the recorded fingerprint. */
export async function pinnedTemplate(tx: TenantTransaction, survey: Pick<typeof surveys.$inferSelect, "templateKey" | "templateVersion" | "templateFingerprint">) {
  const template = await resolveTemplate(tx, survey.templateKey, survey.templateVersion);
  if (!template) throw new TemplateIntegrityError(`Template ${survey.templateKey}@${survey.templateVersion} is no longer available.`);
  if (await templateFingerprint(template) !== survey.templateFingerprint) throw new TemplateIntegrityError(`Template ${survey.templateKey}@${survey.templateVersion} has changed since this survey started.`);
  return template;
}

export type CreateSurveyInput = { serviceLevel: ServiceLevel; jurisdiction?: UkCountry; templateKey?: string; templateVersion?: string; clientGeneratedId?: string };

export async function createSurvey(context: SurveyContext, jobId: string, input: CreateSurveyInput) {
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.organisationId, context.organisationId))).limit(1);
    if (!job) return { kind: "missing" as const };
    const [existing] = await tx.select().from(surveys).where(and(eq(surveys.organisationId, context.organisationId), eq(surveys.jobId, jobId), ne(surveys.status, "withdrawn"))).limit(1);
    if (existing) return { kind: "existing" as const, survey: existing };
    const [property] = await tx.select().from(properties).where(and(eq(properties.id, job.propertyId), eq(properties.organisationId, context.organisationId))).limit(1);
    const jurisdiction = input.jurisdiction ?? property?.country ?? null;
    if (!jurisdiction) return { kind: "invalid" as const, message: "Set the property's country or choose the jurisdiction before starting the survey." };
    const template = input.templateKey && input.templateVersion ? await resolveTemplate(tx, input.templateKey, input.templateVersion) : defaultTemplate;
    if (!template) return { kind: "invalid" as const, message: "That form template is not published." };
    if (!template.jurisdictions.includes(jurisdiction)) return { kind: "invalid" as const, message: "That template does not cover the property's jurisdiction." };
    if (!template.serviceLevels.includes(input.serviceLevel)) return { kind: "invalid" as const, message: "That template does not support the selected service scope." };
    const [survey] = await tx.insert(surveys).values({
      organisationId: context.organisationId,
      jobId,
      propertyId: job.propertyId,
      templateKey: template.key,
      templateVersion: template.version,
      templateFingerprint: await templateFingerprint(template),
      serviceLevel: input.serviceLevel,
      jurisdiction,
      clientGeneratedId: input.clientGeneratedId ?? null,
      createdByUserId: context.internalUserId,
    }).returning();
    await refreshHistoryTasks(tx, context.organisationId, survey);
    await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.created", resourceType: "survey", resourceId: survey.id, metadata: { jobId, template: `${template.key}@${template.version}`, serviceLevel: input.serviceLevel } });
    return { kind: "created" as const, survey };
  });
}

/**
 * Same-property history comes only from this firm's records: the same property
 * record, or another record with the same surveyor-confirmed UPRN. A matching
 * address alone is never enough.
 */
async function refreshHistoryTasks(tx: TenantTransaction, organisationId: string, survey: typeof surveys.$inferSelect) {
  const [property] = await tx.select({ id: properties.id, uprn: properties.uprn }).from(properties).where(and(eq(properties.id, survey.propertyId), eq(properties.organisationId, organisationId))).limit(1);
  const relatedProperties = property?.uprn
    ? (await tx.select({ id: properties.id }).from(properties).where(and(eq(properties.organisationId, organisationId), or(eq(properties.id, property.id), and(eq(properties.uprn, property.uprn), sql`${properties.uprnConfirmedAt} is not null`))))).map((row) => row.id)
    : [survey.propertyId];
  const prior = await tx.select({ observation: observations, surveyCreatedAt: surveys.createdAt, sectionKey: surveyElements.sectionKey, elementKey: surveyElements.elementKey, locationLabel: surveyElements.locationLabel })
    .from(observations)
    .innerJoin(surveys, and(eq(observations.surveyId, surveys.id), eq(surveys.organisationId, organisationId)))
    .leftJoin(surveyElements, eq(observations.elementId, surveyElements.id))
    .where(and(eq(observations.organisationId, organisationId), inArray(surveys.propertyId, relatedProperties), ne(surveys.id, survey.id), eq(observations.kind, "current_observation"), eq(observations.status, "recorded")))
    .limit(200);
  if (!prior.length) return 0;
  const ratingPaths = prior.filter((row) => row.sectionKey && row.elementKey).map((row) => `${row.sectionKey}.${row.elementKey}.condition_rating`);
  const ratings = ratingPaths.length ? await tx.select({ surveyId: surveyFieldValues.surveyId, fieldPath: surveyFieldValues.fieldPath, value: surveyFieldValues.value }).from(surveyFieldValues).where(and(eq(surveyFieldValues.organisationId, organisationId), inArray(surveyFieldValues.fieldPath, ratingPaths), isNull(surveyFieldValues.supersededAt))) : [];
  const drafts = reinspectTasksFromHistory(prior.map((row) => {
    const rating = ratings.find((item) => item.surveyId === row.observation.surveyId && item.fieldPath === `${row.sectionKey}.${row.elementKey}.condition_rating`)?.value as { state?: string; value?: string } | undefined;
    return { id: row.observation.id, surveyId: row.observation.surveyId, surveyDate: row.surveyCreatedAt.toISOString().slice(0, 10), sectionKey: row.sectionKey, elementKey: row.elementKey, locationLabel: row.locationLabel || null, text: row.observation.text, conditionRating: rating?.state === "provided" ? String(rating.value) : null };
  }));
  for (const draft of drafts) {
    await tx.insert(assistantTasks).values({ organisationId, surveyId: survey.id, kind: draft.kind, dedupeKey: draft.dedupeKey, elementKey: draft.elementKey, title: draft.title, detail: draft.detail, evidence: draft.evidence }).onConflictDoNothing();
  }
  return drafts.length;
}

export async function loadSurveyPack(context: Pick<SurveyContext, "organisationId">, surveyId: string) {
  const db = createDatabase();
  return withTenant(db, context.organisationId, async (tx) => {
    const [row] = await tx.select({ survey: surveys, jobReference: jobs.reference, serviceName: jobs.serviceName, line1: properties.line1, city: properties.city, postcode: properties.postcode })
      .from(surveys).innerJoin(jobs, eq(surveys.jobId, jobs.id)).innerJoin(properties, eq(surveys.propertyId, properties.id))
      .where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    if (!row) return null;
    const template = await pinnedTemplate(tx, row.survey);
    const [elements, values, observationRows, media, evidence, tasks] = await Promise.all([
      tx.select().from(surveyElements).where(and(eq(surveyElements.surveyId, surveyId), eq(surveyElements.organisationId, context.organisationId))),
      tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, surveyId), eq(surveyFieldValues.organisationId, context.organisationId), isNull(surveyFieldValues.supersededAt))),
      tx.select().from(observations).where(and(eq(observations.surveyId, surveyId), eq(observations.organisationId, context.organisationId), eq(observations.status, "recorded"))).orderBy(asc(observations.createdAt)),
      tx.select({ id: mediaAssets.id, kind: mediaAssets.kind, contentType: mediaAssets.contentType, byteSize: mediaAssets.byteSize, width: mediaAssets.width, height: mediaAssets.height, capturedAt: mediaAssets.capturedAt, captureContext: mediaAssets.captureContext, derivation: mediaAssets.derivation, clientGeneratedId: mediaAssets.clientGeneratedId, createdAt: mediaAssets.createdAt }).from(mediaAssets).where(and(eq(mediaAssets.surveyId, surveyId), eq(mediaAssets.organisationId, context.organisationId), eq(mediaAssets.status, "stored"))),
      tx.select().from(evidenceLinks).where(and(eq(evidenceLinks.surveyId, surveyId), eq(evidenceLinks.organisationId, context.organisationId), isNull(evidenceLinks.removedAt))),
      tx.select().from(assistantTasks).where(and(eq(assistantTasks.surveyId, surveyId), eq(assistantTasks.organisationId, context.organisationId))).orderBy(asc(assistantTasks.createdAt)),
    ]);
    const proposals = assistantEnabled() ? await tx.select().from(fieldProposals).where(and(eq(fieldProposals.surveyId, surveyId), eq(fieldProposals.organisationId, context.organisationId), eq(fieldProposals.reviewStatus, "pending"))).orderBy(asc(fieldProposals.createdAt)) : [];
    return {
      survey: { id: row.survey.id, jobId: row.survey.jobId, propertyId: row.survey.propertyId, status: row.survey.status, serviceLevel: row.survey.serviceLevel as ServiceLevel, jurisdiction: row.survey.jurisdiction, templateKey: row.survey.templateKey, templateVersion: row.survey.templateVersion, version: row.survey.version, createdAt: row.survey.createdAt.toISOString() },
      job: { reference: row.jobReference, serviceName: row.serviceName },
      property: { line1: row.line1, city: row.city, postcode: row.postcode },
      template,
      elements: elements.map((item) => ({ id: item.id, sectionKey: item.sectionKey, elementKey: item.elementKey, locationLabel: item.locationLabel, inspectionStatus: item.inspectionStatus, limitationReason: item.limitationReason, version: item.version })),
      values: values.map((item) => ({ id: item.id, fieldPath: item.fieldPath, value: item.value, origin: item.origin, sourceKind: item.sourceKind, sourceRef: item.sourceRef, createdAt: item.createdAt.toISOString() })),
      observations: observationRows.map((item) => ({ id: item.id, elementId: item.elementId, kind: item.kind, text: item.text, structured: item.structured, locationLabel: item.locationLabel, origin: item.origin, observedAt: item.observedAt?.toISOString() ?? null, version: item.version, clientGeneratedId: item.clientGeneratedId })),
      media: media.map((item) => ({ ...item, capturedAt: item.capturedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() })),
      evidence: evidence.map((item) => ({ id: item.id, targetType: item.targetType, targetId: item.targetId, evidenceType: item.evidenceType, evidenceId: item.evidenceId, region: item.region, note: item.note })),
      tasks: tasks.map((item) => ({ id: item.id, kind: item.kind, status: item.status, title: item.title, detail: item.detail, elementKey: item.elementKey, fieldPath: item.fieldPath, evidence: item.evidence })),
      assistantEnabled: assistantEnabled(),
      proposals: proposals.map((item) => ({ id: item.id, fieldPath: item.fieldPath, proposedValue: item.proposedValue, originClass: item.originClass, evidenceRefs: item.evidenceRefs, limitations: item.limitations, baseValueId: item.baseValueId, createdAt: item.createdAt.toISOString() })),
    };
  });
}

export type SurveyPack = NonNullable<Awaited<ReturnType<typeof loadSurveyPack>>>;

class OperationOutcome extends Error {
  constructor(public readonly result: SyncResult) {
    super(result.status);
  }
}

const reject = (operationId: string, message: string): never => { throw new OperationOutcome({ operationId, status: "rejected", message }); };
const conflict = (operationId: string, message: string, current: Record<string, unknown> | null): never => { throw new OperationOutcome({ operationId, status: "conflict", message, current }); };

async function elementRow(tx: TenantTransaction, organisationId: string, surveyId: string, template: FormTemplate, operationId: string, reference: { sectionKey: string; elementKey: string; locationLabel: string }, userId: string | null) {
  const definition = resolveElement(template, reference.sectionKey, reference.elementKey);
  if (!definition) return reject(operationId, "That element is not part of this survey's template.");
  const [existing] = await tx.select().from(surveyElements).where(and(eq(surveyElements.surveyId, surveyId), eq(surveyElements.sectionKey, reference.sectionKey), eq(surveyElements.elementKey, reference.elementKey), eq(surveyElements.locationLabel, reference.locationLabel))).limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(surveyElements).values({ organisationId, surveyId, sectionKey: reference.sectionKey, elementKey: reference.elementKey, locationLabel: reference.locationLabel, updatedByUserId: userId }).returning();
  return created;
}

async function applyOperation(tx: TenantTransaction, context: SurveyContext, survey: typeof surveys.$inferSelect, template: FormTemplate, operation: SyncOperation): Promise<Record<string, unknown>> {
  const { operationId } = operation;
  switch (operation.type) {
    case "set_element": {
      const definition = resolveElement(template, operation.element.sectionKey, operation.element.elementKey);
      if (!definition) return reject(operationId, "That element is not part of this survey's template.");
      if (!definition.element.inspectable && operation.inspectionStatus) return reject(operationId, "Inspection status applies only to building elements.");
      const [existing] = await tx.select().from(surveyElements).where(and(eq(surveyElements.surveyId, survey.id), eq(surveyElements.sectionKey, operation.element.sectionKey), eq(surveyElements.elementKey, operation.element.elementKey), eq(surveyElements.locationLabel, operation.element.locationLabel))).limit(1);
      if (!existing) {
        if (operation.baseVersion !== null) return conflict(operationId, "This element was removed or never saved on the server.", null);
        const created = await elementRow(tx, context.organisationId, survey.id, template, operationId, operation.element, context.internalUserId);
        const [updated] = await tx.update(surveyElements).set({ inspectionStatus: operation.inspectionStatus, limitationReason: operation.limitationReason, updatedByUserId: context.internalUserId, updatedAt: new Date() }).where(eq(surveyElements.id, created.id)).returning();
        return { id: updated.id, version: updated.version, inspectionStatus: updated.inspectionStatus, limitationReason: updated.limitationReason };
      }
      if (operation.baseVersion !== existing.version) return conflict(operationId, "Someone else updated this element. Review the current status before saving yours.", { id: existing.id, version: existing.version, inspectionStatus: existing.inspectionStatus, limitationReason: existing.limitationReason });
      const [updated] = await tx.update(surveyElements).set({ inspectionStatus: operation.inspectionStatus, limitationReason: operation.limitationReason, updatedByUserId: context.internalUserId, version: existing.version + 1, updatedAt: new Date() }).where(and(eq(surveyElements.id, existing.id), eq(surveyElements.version, existing.version))).returning();
      if (!updated) return conflict(operationId, "Someone else updated this element at the same time.", null);
      return { id: updated.id, version: updated.version, inspectionStatus: updated.inspectionStatus, limitationReason: updated.limitationReason };
    }
    case "set_field": {
      const resolved = resolveField(template, operation.fieldPath);
      if (!resolved) return reject(operationId, "That field is not part of this survey's template.");
      if (resolved.field.fieldClass === "professional_assessment" && !canRecordProfessionalJudgement(context.role)) return reject(operationId, "Only surveyors, administrators and owners can record professional assessments.");
      const validation = validateFieldValue(resolved.field, operation.value);
      if (!validation.ok) return reject(operationId, validation.message);
      const [current] = await tx.select().from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, survey.id), eq(surveyFieldValues.fieldPath, resolved.path), isNull(surveyFieldValues.supersededAt))).limit(1);
      if ((current?.id ?? null) !== operation.baseValueId) return conflict(operationId, "This field changed since you last saw it. Compare the values before saving.", current ? { id: current.id, value: current.value, origin: current.origin, createdAt: current.createdAt.toISOString() } : null);
      if (current && canonicalJson(current.value) === canonicalJson(validation.value)) return { id: current.id, fieldPath: current.fieldPath, value: current.value, unchanged: true };
      if (current) await tx.update(surveyFieldValues).set({ supersededAt: new Date() }).where(eq(surveyFieldValues.id, current.id));
      const [created] = await tx.insert(surveyFieldValues).values({ organisationId: context.organisationId, surveyId: survey.id, fieldPath: resolved.path, value: validation.value as unknown as Record<string, unknown>, origin: "surveyor_entry", sourceKind: "manual", authorUserId: context.internalUserId, supersedesId: current?.id ?? null, correctionReason: operation.correctionReason ?? null, clientGeneratedId: operationId }).returning();
      return { id: created.id, fieldPath: created.fieldPath, value: created.value, supersedesId: created.supersedesId };
    }
    case "add_observation": {
      const element = operation.element ? await elementRow(tx, context.organisationId, survey.id, template, operationId, operation.element, context.internalUserId) : null;
      if (element && !resolveElement(template, element.sectionKey, element.elementKey)?.element.inspectable) return reject(operationId, "Observations attach to building elements only.");
      const [created] = await tx.insert(observations).values({
        organisationId: context.organisationId, surveyId: survey.id, elementId: element?.id ?? null, kind: operation.kind, text: operation.text,
        structured: operation.measurement ? { measurement: operation.measurement } : {}, locationLabel: operation.element?.locationLabel || null,
        observedAt: operation.observedAt ? new Date(operation.observedAt) : new Date(), authorUserId: context.internalUserId, clientGeneratedId: operationId,
        sourceKind: operation.kind === "client_claim" ? "client_statement" : "manual",
      }).returning();
      return { id: created.id, elementId: created.elementId, kind: created.kind, text: created.text, version: created.version, clientGeneratedId: created.clientGeneratedId };
    }
    case "revise_observation":
    case "withdraw_observation": {
      const [existing] = await tx.select().from(observations).where(and(eq(observations.id, operation.observationId), eq(observations.surveyId, survey.id), eq(observations.organisationId, context.organisationId))).limit(1);
      if (!existing || existing.status !== "recorded") return reject(operationId, "That observation is no longer current.");
      if (existing.version !== operation.baseVersion) return conflict(operationId, "This observation was changed by someone else.", { id: existing.id, text: existing.text, version: existing.version });
      if (operation.type === "withdraw_observation") {
        await tx.update(observations).set({ status: "withdrawn", version: existing.version + 1, updatedAt: new Date(), structured: { ...existing.structured, withdrawalReason: operation.reason } }).where(eq(observations.id, existing.id));
        return { id: existing.id, status: "withdrawn" };
      }
      await tx.update(observations).set({ status: "superseded", version: existing.version + 1, updatedAt: new Date() }).where(eq(observations.id, existing.id));
      const [revised] = await tx.insert(observations).values({ organisationId: context.organisationId, surveyId: survey.id, elementId: existing.elementId, kind: existing.kind, text: operation.text, structured: existing.structured, locationLabel: existing.locationLabel, origin: existing.origin, sourceKind: existing.sourceKind, sourceRef: existing.sourceRef, observedAt: existing.observedAt, authorUserId: context.internalUserId, supersedesId: existing.id, clientGeneratedId: operationId }).returning();
      // Evidence stays attached to the current version of the observation.
      const links = await tx.select().from(evidenceLinks).where(and(eq(evidenceLinks.targetType, "observation"), eq(evidenceLinks.targetId, existing.id), isNull(evidenceLinks.removedAt)));
      for (const link of links) {
        await tx.insert(evidenceLinks).values({ organisationId: context.organisationId, surveyId: survey.id, targetType: "observation", targetId: revised.id, evidenceType: link.evidenceType, evidenceId: link.evidenceId, region: link.region, note: link.note, createdByUserId: context.internalUserId, clientGeneratedId: `${operationId}:${link.id}` });
      }
      return { id: revised.id, supersedesId: existing.id, text: revised.text, version: revised.version };
    }
    case "link_evidence": {
      let targetId: string;
      if (operation.target.type === "element") {
        targetId = (await elementRow(tx, context.organisationId, survey.id, template, operationId, operation.target.element, context.internalUserId)).id;
      } else if (operation.target.type === "observation") {
        const reference = operation.target;
        const [observation] = await tx.select({ id: observations.id }).from(observations).where(and(eq(observations.surveyId, survey.id), eq(observations.organisationId, context.organisationId), reference.observationId ? eq(observations.id, reference.observationId) : eq(observations.clientGeneratedId, reference.observationOperationId!))).limit(1);
        if (!observation) return reject(operationId, "The observation to link was not found. Sync it first.");
        targetId = observation.id;
      } else {
        const [value] = await tx.select({ id: surveyFieldValues.id }).from(surveyFieldValues).where(and(eq(surveyFieldValues.surveyId, survey.id), eq(surveyFieldValues.fieldPath, operation.target.fieldPath), isNull(surveyFieldValues.supersededAt))).limit(1);
        if (!value) return reject(operationId, "Record the field before linking evidence to it.");
        targetId = value.id;
      }
      if (operation.evidence.type === "media") {
        const reference = operation.evidence.id;
        const matchesReference = uuidPattern.test(reference) ? or(eq(mediaAssets.id, reference), eq(mediaAssets.clientGeneratedId, reference)) : eq(mediaAssets.clientGeneratedId, reference);
        const [media] = await tx.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.organisationId, context.organisationId), eq(mediaAssets.propertyId, survey.propertyId), eq(mediaAssets.status, "stored"), matchesReference)).limit(1);
        if (!media) return reject(operationId, "The photo or document was not found for this property. Upload it first.");
        operation.evidence.id = media.id;
      } else if (operation.evidence.type === "observation") {
        const [observation] = await tx.select({ id: observations.id }).from(observations).where(and(eq(observations.surveyId, survey.id), eq(observations.organisationId, context.organisationId), eq(observations.id, operation.evidence.id))).limit(1);
        if (!observation) return reject(operationId, "The supporting observation was not found.");
      } else {
        // Binds the exact immutable snapshot relied on, so later refreshes never change what the survey cited.
        const [snapshot] = uuidPattern.test(operation.evidence.id) ? await tx.select({ id: propertyIntelligenceSnapshots.id }).from(propertyIntelligenceSnapshots).where(and(eq(propertyIntelligenceSnapshots.organisationId, context.organisationId), eq(propertyIntelligenceSnapshots.propertyId, survey.propertyId), eq(propertyIntelligenceSnapshots.id, operation.evidence.id))).limit(1) : [];
        if (!snapshot) return reject(operationId, "That intelligence record was not found for this property.");
      }
      const [link] = await tx.insert(evidenceLinks).values({ organisationId: context.organisationId, surveyId: survey.id, targetType: operation.target.type, targetId, evidenceType: operation.evidence.type, evidenceId: operation.evidence.id, region: operation.region ?? null, note: operation.note ?? null, createdByUserId: context.internalUserId, clientGeneratedId: operationId }).returning();
      return { id: link.id, targetType: link.targetType, targetId: link.targetId, evidenceType: link.evidenceType, evidenceId: link.evidenceId };
    }
  }
}

/**
 * Applies offline operations in order. Each operation commits on its own so one
 * conflict never discards unrelated work. Applied operations are recorded in a
 * ledger; replays return "duplicate" with the original record.
 */
export async function applySyncOperations(context: SurveyContext, surveyId: string, operations: SyncOperation[]) {
  const db = createDatabase();
  const results: SyncResult[] = [];
  for (const operation of operations) {
    try {
      const result = await withTenant(db, context.organisationId, async (tx) => {
        const [survey] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
        if (!survey) return reject(operation.operationId, "Survey not found.");
        const [ledger] = await tx.insert(syncOperations).values({ organisationId: context.organisationId, surveyId, operationId: operation.operationId, operationType: operation.type, appliedByUserId: context.internalUserId }).onConflictDoNothing().returning();
        if (!ledger) {
          const [previous] = await tx.select().from(syncOperations).where(and(eq(syncOperations.organisationId, context.organisationId), eq(syncOperations.operationId, operation.operationId))).limit(1);
          if (previous?.surveyId !== surveyId) return reject(operation.operationId, "That operation id was already used for another survey.");
          return { operationId: operation.operationId, status: "duplicate", record: previous.result } satisfies SyncResult;
        }
        if (survey.status !== "in_progress") return reject(operation.operationId, "This survey is no longer open for capture.");
        const template = await pinnedTemplate(tx, survey);
        const record = await applyOperation(tx, context, survey, template, operation);
        await tx.update(syncOperations).set({ result: record }).where(eq(syncOperations.id, ledger.id));
        return { operationId: operation.operationId, status: "applied", record } satisfies SyncResult;
      });
      results.push(result);
    } catch (reason) {
      if (reason instanceof OperationOutcome) results.push(reason.result);
      else throw reason;
    }
  }
  const applied = results.filter((result) => result.status === "applied").length;
  if (applied) {
    await withTenant(db, context.organisationId, (tx) => tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.synced", resourceType: "survey", resourceId: surveyId, metadata: { applied, total: results.length } }));
  }
  return results;
}

const photoTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const documentTypes = ["application/pdf"];

export type StoreMediaInput = { file: File; clientGeneratedId: string; capturedAt?: string | null; captureContext?: Record<string, unknown> };

/** Stores an immutable original. Idempotent per client id, so a retried upload never duplicates the file. */
export async function storeSurveyMedia(context: SurveyContext, surveyId: string, input: StoreMediaInput) {
  const storage = getObjectStorage();
  if (!storage) return { kind: "not_configured" as const, message: "Photo and document storage is not configured. Text capture continues to work." };
  const kind = photoTypes.includes(input.file.type) ? "photo" as const : documentTypes.includes(input.file.type) ? "document" as const : null;
  if (!kind) return { kind: "invalid" as const, message: "Upload a JPEG, PNG, WebP or HEIC photo, or a PDF document." };
  if (input.file.size > maxUploadBytes() || input.file.size === 0) return { kind: "invalid" as const, message: `Files must be between 1 byte and ${Math.round(maxUploadBytes() / 1048576)} MB.` };
  const db = createDatabase();
  const survey = await withTenant(db, context.organisationId, async (tx) => {
    const [row] = await tx.select().from(surveys).where(and(eq(surveys.id, surveyId), eq(surveys.organisationId, context.organisationId))).limit(1);
    const [duplicate] = row ? await tx.select().from(mediaAssets).where(and(eq(mediaAssets.organisationId, context.organisationId), eq(mediaAssets.clientGeneratedId, input.clientGeneratedId))).limit(1) : [];
    return { row, duplicate };
  });
  if (!survey.row) return { kind: "missing" as const };
  if (survey.duplicate) return { kind: "stored" as const, media: survey.duplicate, duplicate: true };
  if (survey.row.status !== "in_progress") return { kind: "invalid" as const, message: "This survey is no longer open for capture." };
  const body = await input.file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", body);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const mediaId = crypto.randomUUID();
  const storageKey = `organisations/${context.organisationId}/surveys/${surveyId}/${mediaId}/original`;
  await storage.put(storageKey, body, input.file.type);
  try {
    const media = await withTenant(db, context.organisationId, async (tx) => {
      const [created] = await tx.insert(mediaAssets).values({
        id: mediaId, organisationId: context.organisationId, propertyId: survey.row!.propertyId, surveyId, kind, storageKey, contentType: input.file.type, byteSize: input.file.size, sha256,
        originalFilename: input.file.name ? input.file.name.slice(0, 200) : null, capturedAt: input.capturedAt ? new Date(input.capturedAt) : null, captureContext: input.captureContext ?? {},
        uploadedByUserId: context.internalUserId, clientGeneratedId: input.clientGeneratedId,
      }).returning();
      await tx.insert(auditEvents).values({ organisationId: context.organisationId, actorUserId: context.internalUserId, action: "survey.media_stored", resourceType: "media_asset", resourceId: created.id, metadata: { surveyId, kind, byteSize: input.file.size } });
      return created;
    });
    return { kind: "stored" as const, media, duplicate: false };
  } catch (reason) {
    await storage.remove(storageKey).catch(() => undefined);
    throw reason;
  }
}

export async function readSurveyMedia(context: Pick<SurveyContext, "organisationId">, mediaId: string) {
  const storage = getObjectStorage();
  if (!storage) return null;
  const db = createDatabase();
  const [media] = await withTenant(db, context.organisationId, (tx) => tx.select().from(mediaAssets).where(and(eq(mediaAssets.id, mediaId), eq(mediaAssets.organisationId, context.organisationId), eq(mediaAssets.status, "stored"))).limit(1));
  if (!media) return null;
  const object = await storage.get(media.storageKey);
  return object ? { media, object } : null;
}

export const surveyServiceLevels = serviceLevels;
