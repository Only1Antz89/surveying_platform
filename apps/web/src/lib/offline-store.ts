"use client";

import type { SyncOperation } from "@surveynt/assistant";

// Device-local survey storage. Data stays in this browser profile until it is
// synced and the user removes the offline copy (or signs out). It relies on
// device and browser profile protection; see docs/assistant/offline.md.

export type OutboxStatus = "pending" | "conflict" | "rejected";
export type OutboxEntry = { operationId: string; surveyId: string; operation: SyncOperation; createdAt: string; status: OutboxStatus; message?: string; current?: Record<string, unknown> | null };
export type UploadEntry = { clientId: string; surveyId: string; blob: Blob; name: string; type: string; capturedAt: string | null; context: { sectionKey?: string; elementKey?: string; locationLabel?: string; caption?: string }; status: "pending" | "failed"; message?: string; createdAt: string };
export type StoredPack<T> = { surveyId: string; pack: T; savedAt: string };

const DB_VERSION = 1;
const RETENTION_DAYS = 30;
const stores = ["packs", "outbox", "uploads", "pointers"] as const;
type StoreName = (typeof stores)[number];

// One database per signed-in user and organisation, so another person using
// the same browser profile can never open this user's offline copies.
let scope = "unscoped";
const memories = new Map<string, Map<StoreName, Map<string, unknown>>>();
const openings = new Map<string, Promise<IDBDatabase | null>>();

export function setOfflineScope(next: string) {
  scope = next;
}

function memoryFor(store: StoreName) {
  if (!memories.has(scope)) memories.set(scope, new Map(stores.map((name) => [name, new Map()])));
  return memories.get(scope)!.get(store)!;
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  const existing = openings.get(scope);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(`surveynt-offline-${scope}`, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs", { keyPath: "surveyId" });
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "operationId" }).createIndex("surveyId", "surveyId");
      if (!db.objectStoreNames.contains("uploads")) db.createObjectStore("uploads", { keyPath: "clientId" }).createIndex("surveyId", "surveyId");
      if (!db.objectStoreNames.contains("pointers")) db.createObjectStore("pointers", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  openings.set(scope, opening);
  return opening;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(store: StoreName, value: Record<string, unknown>, key: string) {
  const db = await open();
  if (!db) return void memoryFor(store).set(key, value);
  const transaction = db.transaction(store, "readwrite");
  await requestResult(transaction.objectStore(store).put(value));
}

async function getValue<T>(store: StoreName, key: string) {
  const db = await open();
  if (!db) return (memoryFor(store).get(key) as T | undefined) ?? null;
  return ((await requestResult(db.transaction(store).objectStore(store).get(key))) as T | undefined) ?? null;
}

async function remove(store: StoreName, key: string) {
  const db = await open();
  if (!db) return void memoryFor(store).delete(key);
  await requestResult(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

async function bySurvey<T>(store: "outbox" | "uploads", surveyId: string) {
  const db = await open();
  if (!db) return [...memoryFor(store).values()].filter((value) => (value as { surveyId: string }).surveyId === surveyId) as T[];
  return (await requestResult(db.transaction(store).objectStore(store).index("surveyId").getAll(surveyId))) as T[];
}

export const offlineStore = {
  async savePack<T>(surveyId: string, pack: T) {
    await put("packs", { surveyId, pack, savedAt: new Date().toISOString() }, surveyId);
  },
  loadPack<T>(surveyId: string) {
    return getValue<StoredPack<T>>("packs", surveyId);
  },
  async rememberSurveyForJob(jobId: string, surveyId: string) {
    await put("pointers", { key: `job:${jobId}`, surveyId }, `job:${jobId}`);
  },
  async surveyForJob(jobId: string) {
    return (await getValue<{ surveyId: string }>("pointers", `job:${jobId}`))?.surveyId ?? null;
  },
  async enqueue(entry: OutboxEntry) {
    await put("outbox", entry as unknown as Record<string, unknown>, entry.operationId);
  },
  async outbox(surveyId: string) {
    return (await bySurvey<OutboxEntry>("outbox", surveyId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  removeOperation(operationId: string) {
    return remove("outbox", operationId);
  },
  async queueUpload(entry: UploadEntry) {
    await put("uploads", entry as unknown as Record<string, unknown>, entry.clientId);
  },
  uploads(surveyId: string) {
    return bySurvey<UploadEntry>("uploads", surveyId);
  },
  removeUpload(clientId: string) {
    return remove("uploads", clientId);
  },
  /** Removes every local trace of a survey. Callers must confirm before discarding unsynced work. */
  /** Removes device copies older than the retention period that have nothing left to sync. */
  async expireStalePacks() {
    const db = await open();
    if (!db) return 0;
    const packs = (await requestResult(db.transaction("packs").objectStore("packs").getAll())) as StoredPack<unknown>[];
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    let removed = 0;
    for (const pack of packs) {
      if (Date.parse(pack.savedAt) >= cutoff) continue;
      if ((await this.outbox(pack.surveyId)).length || (await this.uploads(pack.surveyId)).length) continue;
      await remove("packs", pack.surveyId);
      removed += 1;
    }
    return removed;
  },
  async clearSurvey(surveyId: string) {
    for (const entry of await this.outbox(surveyId)) await remove("outbox", entry.operationId);
    for (const entry of await this.uploads(surveyId)) await remove("uploads", entry.clientId);
    await remove("packs", surveyId);
  },
};

export function newOperationId() {
  return `op_${crypto.randomUUID().replace(/-/g, "")}`;
}
