import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ context: { organisationId: "11111111-1111-4111-8111-111111111111", internalUserId: "manager", role: "owner", demo: false }, writable: true, taskDispose: vi.fn(), resume: vi.fn(), storage: {}, observe: vi.fn(), observationReview: vi.fn(), mediaDispose: vi.fn(), dispose: vi.fn(), request: vi.fn(), cancel: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/access", () => ({ apiContext: async () => state.context, canWriteWorkspace: () => state.writable }));
vi.mock("@/lib/workspace-api-guard", () => ({ workspaceApiGuard: async () => null }));
vi.mock("@/lib/survey-file-removal-request", () => ({ requestReviewedSurveyFileRemoval: state.request, cancelReviewedSurveyFileRemoval: state.cancel }));
vi.mock("@surveynt/db", () => ({ createDatabase: state.database, withTenant: async (_db: unknown, _org: string, callback: (tx: unknown) => unknown) => callback({}) }));
vi.mock("@/lib/survey-file-questionnaire-disposition", () => ({ disposeQuestionnaireAnalysis: state.dispose }));
vi.mock("@/lib/survey-file-media-analysis-disposition", () => ({ disposeMediaAnalysis: state.mediaDispose }));
vi.mock("@/lib/survey-file-removal-observation-review", () => ({ reviewRemovalObservation: state.observationReview }));
vi.mock("@/lib/survey-file-removal-recovery", () => ({ observeInterruptedSurveyFileOriginal: state.observe }));
vi.mock("@/lib/storage", () => ({ getObjectStorage: () => state.storage }));
vi.mock("@/lib/survey-file-removal-resume-runner", () => ({ processReviewedRemainingOriginals: state.resume }));
vi.mock("@/lib/survey-file-adviser-task-disposition", () => ({ disposeAdviserTask: state.taskDispose }));
import { POST } from "./route";
const id = "22222222-2222-4222-8222-222222222222";
const route = { params: Promise.resolve({ id }) };
const decision = { action: "request", requestId: id, reviewVersion: "a".repeat(64), reason: "Manager reviewed the removal decision.", confirmed: true };
const request = (body: unknown = decision) => new Request("http://surveynt.test/removals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); Object.assign(state.context, { role: "owner", demo: false }); state.writable = true; state.database.mockReturnValue({}); state.request.mockResolvedValue({ id, status: "queued", storageRemoved: false }); state.cancel.mockResolvedValue({ id, status: "cancelled" }); });
it("queues the reviewed decision without forwarding client storage paths", async () => {
  expect((await POST(request(), route)).status).toBe(200);
  expect(state.request).toHaveBeenCalledWith(expect.anything(), state.context.organisationId, id, "manager", { requestId: id, reviewVersion: decision.reviewVersion, reason: decision.reason, confirmed: true });
  expect((await POST(request({ ...decision, storagePath: "untrusted" }), route)).status).toBe(400);
});
it("routes cancellation to its current manifest binding", async () => {
  expect((await POST(request({ action: "cancel", id, manifestVersion: "b".repeat(64), reason: decision.reason, confirmed: true }), route)).status).toBe(200);
  expect(state.cancel).toHaveBeenCalledOnce(); expect(state.request).not.toHaveBeenCalled();
});
it("denies non-management and read-only writes", async () => {
  state.context.role = "surveyor"; expect((await POST(request(), route)).status).toBe(403);
  state.context.role = "owner"; state.writable = false; expect((await POST(request(), route)).status).toBe(403);
  expect(state.database).not.toHaveBeenCalled();
});
it("does not persist preview decisions or expose internal database errors", async () => {
  state.context.demo = true; expect((await (await POST(request(), route)).json()).data.persisted).toBe(false); expect(state.database).not.toHaveBeenCalled();
  state.context.demo = false; state.request.mockRejectedValue(new Error("private database details"));
  const response = await POST(request(), route); expect(response.status).toBe(409); expect(await response.text()).not.toContain("private database details");
});

it("binds analysis cleanup to the confirmed completed request without accepting storage paths", async () => {
  const body = { action: "dispose_analysis", id, documentId: id, manifestVersion: "b".repeat(64), reason: decision.reason, confirmed: true };
  state.dispose.mockResolvedValue({disposed:true,duplicate:false});
  expect((await POST(request(body),route)).status).toBe(200);
  expect(state.dispose).toHaveBeenCalledWith(expect.anything(),state.context.organisationId,id,"manager",id,{id,manifestVersion:body.manifestVersion,reason:body.reason,confirmed:true});
  expect((await POST(request({...body,storagePath:"untrusted"}),route)).status).toBe(400);
  expect((await POST(request({...body,confirmed:false}),route)).status).toBe(400);
});

it("routes confirmed media analysis cleanup and rejects unreviewed payloads", async () => {
  const body={action:"dispose_media_analysis",id,analysisId:id,manifestVersion:"b".repeat(64),reason:decision.reason,confirmed:true};
  state.mediaDispose.mockResolvedValue({disposed:true,duplicate:false});
  expect((await POST(request(body),route)).status).toBe(200);
  expect(state.mediaDispose).toHaveBeenCalledWith(expect.anything(),state.context.organisationId,id,"manager",id,{id,manifestVersion:body.manifestVersion,reason:body.reason,confirmed:true});
  expect((await POST(request({...body,storagePath:"untrusted"}),route)).status).toBe(400);
  expect((await POST(request({...body,confirmed:false}),route)).status).toBe(400);
});
it("keeps preview media cleanup nonpersistent and hides internal failure details", async () => {
  const body={action:"dispose_media_analysis",id,analysisId:id,manifestVersion:"b".repeat(64),reason:decision.reason,confirmed:true};
  state.context.demo=true;expect((await (await POST(request(body),route)).json()).data.persisted).toBe(false);expect(state.mediaDispose).not.toHaveBeenCalled();
  state.context.demo=false;state.mediaDispose.mockRejectedValue(new Error("private storage path"));
  const response=await POST(request(body),route);expect(response.status).toBe(409);expect(await response.text()).not.toContain("private storage path");
});

it("observes only server-selected originals after confirmed management review", async () => {
  state.observationReview.mockResolvedValue({ id, leaseToken: id, objects: [{ kind: "media", id }] });
  state.observe.mockResolvedValue({ removed: true, verificationRequired: true });
  const body = { action: "observe", id, manifestVersion: "b".repeat(64), reason: decision.reason, confirmed: true };
  const response = await POST(request(body), route);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ verificationRequired: true, deletionAuthorised: false });
  expect(state.observationReview).toHaveBeenCalledWith(expect.anything(), state.context.organisationId, id, "manager", { id, manifestVersion: body.manifestVersion, reason: body.reason, confirmed: true });
  expect(state.observe).toHaveBeenCalledWith(expect.anything(), state.context.organisationId, expect.anything(), `media:${id}`, state.storage);
  expect((await POST(request({ ...body, storagePath: "untrusted" }), route)).status).toBe(400);
  expect((await POST(request({ ...body, confirmed: false }), route)).status).toBe(400);
});
it("keeps preview outcome checks nonpersistent and hides recovery failures", async () => {
  const body = { action: "observe", id, manifestVersion: "b".repeat(64), reason: decision.reason, confirmed: true };
  state.context.demo = true;
  expect((await (await POST(request(body), route)).json()).data.persisted).toBe(false);
  expect(state.observationReview).not.toHaveBeenCalled(); expect(state.observe).not.toHaveBeenCalled();
  state.context.demo = false; state.observationReview.mockRejectedValue(new Error("private original path"));
  const response = await POST(request(body), route);
  expect(response.status).toBe(409); expect(await response.text()).not.toContain("private original path");
  expect(state.observe).not.toHaveBeenCalled();
});

