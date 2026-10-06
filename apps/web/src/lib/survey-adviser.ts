/** Shared deterministic rules. Only catalogues explicitly configured for these rules use them. */
export function recommendCliftonService(answers: Record<string, unknown>) {
  const purpose = String(answers.purpose ?? ""), age = String(answers.propertyAge ?? ""), type = String(answers.propertyType ?? ""), concerns = String(answers.concerns ?? "").toLowerCase();
  if (purpose === "formal-valuation") return { match: "Valuation Report", reason: "A formal independent valuation was requested rather than a building-condition survey." };
  if (purpose === "roof-only") return { match: "Drone Survey", reason: "A targeted inspection of inaccessible roof or high-level elements was requested." };
  if (age === "pre-1950" || age === "listed-historic" || answers.extensions === true || /damp|crack|structure/.test(concerns)) return { match: "RICS Level 3 Survey", reason: "The age, alterations or stated defect concerns indicate that a more detailed Level 3 inspection is proportionate." };
  if (purpose === "survey-and-valuation") return { match: "RICS Level 2 Survey", reason: "A combined condition survey and market valuation was requested for a conventional property." };
  if (type === "flat" && age === "post-1990" || age === "post-1990") return { match: "RICS Level 1 Survey", reason: "A concise condition report is proportionate for the stated modern, conventional property." };
  return { match: "RICS Level 2 Survey Only", reason: "A Level 2 survey provides balanced condition advice for the stated conventional property." };
}
export function quoteMoney(baseAmountMinor: number, vatBasisPoints: number, depositBasisPoints: number, surcharges: Array<{ amountMinor: number }>) {
  const surchargeMinor = surcharges.reduce((sum, value) => sum + value.amountMinor, 0), subtotalMinor = baseAmountMinor + surchargeMinor, vatMinor = Math.round(subtotalMinor * vatBasisPoints / 10_000), totalMinor = subtotalMinor + vatMinor;
  return { surchargeMinor, subtotalMinor, vatMinor, totalMinor, depositMinor: Math.round(totalMinor * depositBasisPoints / 10_000) };
}
