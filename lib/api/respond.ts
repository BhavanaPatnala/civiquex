import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

/** Wraps a route handler so every failure mode returns a clean, typed JSON error instead of a raw 500/undefined. */
export function withApiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AuthError) return fail(err.message, err.status);
      if (err instanceof ZodError) return fail("Invalid request", 422, err.flatten());
      if (err instanceof Error && err.message.includes("Record to update not found")) {
        return fail("Not found", 404);
      }
      console.error("[api] unhandled error", err);
      return fail("Internal error", 500);
    }
  };
}
