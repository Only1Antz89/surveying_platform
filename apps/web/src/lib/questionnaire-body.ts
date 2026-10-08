export const questionnaireBodyLimit = 64 * 1024;
export class QuestionnaireBodyError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Call only after customer-purpose or staff-assignment authorisation. */
export async function readQuestionnaireBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new QuestionnaireBodyError(415, "json_required", "Submit questionnaire answers as JSON.");
  const oversized = () => new QuestionnaireBodyError(413, "questionnaire_too_large", "The questionnaire request is too large.");
  if (Number(request.headers.get("content-length") ?? 0) > questionnaireBodyLimit) throw oversized();
  if (!request.body) throw new QuestionnaireBodyError(400, "invalid_questionnaire", "Submit questionnaire answers.");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > questionnaireBodyLimit) { await reader.cancel(); throw oversized(); }
      chunks.push(new Uint8Array(chunk.value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(await new Blob(chunks).text()) as unknown; }
  catch { throw new QuestionnaireBodyError(400, "invalid_questionnaire", "Submit valid questionnaire JSON."); }
}
