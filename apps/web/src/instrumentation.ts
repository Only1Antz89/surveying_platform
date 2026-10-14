import type { Instrumentation } from "next";

// Captures uncaught server errors into Surveynt's own error log (Platform → Health).
// A hosted monitoring service can be added here later without changing callers.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordServerError } = await import("./lib/error-reporting");
  await recordServerError(error, request, context);
};
