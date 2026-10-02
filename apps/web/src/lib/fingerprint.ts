import type { properties } from "@surveynt/db";
import { locationFingerprint, normaliseLocationConfidence, type PropertyLocation } from "@surveynt/property-data";

export function toLocation(property: typeof properties.$inferSelect): PropertyLocation {
  return { propertyId: property.id, country: property.country, uprn: property.uprn, latitude: property.latitude, longitude: property.longitude, locationConfidence: normaliseLocationConfidence(property.locationConfidence), postcode: property.postcode };
}

/** Identity fingerprint used to detect stale enrichment and proposals. Address text is excluded. */
export function propertyFingerprint(property: typeof properties.$inferSelect) {
  return locationFingerprint(toLocation(property));
}
