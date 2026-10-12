// Deterministic weather-risk flags for a planned inspection. The thresholds are
// operational prompts for planning, not professional or safety judgements; the
// surveyor decides whether to proceed, rearrange or adapt the method.

export type DailyForecast = {
  date: string;
  precipitationSumMm: number | null;
  precipitationProbabilityPercent: number | null;
  windSpeedMaxKmh: number | null;
  weatherCode: number | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
};

export type VisitExposure = "outdoor_critical" | "external_elements" | "internal_mainly";
export type RiskFlag = { code: "heavy_rain" | "likely_rain" | "strong_wind" | "thunderstorm" | "snow_or_ice" | "freezing"; message: string };

const outdoorCritical = /\b(land|topographic|topo|boundary|site|drone|uav|setting[- ]out|drainage|tree|arboricultural|ground)\b/i;
const externalElements = /\b(level\s*[23]|building survey|home survey|condition|defect|roof|commercial survey|dilapidation|schedule of condition|party wall)\b/i;

/** How much a visit depends on outdoor conditions, judged only from the recorded service name. */
export function visitExposure(serviceName: string | null | undefined): VisitExposure {
  if (!serviceName) return "external_elements";
  if (outdoorCritical.test(serviceName)) return "outdoor_critical";
  if (externalElements.test(serviceName)) return "external_elements";
  return "internal_mainly";
}

/** WMO weather interpretation codes used by Open-Meteo. */
const thunder = (code: number | null) => code !== null && code >= 95;
const snow = (code: number | null) => code !== null && ((code >= 71 && code <= 77) || code === 85 || code === 86 || code === 56 || code === 57 || code === 66 || code === 67);

export function forecastRisks(day: DailyForecast): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const rain = day.precipitationSumMm, chance = day.precipitationProbabilityPercent;
  if (rain !== null && rain >= 15) flags.push({ code: "heavy_rain", message: `Heavy rain forecast (${rain} mm in the day).` });
  else if ((chance !== null && chance >= 70) || (rain !== null && rain >= 5)) flags.push({ code: "likely_rain", message: `Rain likely${chance !== null ? ` (${chance}% chance)` : ""}${rain !== null ? `, about ${rain} mm` : ""}.` });
  if (day.windSpeedMaxKmh !== null && day.windSpeedMaxKmh >= 50) flags.push({ code: "strong_wind", message: `Strong wind forecast (gusting to about ${day.windSpeedMaxKmh} km/h).` });
  if (thunder(day.weatherCode)) flags.push({ code: "thunderstorm", message: "Thunderstorms forecast." });
  if (snow(day.weatherCode)) flags.push({ code: "snow_or_ice", message: "Snow, sleet or freezing rain forecast." });
  if (day.temperatureMinC !== null && day.temperatureMinC <= 0) flags.push({ code: "freezing", message: `Sub-zero temperatures forecast (low ${day.temperatureMinC} °C).` });
  return flags;
}

/** Combines forecast flags with the visit's exposure into planning guidance. */
export function visitWeatherAssessment(serviceName: string | null | undefined, day: DailyForecast) {
  const exposure = visitExposure(serviceName);
  const flags = forecastRisks(day);
  const severe = flags.some((flag) => ["heavy_rain", "strong_wind", "thunderstorm", "snow_or_ice"].includes(flag.code));
  const level = !flags.length ? "low" : severe && exposure === "outdoor_critical" ? "high" : severe || (flags.length && exposure === "outdoor_critical") ? "elevated" : "low";
  const considerations = !flags.length ? [] : exposure === "outdoor_critical"
    ? ["Outdoor measurement and access are weather-dependent: consider rearranging or confirming a fallback date with the client.", "Check site access, ground conditions and any equipment limits (for example drone or instrument operating conditions)."]
    : exposure === "external_elements"
      ? ["External elements (roofs, chimneys, gutters, walls) may be harder to inspect; record any limitation and consider a follow-up visit.", "Wet conditions can mask or exaggerate damp readings; note the weather at inspection."]
      : ["Mainly internal work: travel and access may still be affected."];
  return { exposure, level, flags, considerations };
}
