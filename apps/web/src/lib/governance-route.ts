import { ok, problem } from "./api";
import { GovernanceError } from "./ai-governance";

/** Maps governance refusals to problem responses. */
export async function governed<T>(work: () => Promise<T>) {
  try {
    return ok(await work());
  } catch (reason) {
    if (reason instanceof GovernanceError) return problem(reason.status, reason.code, reason.message);
    throw reason;
  }
}
