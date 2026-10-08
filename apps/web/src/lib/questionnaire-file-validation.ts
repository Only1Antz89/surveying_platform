export const questionnaireFileLimit = 10 * 1024 * 1024;
export function validQuestionnaireFile(bytes: Uint8Array, contentType: string) {
  if (bytes.length < 8 || bytes.length > questionnaireFileLimit) return false;
  if (contentType === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (contentType === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (contentType === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return false;
}

/** Limit the stream before multipart parsing, including requests without Content-Length. */
export async function boundedQuestionnaireForm(request: Request) {
  const limit = questionnaireFileLimit + 64 * 1024;
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > limit) throw new Error("upload_too_large");
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("upload_too_large"); }
      chunks.push(new Uint8Array(chunk.value));
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}
