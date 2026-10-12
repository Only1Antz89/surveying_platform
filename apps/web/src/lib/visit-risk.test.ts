import { describe, expect, it } from "vitest";
import { forecastRisks, visitExposure, visitWeatherAssessment, type DailyForecast } from "./visit-risk";

const day = (overrides: Partial<DailyForecast> = {}): DailyForecast => ({ date: "2026-10-20", precipitationSumMm: 0, precipitationProbabilityPercent: 5, windSpeedMaxKmh: 15, weatherCode: 1, temperatureMaxC: 14, temperatureMinC: 7, ...overrides });

describe("visit weather risk", () => {
  it("classifies exposure from the recorded service", () => {
    expect(visitExposure("Topographic land survey")).toBe("outdoor_critical");
    expect(visitExposure("Level 3 Building Survey")).toBe("external_elements");
    expect(visitExposure("Internal measured floor plan")).toBe("internal_mainly");
    expect(visitExposure("Valuation report")).toBe("internal_mainly");
    expect(visitExposure(null)).toBe("external_elements");
  });
  it("flags heavy rain, wind, storms, snow and frost from forecast values", () => {
    expect(forecastRisks(day())).toEqual([]);
    expect(forecastRisks(day({ precipitationSumMm: 32 })).map((flag) => flag.code)).toEqual(["heavy_rain"]);
    expect(forecastRisks(day({ precipitationProbabilityPercent: 85, precipitationSumMm: 3 })).map((flag) => flag.code)).toEqual(["likely_rain"]);
    expect(forecastRisks(day({ windSpeedMaxKmh: 62, weatherCode: 95, temperatureMinC: -2 })).map((flag) => flag.code)).toEqual(["strong_wind", "thunderstorm", "freezing"]);
    expect(forecastRisks(day({ weatherCode: 73 })).map((flag) => flag.code)).toEqual(["snow_or_ice"]);
  });
  it("tolerates missing forecast fields", () => {
    expect(forecastRisks(day({ precipitationSumMm: null, precipitationProbabilityPercent: null, windSpeedMaxKmh: null, weatherCode: null, temperatureMinC: null }))).toEqual([]);
  });
  it("rates torrential rain on a land survey as high and explains why", () => {
    const assessment = visitWeatherAssessment("Topographic land survey", day({ precipitationSumMm: 40, precipitationProbabilityPercent: 95 }));
    expect(assessment).toMatchObject({ exposure: "outdoor_critical", level: "high" });
    expect(assessment.considerations[0]).toContain("rearranging");
  });
  it("rates the same rain as elevated for a building survey and low for internal work", () => {
    expect(visitWeatherAssessment("Level 2 Home Survey", day({ precipitationSumMm: 40 })).level).toBe("elevated");
    expect(visitWeatherAssessment("Valuation report", day({ precipitationSumMm: 40 })).level).toBe("elevated");
    expect(visitWeatherAssessment("Valuation report", day({ precipitationSumMm: 6 })).level).toBe("low");
  });
});
