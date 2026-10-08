import { describe, expect, it } from "vitest";
import { createSurveyFileRemovalManifest, type SurveyFileRemovalManifestInput } from "./survey-file-removal-manifest";
const organisationId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const surveyId = "00000000-0000-4000-8000-000000000004";
const checksum = "A".repeat(64);
const base: SurveyFileRemovalManifestInput = { organisationId, jobId, reviewVersion: "a".repeat(64), policyVersion: "survey-file-1-year-v2", objects: [
  { kind: "document", id, storagePath: `organisations/${organisationId}/documents/${id}/original`, checksum, sizeBytes: 4 },
  { kind: "questionnaire", id, storagePath: `organisations/${organisationId}/preinspection/${jobId}/${id}/original`, checksum, sizeBytes: 4 },
  { kind: "media", id, surveyId, derivation: "original", storagePath: `organisations/${organisationId}/surveys/${surveyId}/${id}/original`, checksum, sizeBytes: 4 },
] };
describe("survey file removal manifest", () => {
  it("binds every store and normalises input order and checksums", () => {
    const first = createSurveyFileRemovalManifest(base);
    expect(first.objects).toHaveLength(3); expect(first.objects.every(entry => entry.checksum === checksum.toLowerCase())).toBe(true);
    expect(createSurveyFileRemovalManifest({ ...base, objects: [...base.objects].reverse() }).manifestVersion).toBe(first.manifestVersion);
  });
  it("rejects foreign, prefix, URL, traversal and mismatched-record paths", () => {
    for (const storagePath of ["organisations/foreign/documents/original", `organisations/${organisationId}/documents/`, "https://example.test/blob", `${base.objects[0].storagePath}/../other`, base.objects[1].storagePath]) {
      expect(() => createSurveyFileRemovalManifest({ ...base, objects: [{ ...base.objects[0], storagePath }] })).toThrow();
    }
    expect(() => createSurveyFileRemovalManifest({ ...base, jobId: surveyId })).toThrow();
  });
  it("rejects duplicate originals and empty, oversize or unverifiable manifests", () => {
    expect(() => createSurveyFileRemovalManifest({ ...base, objects: [base.objects[0], base.objects[0]] })).toThrow("more than once");
    expect(() => createSurveyFileRemovalManifest({ ...base, objects: [] })).toThrow();
    for (const change of [{ checksum: "legacy" }, { sizeBytes: -1 }, { sizeBytes: 100 * 1024 * 1024 + 1 }]) expect(() => createSurveyFileRemovalManifest({ ...base, objects: [{ ...base.objects[0], ...change }] })).toThrow();
  });
  it("invalidates binding when review, checksum, size or object membership changes", () => {
    const previous = createSurveyFileRemovalManifest(base).manifestVersion;
    expect(createSurveyFileRemovalManifest({ ...base, reviewVersion: "b".repeat(64) }).manifestVersion).not.toBe(previous);
    expect(createSurveyFileRemovalManifest({ ...base, objects: [{ ...base.objects[0], checksum: "b".repeat(64) }] }).manifestVersion).not.toBe(previous);
    expect(createSurveyFileRemovalManifest({ ...base, objects: [{ ...base.objects[0], sizeBytes: 5 }] }).manifestVersion).not.toBe(previous);
  });
  it("binds derived media to its exact identity and derivation namespace", () => {
    const derived: SurveyFileRemovalManifestInput = { ...base, objects: [{ kind: "media", id, surveyId, derivation: "thumbnail", checksum, sizeBytes: 2, storagePath: `organisations/${organisationId}/surveys/${surveyId}/${id}/thumbnail` }] };
    expect(createSurveyFileRemovalManifest(derived).objects[0].kind).toBe("media");
    expect(() => createSurveyFileRemovalManifest({ ...derived, objects: [{ ...derived.objects[0], storagePath: base.objects[2].storagePath }] })).toThrow();
  });
});
