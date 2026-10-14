import { Directory, File, Paths } from "expo-file-system";

// Site capture keeps working without signal. Each change is written to the device
// before anything is sent, photos are copied out of the camera cache, and items leave
// the queue only after the server confirms them. Survey operations carry their own ids,
// so a retried send is never applied twice; photo uploads are idempotent per client id.

export type QueueItem =
  | { id: string; kind: "sync"; surveyId: string; label: string; operations: unknown[]; createdAt: string; attempts: number; error?: string }
  | { id: string; kind: "photo"; surveyId: string; label: string; file: string; metadata: { clientGeneratedId: string; capturedAt: string; sectionKey: string; elementKey: string; note?: string }; createdAt: string; attempts: number; error?: string }
  | { id: string; kind: "room"; surveyId: string; label: string; body: Record<string, unknown>; createdAt: string; attempts: number; error?: string }
  | { id: string; kind: "cost"; jobId: string; label: string; body: Record<string, unknown>; createdAt: string; attempts: number; error?: string };
export type NewItem = QueueItem extends infer T ? T extends QueueItem ? Omit<T, "id" | "createdAt" | "attempts" | "error"> : never : never;
export type Sender = { json: (path: string, body: unknown) => Promise<unknown>; form: (path: string, form: FormData) => Promise<unknown> };

const scopeName = (scope: string) => scope.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "default";
const photos = () => { const dir = new Directory(Paths.document, "surveynt-photos"); if (!dir.exists) dir.create({ intermediates: true }); return dir; };
const queueFile = (scope: string) => new File(Paths.document, `surveynt-queue-${scopeName(scope)}.json`);
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Errors the server will not accept on retry (validation, permission, gone) stay on the device for review instead of blocking the queue. */
export class PermanentError extends Error {}

export function readQueue(scope: string): QueueItem[] {
  const file = queueFile(scope);
  if (!file.exists) return [];
  try { const items = JSON.parse(file.textSync()); return Array.isArray(items) ? items : []; } catch { return []; }
}
function writeQueue(scope: string, items: QueueItem[]) {
  const file = queueFile(scope);
  if (!file.exists) file.create();
  file.write(JSON.stringify(items));
}

export async function enqueue(scope: string, item: NewItem, photoUri?: string) {
  const id = newId("q");
  let entry = { ...item, id, createdAt: new Date().toISOString(), attempts: 0 } as QueueItem;
  if (entry.kind === "photo" && photoUri) {
    const target = new File(photos(), `${entry.metadata.clientGeneratedId}.jpg`);
    if (!target.exists) await new File(photoUri).copy(target);
    entry = { ...entry, file: target.uri };
  }
  writeQueue(scope, [...readQueue(scope), entry]);
  return entry;
}

export function discard(scope: string, id: string) {
  const items = readQueue(scope);
  const item = items.find((entry) => entry.id === id);
  if (item?.kind === "photo") { const file = new File(item.file); if (file.exists) file.delete(); }
  writeQueue(scope, items.filter((entry) => entry.id !== id));
}

/** Sends queued items in order. Stops at the first connection problem so order is kept; returns what is left. */
export async function flush(scope: string, send: Sender): Promise<{ sent: number; remaining: QueueItem[]; offline: boolean }> {
  let sent = 0, offline = false;
  for (const item of readQueue(scope)) {
    if (item.error) continue;
    try {
      if (item.kind === "sync") await send.json(`/api/mobile/surveys/${item.surveyId}/sync`, { operations: item.operations });
      else if (item.kind === "room") await send.json(`/api/mobile/surveys/${item.surveyId}/rooms`, item.body);
      else if (item.kind === "cost") await send.json(`/api/mobile/jobs/${item.jobId}/costs`, item.body);
      else {
        const form = new FormData();
        form.append("file", { uri: item.file, name: `${item.metadata.clientGeneratedId}.jpg`, type: "image/jpeg" } as unknown as Blob);
        form.append("metadata", JSON.stringify(item.metadata));
        await send.form(`/api/mobile/surveys/${item.surveyId}/media`, form);
      }
      discard(scope, item.id); sent++;
    } catch (error) {
      const items = readQueue(scope);
      const permanent = error instanceof PermanentError;
      writeQueue(scope, items.map((entry) => entry.id === item.id ? { ...entry, attempts: entry.attempts + 1, ...(permanent ? { error: (error as Error).message } : {}) } : entry));
      if (!permanent) { offline = true; break; }
    }
  }
  return { sent, remaining: readQueue(scope), offline };
}
