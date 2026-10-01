import { and, eq, gt } from "drizzle-orm";
import { providerResponseCache, type Database } from "@surveynt/db";
import type { PublicCache } from "@surveynt/property-data";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Global cache for public-source responses. Keys are hashed and rows carry no
 * tenant identifiers; callers must only pass public inputs (postcodes,
 * coordinates, UPRNs), never tenant address text.
 */
export function databasePublicCache(db: Database): PublicCache {
  return {
    async getOrLoad(key, ttlDays, load, cacheable) {
      const sourceKey = key.split("|")[0] ?? "unknown";
      const cacheKey = await sha256(key);
      const [hit] = await db.select({ response: providerResponseCache.response }).from(providerResponseCache).where(and(eq(providerResponseCache.cacheKey, cacheKey), gt(providerResponseCache.expiresAt, new Date()))).limit(1);
      if (hit) return (hit.response as { value: unknown }).value as Awaited<ReturnType<typeof load>>;
      const value = await load();
      if (!cacheable(value)) return value;
      const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
      await db.insert(providerResponseCache).values({ cacheKey, sourceKey, response: { value } as Record<string, unknown>, expiresAt })
        .onConflictDoUpdate({ target: providerResponseCache.cacheKey, set: { response: { value } as Record<string, unknown>, retrievedAt: new Date(), expiresAt } });
      return value;
    },
  };
}
