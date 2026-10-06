import { describe, expect, it, vi } from "vitest";
import { inspectionWeather } from "./inspection-weather";

const input = { date: "2026-09-28", latitude: 51.5, longitude: -0.1 };
const now = new Date("2026-10-04T10:00:00Z");
const env = { INSPECTION_WEATHER_API_URL: "https://archive.example.com/v1/archive", INSPECTION_WEATHER_TERMS_APPROVED: "true" };
const body = { latitude: input.latitude, longitude: input.longitude, timezone: "Europe/London", daily_units: { temperature_2m_min: "°C", temperature_2m_max: "°C", precipitation_sum: "mm", wind_speed_10m_max: "km/h" }, daily: { time: [input.date], temperature_2m_min: [8], temperature_2m_max: [17], precipitation_sum: [3.2], wind_speed_10m_max: [22] } };

describe("historical inspection weather", () => {
  it("requires configuration/approval and never calls a public default", async () => {
    const fetchImpl = vi.fn();
    expect((await inspectionWeather(input, { env: {}, now, fetchImpl })).status).toBe("setup_required");
    expect((await inspectionWeather(input, { env: { ...env, INSPECTION_WEATHER_TERMS_APPROVED: "false" }, now, fetchImpl })).status).toBe("setup_required");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["2026-10-04", "2026-10-05", "2026-02-30", "not-a-date"])("rejects uncompleted/invalid date %s", async date => {
    const fetchImpl = vi.fn();
    expect((await inspectionWeather({ ...input, date }, { env, now, fetchImpl })).status).toBe("not_checked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("validates coordinates as a pair", async () => {
    expect((await inspectionWeather({ ...input, latitude: null }, { env, now })).status).toBe("not_checked");
    expect((await inspectionWeather({ ...input, longitude: 181 }, { env, now })).status).toBe("not_checked");
  });
  it("requests historical data for the correct London day with attribution and limitations", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
    const result = await inspectionWeather(input, { env, now, fetchImpl });
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.summary).toContain("Not observed inspection conditions");
      expect(result.attribution).toContain("CC BY 4.0");
    }
    const url = fetchImpl.mock.calls[0]?.[0] as URL | undefined;
    expect(url?.searchParams.get("timezone")).toBe("Europe/London");
    expect(url?.searchParams.get("start_date")).toBe(input.date);
    expect(url?.searchParams.has("forecast_days")).toBe(false);
  });
  it("returns manual fallback for outages, wrong dates, missing values and wrong units", async () => {
    for (const invalid of [{ ...body, latitude: -20 }, { ...body, timezone: "UTC" }, { ...body, daily: { ...body.daily, time: ["2026-09-27"] } }, { ...body, daily: { ...body.daily, precipitation_sum: [null] } }, { ...body, daily_units: { ...body.daily_units, precipitation_sum: "inch" } }]) {
      expect((await inspectionWeather(input, { env, now, fetchImpl: async () => new Response(JSON.stringify(invalid)) })).status).toBe("unavailable");
    }
    expect((await inspectionWeather(input, { env, now, fetchImpl: async () => { throw new Error("offline"); } })).status).toBe("unavailable");
  });
});
