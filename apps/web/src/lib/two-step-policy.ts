// A practice can require two-step sign-in. Clerk reports, per session, how long ago each
// factor was verified; a negative second-factor age means this session did not use one.
export function twoStepSatisfied(required: boolean, factorVerificationAge: [number, number] | null | undefined) {
  if (!required) return true;
  return Array.isArray(factorVerificationAge) && typeof factorVerificationAge[1] === "number" && factorVerificationAge[1] >= 0;
}
export const twoStepAccountPath = "/account?two-step=required";
