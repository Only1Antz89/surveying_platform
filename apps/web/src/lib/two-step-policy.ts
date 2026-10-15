// A practice can require two-step sign-in. Clerk reports, per session, how long ago each
// factor was verified; a negative second-factor age means this session did not use one.
export function twoStepSatisfied(required: boolean, factorVerificationAge: unknown) {
  if (!required) return true;
  return Array.isArray(factorVerificationAge) && factorVerificationAge.length === 2 && factorVerificationAge.every(age => typeof age === "number" && Number.isSafeInteger(age)) && factorVerificationAge[0] >= 0 && factorVerificationAge[1] >= 0;
}
export const twoStepAccountPath = "/account?two-step=required";
