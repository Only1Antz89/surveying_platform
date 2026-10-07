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
