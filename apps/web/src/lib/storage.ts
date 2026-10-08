import { del, get, put } from "@vercel/blob";

/** Minimal private object storage used for survey photos and documents. */
export interface ObjectStorage {
  readonly name: string;
  put(key: string, body: ArrayBuffer, contentType: string): Promise<void>;
  /** `fresh` bypasses the provider cache; use it when a decision depends on the latest state, such as removal checks. */
  get(key: string, options?: { fresh?: boolean }): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string | null } | null>;
  remove(key: string): Promise<void>;
}

/** Vercel Blob with private access: objects are only readable through authenticated server routes. */
function vercelBlobStorage(token: string): ObjectStorage {
  return {
    name: "vercel-blob-private",
    async put(key, body, contentType) {
      await put(key, Buffer.from(body), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: false, token });
    },
    async get(key, options) {
      // Reads can be served from cache for up to 60 seconds after a change unless the cache is bypassed.
      const result = await get(key, { access: "private", token, ...(options?.fresh ? { useCache: false } : {}) });
      if (!result) return null;
      return { stream: result.stream as ReadableStream<Uint8Array>, contentType: result.blob.contentType ?? null };
    },
    async remove(key) {
      await del(key, { token });
    },
  };
}

/** In-memory storage for automated tests only. */
export function createMemoryStorage(): ObjectStorage & { objects: Map<string, { body: Uint8Array<ArrayBuffer>; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array<ArrayBuffer>; contentType: string }>();
  return {
    name: "memory",
    objects,
    async put(key, body, contentType) {
      if (objects.has(key)) throw new Error("Object already exists.");
      objects.set(key, { body: new Uint8Array(body), contentType });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { stream: new Blob([object.body]).stream(), contentType: object.contentType };
    },
    async remove(key) {
      objects.delete(key);
    },
  };
}

let override: ObjectStorage | null = null;

export function setObjectStorageForTests(storage: ObjectStorage | null) {
  override = storage;
}

/** Returns null when no store is configured; uploads are then disabled while text capture continues. */
export function getObjectStorage(): ObjectStorage | null {
  if (override) return override;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  return token ? vercelBlobStorage(token) : null;
}

export function maxUploadBytes() {
  const megabytes = Number(process.env.MEDIA_MAX_UPLOAD_MB ?? 25);
  return Math.max(1, Math.min(Number.isFinite(megabytes) ? megabytes : 25, 100)) * 1024 * 1024;
}
