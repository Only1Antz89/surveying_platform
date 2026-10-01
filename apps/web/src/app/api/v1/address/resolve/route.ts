import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, parseBody, problem } from "@/lib/api";
import { findNearbyUprns, resolveAddressCandidate } from "@/lib/property-intelligence";

const candidateSchema = z.object({
  providerKey: z.enum(["postcodes_io", "nominatim"]),
  sourceRecordId: z.string().min(1).max(100),
  displayLabel: z.string().min(1).max(500),
  line1: z.string().max(180),
  line2: z.string().max(180).nullable(),
  city: z.string().max(100),
  postcode: z.string().max(10),
  country: z.literal("ENG"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  precision: z.enum(["address", "street", "postcode", "place"]),
  attribution: z.string().min(1).max(300),
});

export async function POST(request: Request) {
  const context = await apiContext(request);
  if (!context) return problem(401, "unauthorised", "Authentication and an active organisation are required.");
  const parsed = await parseBody(request, candidateSchema);
  if (!parsed.success) return problem(400, "invalid_candidate", "The selected address candidate is invalid.", parsed.error.flatten());
  const uprns = context.demo ? [] : await findNearbyUprns(parsed.data.latitude, parsed.data.longitude);
  return ok(resolveAddressCandidate(parsed.data, uprns), { demo: context.demo });
}
