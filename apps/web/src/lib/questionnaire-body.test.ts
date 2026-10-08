import { describe, expect, it } from "vitest";
import { questionnaireBodyLimit, readQuestionnaireBody } from "./questionnaire-body";

const request = (body: string, headers: Record<string, string> = {}) => new Request("http://localhost/questionnaire", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
describe("bounded questionnaire JSON", () => {
  it("accepts valid JSON including a charset", async () => {
    expect(await readQuestionnaireBody(request('{"answers":{"concerns":"Review damp"}}', { "content-type": "application/json; charset=utf-8" }))).toEqual({ answers: { concerns: "Review damp" } });
  });
  it("rejects malformed JSON and non-JSON content", async () => {
    await expect(readQuestionnaireBody(request("{"))).rejects.toMatchObject({ status: 400 });
    await expect(readQuestionnaireBody(request("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
  });
  it("bounds bodies without Content-Length and rejects oversized declared bodies", async () => {
    await expect(readQuestionnaireBody(request("x".repeat(questionnaireBodyLimit + 1)))).rejects.toMatchObject({ status: 413 });
    await expect(readQuestionnaireBody(request("{}", { "content-length": String(questionnaireBodyLimit + 1) }))).rejects.toMatchObject({ status: 413 });
  });
  it("counts bytes rather than characters", async () => {
    await expect(readQuestionnaireBody(request(JSON.stringify({ text: "£".repeat(questionnaireBodyLimit / 2) })))).rejects.toMatchObject({ status: 413 });
  });
});
