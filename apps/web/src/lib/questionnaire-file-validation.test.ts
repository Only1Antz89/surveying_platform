import { describe, expect, it } from "vitest";
import { boundedQuestionnaireForm, questionnaireFileLimit, validQuestionnaireFile } from "./questionnaire-file-validation";
describe("private customer file validation", () => {
  it("checks content signatures and refuses unsupported, empty or oversized uploads", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\nfixture");
    expect(validQuestionnaireFile(pdf, "application/pdf")).toBe(true);
    expect(validQuestionnaireFile(pdf, "image/png")).toBe(false);
    expect(validQuestionnaireFile(new Uint8Array([137,80,78,71,13,10,26,10]), "image/png")).toBe(true);
    expect(validQuestionnaireFile(new Uint8Array([255,216,255,0,0,0,0,0]), "image/jpeg")).toBe(true);
    expect(validQuestionnaireFile(pdf, "text/html")).toBe(false);
    expect(validQuestionnaireFile(new Uint8Array(), "application/pdf")).toBe(false);
    expect(validQuestionnaireFile(new Uint8Array(questionnaireFileLimit + 1), "application/pdf")).toBe(false);
  });
  it("bounds requests with and without a declared size before parsing multipart data", async () => {
    await expect(boundedQuestionnaireForm(new Request("http://localhost", { method: "POST", body: "x", headers: { "content-length": String(questionnaireFileLimit + 100000) } }))).rejects.toThrow("upload_too_large");
    await expect(boundedQuestionnaireForm(new Request("http://localhost", { method: "POST", body: new Uint8Array(questionnaireFileLimit + 100000) }))).rejects.toThrow("upload_too_large");
    const form = new FormData(); form.set("file", new File(["%PDF-1.7"], "fixture.pdf", { type: "application/pdf" }));
    expect((await boundedQuestionnaireForm(new Request("http://localhost", { method: "POST", body: form }))).get("file")).toBeInstanceOf(File);
  });
});