it("resumes only a confirmed server-bound decision and preserves preview behaviour", async () => {
  const body={action:"resume",id,manifestVersion:"b".repeat(64),reason:decision.reason,confirmed:true};
  state.resume.mockResolvedValue({completed:false,verificationRequired:true,processed:25});
  expect((await POST(request(body),route)).status).toBe(200);
  expect(state.resume).toHaveBeenCalledWith(expect.anything(),state.context.organisationId,id,"manager",{id,manifestVersion:body.manifestVersion,reason:body.reason,confirmed:true},state.storage);
  expect((await POST(request({...body,storagePath:"untrusted"}),route)).status).toBe(400);
  expect((await POST(request({...body,confirmed:false}),route)).status).toBe(400);
  state.context.demo=true;state.resume.mockClear();
  expect((await (await POST(request(body),route)).json()).data.persisted).toBe(false);expect(state.resume).not.toHaveBeenCalled();
});

it("binds confirmed task cleanup without accepting paths or preview persistence", async () => {
 const body={action:"dispose_task",id,taskId:id,manifestVersion:"b".repeat(64),reason:decision.reason,confirmed:true};
 state.taskDispose.mockResolvedValue({disposed:true,duplicate:false});
 expect((await POST(request(body),route)).status).toBe(200);
 expect(state.taskDispose).toHaveBeenCalledWith(expect.anything(),state.context.organisationId,id,"manager",id,{id,manifestVersion:body.manifestVersion,reason:body.reason,confirmed:true});
 expect((await POST(request({...body,confirmed:false}),route)).status).toBe(400);
 expect((await POST(request({...body,storagePath:"untrusted"}),route)).status).toBe(400);
 state.context.demo=true;state.taskDispose.mockClear();expect((await (await POST(request(body),route)).json()).data.persisted).toBe(false);expect(state.taskDispose).not.toHaveBeenCalled();
});
