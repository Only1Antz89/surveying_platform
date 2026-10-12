import { NextResponse } from "next/server";
import type { ZodType } from "zod";

export function ok<T>(data: T, meta: Record<string, unknown> = {}) {
  return NextResponse.json({ data, meta });
}

export function problem(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function parseBody<T>(request: Request, schema: ZodType<T>) {
  const value: unknown = await request.json().catch(() => undefined);
  return schema.safeParse(value);
}

const recordId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stored records use UUIDs, so any other identifier cannot exist. Answering 404 here keeps
 * malformed URLs from reaching PostgreSQL, which rejects them as server errors. Local preview
 * uses readable fixture ids and is exempt.
 */
export function invalidId(context: { demo?: boolean } | null | undefined, ...ids: (string | undefined)[]) {
  if (context?.demo) return null;
  return ids.every((id) => id !== undefined && recordId.test(id)) ? null : problem(404, "not_found", "The record could not be found.");
}
