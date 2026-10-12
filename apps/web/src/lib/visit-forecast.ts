import "server-only";
import { enabledConnection } from "./platform-connections";
import { connectionJson } from "./connection-network";
import type { DailyForecast } from "./visit-risk";

export type VisitForecast =
  | { status: "available"; forecast: DailyForecast; source: string; retrievedAt: string; evaluationOnly: boolean }
  | { status: "not_configured" | "out_of_range" | "coordinates_unavailable" | "unavailable"; message: string };

const cache = new Map<string, { expires: number; value: VisitForecast }>();
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

/** Days from today (Europe/London) to the visit date; forecasts cover at most 16 days ahead. */
export function daysAhead(date: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Daily forecast for one visit, through the practice's governed weather connection. */
export async function visitForecast(organisationId: string, point: { latitude: number; longitude: number } | null, date: string): Promise<VisitForecast> {
  if (!point) return { status: "coordinates_unavailable", message: "The property has no confirmed location, so no forecast can be requested." };
  const ahead = daysAhead(date);
  if (ahead < 0 || ahead > 15) return { status: "out_of_range", message: "Forecasts are only available for visits in the next 16 days." };
  const selected = await enabledConnection(organisationId, "weather");
  if (!selected) return { status: "not_configured", message: "No weather connection is configured for this practice, so no forecast is available." };
  const key = `${organisationId}:${selected.connection.id}:${point.latitude.toFixed(2)}:${point.longitude.toFixed(2)}:${date}`;
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.value;
  let value: VisitForecast;
  try {
    const connection = selected.connection, secret = connection.credentialEnv ? process.env[connection.credentialEnv] : undefined;
    if (connection.credentialEnv && !secret) throw new Error("Credential unavailable");
    const raw = await connectionJson(connection.endpoint, "/v1/forecast", { query: { latitude: String(point.latitude), longitude: String(point.longitude), daily: "precipitation_sum,precipitation_probability_max,wind_speed_10m_max,weather_code,temperature_2m_max,temperature_2m_min", timezone: "Europe/London", start_date: date, end_date: date, ...(secret ? { apikey: secret } : {}) } }) as { daily?: Record<string, unknown[]> };
    const daily = raw.daily;
    if (!daily || !Array.isArray(daily.time) || daily.time[0] !== date) throw new Error("Invalid forecast");
    value = { status: "available", source: "Open-Meteo (CC BY 4.0)", retrievedAt: new Date().toISOString(), evaluationOnly: connection.evaluationOnly, forecast: {
      date, precipitationSumMm: number(daily.precipitation_sum?.[0]), precipitationProbabilityPercent: number(daily.precipitation_probability_max?.[0]), windSpeedMaxKmh: number(daily.wind_speed_10m_max?.[0]),
      weatherCode: number(daily.weather_code?.[0]), temperatureMaxC: number(daily.temperature_2m_max?.[0]), temperatureMinC: number(daily.temperature_2m_min?.[0]),
    } };
  } catch {
    value = { status: "unavailable", message: "The weather service did not return a usable forecast. Check again later." };
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { expires: Date.now() + 30 * 60_000, value });
  return value;
}
