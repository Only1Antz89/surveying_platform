import { z } from "zod";
import type { UkCountry } from "@surveynt/domain";
import type { LicenceSnapshot } from "../contract";
import { normalisePostcode } from "../matching/identity";
import { providerFetchJson, withTransientRetry, type ProviderFetchOptions } from "../http/provider-fetch";

export const postcodesIoLicence: LicenceSnapshot = {
  name: "Open Government Licence v3.0 (ONS Postcode Directory and related products via Postcodes.io)",
  url: "https://postcodes.io/docs/licences/",
  attribution: "Contains OS data © Crown copyright and database right. Contains Royal Mail data © Royal Mail copyright and database right. Source: Office for National Statistics licensed under the Open Government Licence v3.0.",
  restrictions: ["Northern Ireland (BT) postcode data is licensed separately by Land & Property Services and is disabled until its terms are confirmed for this use."],
};

const countryNames: Record<string, UkCountry> = { England: "ENG", Wales: "WLS", Scotland: "SCT", "Northern Ireland": "NIR" };

const responseSchema = z.object({
  status: z.literal(200),
  result: z.object({
    postcode: z.string(),
    quality: z.number().int().nullable().optional(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    country: z.string().nullable(),
    region: z.string().nullable().optional(),
    admin_district: z.string().nullable().optional(),
    admin_ward: z.string().nullable().optional(),
    codes: z.object({ admin_district: z.string().nullable().optional() }).partial().optional(),
  }),
});

export type PostcodeLookup = {
  postcode: string;
  latitude: number;
  longitude: number;
  country: UkCountry | null;
  adminDistrict: string | null;
  adminDistrictCode: string | null;
  region: string | null;
  adminWard: string | null;
  positionalQuality: number | null;
};

export type PostcodeLookupResult =
  | { status: "matched"; result: PostcodeLookup }
  | { status: "no_match" | "unsupported" | "invalid"; message: string };

export type PostcodesIoConfig = Pick<ProviderFetchOptions, "fetchImpl" | "timeoutMs"> & { baseUrl?: string; allowNorthernIreland?: boolean };

export function postcodesIoBaseUrl(config: PostcodesIoConfig) {
  return new URL(config.baseUrl ?? "https://api.postcodes.io");
}

/** Looks up one postcode centroid. The centroid is approximate and never identifies a property. */
export async function lookupPostcode(input: string, config: PostcodesIoConfig = {}): Promise<PostcodeLookupResult> {
  const postcode = normalisePostcode(input);
  if (!postcode) return { status: "invalid", message: "Enter a full UK postcode." };
  if (postcode.startsWith("BT") && !config.allowNorthernIreland) return { status: "unsupported", message: "Northern Ireland postcode lookup is not enabled under the current data licence." };
  const base = postcodesIoBaseUrl(config);
  const url = new URL(`/postcodes/${encodeURIComponent(postcode.replace(" ", ""))}`, base);
  const response = await withTransientRetry(() => providerFetchJson(url, { allowedHosts: [base.hostname], timeoutMs: config.timeoutMs ?? 5000, maxBytes: 200_000, fetchImpl: config.fetchImpl, notFoundIsEmpty: true }));
  if (response.status === 404) return { status: "no_match", message: "That postcode was not found. It may be new or terminated." };
  const parsed = responseSchema.safeParse(response.body);
  if (!parsed.success) throw Object.assign(new Error("Postcodes.io returned an unexpected response."), { code: "invalid_response" });
  const result = parsed.data.result;
  if (result.latitude === null || result.longitude === null) return { status: "no_match", message: "That postcode has no published location." };
  return {
    status: "matched",
    result: {
      postcode: normalisePostcode(result.postcode) ?? postcode,
      latitude: result.latitude,
      longitude: result.longitude,
      country: result.country ? countryNames[result.country] ?? null : null,
      adminDistrict: result.admin_district ?? null,
      adminDistrictCode: result.codes?.admin_district ?? null,
      region: result.region ?? null,
      adminWard: result.admin_ward ?? null,
      positionalQuality: result.quality ?? null,
    },
  };
}
