import { z } from "zod";
import { providerFetchJson } from "../http/provider-fetch";
import { distanceMetres } from "../matching/identity";

export type InspectionWeatherInput = { date: string; latitude: number | null; longitude: number | null };
export type InspectionWeatherResult = { status: "available"; date: string; summary: string; retrievedAt: string; attribution: string; url: string } | { status: "setup_required" | "not_checked" | "unavailable"; message: string };
const responseSchema = z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timezone: z.literal("Europe/London"),
  daily_units: z.object({ temperature_2m_min: z.literal("°C"), temperature_2m_max: z.literal("°C"), precipitation_sum: z.literal("mm"), wind_speed_10m_max: z.literal("km/h") }),
  daily: z.object({ time: z.array(z.string()).length(1), temperature_2m_min: z.array(z.number().min(-90).max(60)).length(1), temperature_2m_max: z.array(z.number().min(-90).max(60)).length(1), precipitation_sum: z.array(z.number().min(0).max(2000)).length(1), wind_speed_10m_max: z.array(z.number().min(0).max(500)).length(1) }),
});

/** Explicit-submit archive lookup. Never substitutes a forecast for missing history.
 * Production needs an approved commercial or self-hosted endpoint; no public default.
 */
export async function inspectionWeather(input: InspectionWeatherInput, options: { env: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: Date }): Promise<InspectionWeatherResult> {
  const now = options.now ?? new Date();
  const parsedDate = new Date(`${input.date}T00:00:00Z`);
  const londonToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.date || input.date >= londonToday) return { status: "not_checked", message: "Save a completed inspection date. Today's conditions must be entered manually; archive data may lag several days." };
  if (input.latitude === null || input.longitude === null || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) return { status: "not_checked", message: "Confirm the property location before loading historical weather." };
  const endpoint = options.env.INSPECTION_WEATHER_API_URL;
  if (!endpoint || options.env.INSPECTION_WEATHER_TERMS_APPROVED !== "true") return { status: "setup_required", message: "Historical weather needs an approved provider configuration. Enter observed conditions manually." };
  try {
    const url = new URL(endpoint);
    url.searchParams.set("latitude", String(input.latitude)); url.searchParams.set("longitude", String(input.longitude));
    url.searchParams.set("start_date", input.date); url.searchParams.set("end_date", input.date);
    url.searchParams.set("timezone", "Europe/London"); url.searchParams.set("temperature_unit", "celsius"); url.searchParams.set("wind_speed_unit", "kmh"); url.searchParams.set("precipitation_unit", "mm");
    url.searchParams.set("daily", "temperature_2m_min,temperature_2m_max,precipitation_sum,wind_speed_10m_max");
    if (options.env.INSPECTION_WEATHER_API_KEY) url.searchParams.set("apikey", options.env.INSPECTION_WEATHER_API_KEY);
    const response = await providerFetchJson(url, { allowedHosts: [url.hostname], fetchImpl: options.fetchImpl, timeoutMs: 5000, maxBytes: 100_000 });
    const record = responseSchema.safeParse(response.body);
    if (!record.success || record.data.daily.time[0] !== input.date || record.data.daily.temperature_2m_min[0] > record.data.daily.temperature_2m_max[0] || distanceMetres({ latitude: input.latitude, longitude: input.longitude }, record.data) > 60_000) return { status: "unavailable", message: "No validated historical weather record is available for that date/location. Enter conditions manually." };
    const day = record.data.daily;
    return { status: "available", date: input.date, retrievedAt: now.toISOString(), attribution: "Open-Meteo historical reanalysis • CC BY 4.0", url: "https://open-meteo.com/en/docs/historical-weather-api", summary: `Historical modelled context for ${input.date} (Europe/London, whole day): temperature ${day.temperature_2m_min[0]}–${day.temperature_2m_max[0]}°C; precipitation ${day.precipitation_sum[0]} mm; maximum 10 m wind ${day.wind_speed_10m_max[0]} km/h. Not observed inspection conditions; confirm and edit for the actual visit.` };
  } catch {
    return { status: "unavailable", message: "Historical weather could not be checked. Manual recording is available; no forecast was substituted." };
  }
}
