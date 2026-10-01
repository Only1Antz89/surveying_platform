import { randomUUID } from "node:crypto";
import { planningDataProvider, searchPostcode, validateProviderResult } from "../src/index";

async function main() {
  const postcodeCandidates = await searchPostcode("BS8 4JX");
  const postcode = postcodeCandidates[0];
  if (!postcode || postcode.country !== "ENG" || postcode.precision !== "postcode") throw new Error("Postcodes.io did not return the expected approximate England postcode candidate.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const planning = validateProviderResult(await planningDataProvider.fetch({ propertyId: randomUUID(), country: "ENG", latitude: postcode.latitude, longitude: postcode.longitude, address: "Development verification point, BS8 4JX", propertyVersion: 1 }, controller.signal));
    if (planning.status === "error" || planning.status === "unavailable") throw new Error(planning.safeError ?? "Planning Data live verification failed.");
    console.log(JSON.stringify({
      postcodesIo: { status: "matched", precision: postcode.precision, country: postcode.country, attributionPresent: postcode.attribution.length > 0 },
      planningData: { status: planning.status, recordCount: planning.records.length, coverage: planning.coverage, informationClass: planning.informationClass, licencePresent: planning.licence.length > 0, attributionPresent: planning.attribution.length > 0 },
      caveat: "A no_match result means no record was returned by this dataset query; it does not prove absence of constraints.",
    }, null, 2));
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
