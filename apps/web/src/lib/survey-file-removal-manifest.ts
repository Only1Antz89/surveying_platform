import { createHash } from "node:crypto";
import { z } from "zod";
import { surveyFileRetentionPolicy } from "./survey-file-retention";

const identity = z.uuid();
const common = { id: identity, storagePath: z.string().min(1).max(1000), checksum: z.string().regex(/^[a-f0-9]{64}$/i), sizeBytes: z.number().int().min(0).max(100 * 1024 * 1024) };
const object = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("document") }).strict(),
  z.object({ ...common, kind: z.literal("questionnaire") }).strict(),
  z.object({ ...common, kind: z.literal("media"), surveyId: identity, derivation: z.enum(["original", "annotated", "thumbnail", "redacted", "processed"]) }).strict(),
]);
const input = z.object({ organisationId: identity, jobId: identity, reviewVersion: z.string().regex(/^[a-f0-9]{64}$/), policyVersion: z.literal(surveyFileRetentionPolicy.version), objects: z.array(object).min(1).max(5000) }).strict();
export type SurveyFileRemovalObject = z.infer<typeof object>;
export type SurveyFileRemovalManifestInput = z.infer<typeof input>;

/** Server-built exact-object whitelist. Never accepts bucket prefixes, URLs or request-supplied paths. */
export function createSurveyFileRemovalManifest(value: SurveyFileRemovalManifestInput) {
  const parsed = input.parse(value);
  const paths = new Set<string>(); const records = new Set<string>();
  const objects = parsed.objects.map(entry => {
    const expected = entry.kind === "document"
      ? `organisations/${parsed.organisationId}/documents/${entry.id}/original`
      : entry.kind === "questionnaire"
        ? `organisations/${parsed.organisationId}/preinspection/${parsed.jobId}/${entry.id}/original`
        : `organisations/${parsed.organisationId}/surveys/${entry.surveyId}/${entry.id}/${entry.derivation}`;
    if (entry.storagePath !== expected) throw new Error("An original has an unverified storage binding; review its identity before removal.");
    const record = `${entry.kind}:${entry.id}`;
    if (records.has(record) || paths.has(entry.storagePath)) throw new Error("An original occurs more than once in the removal manifest.");
    records.add(record); paths.add(entry.storagePath);
    return { ...entry, checksum: entry.checksum.toLowerCase() };
  }).sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const manifest = { organisationId: parsed.organisationId, jobId: parsed.jobId, reviewVersion: parsed.reviewVersion, policyVersion: parsed.policyVersion, objects };
  return { ...manifest, manifestVersion: createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
}
