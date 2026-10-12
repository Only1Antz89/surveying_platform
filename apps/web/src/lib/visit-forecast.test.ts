import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connection: vi.fn(), json: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./platform-connections", () => ({ enabledConnection: mocks.connection }));
vi.mock("./connection-network", () => ({ connectionJson: mocks.json }));
import { daysAhead, visitForecast } from "./visit-forecast";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const inDays = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(Date.now() + days * 86_400_000));
const point = { latitude: 51.48, longitude: -2.62 };

describe("visit forecast", () => {
  afterEach(() => vi.resetAllMocks());
  it("counts days ahead in Europe/London", () => { expect(daysAhead(today)).toBe(0); expect(daysAhead(inDays(3))).toBe(3); });
  it("never requests a forecast without coordinates, outside the forecast window or without a connection", async () => {
    expect(await visitForecast("org-a", null, today)).toMatchObject({ status: "coordinates_unavailable" });
    expect(await visitForecast("org-a", point, inDays(20))).toMatchObject({ status: "out_of_range" });
    expect(await visitForecast("org-a", point, inDays(-2))).toMatchObject({ status: "out_of_range" });
    mocks.connection.mockResolvedValue(null);
    expect(await visitForecast("org-a", point, today)).toMatchObject({ status: "not_configured" });
    expect(mocks.json).not.toHaveBeenCalled();
  });
  it("requests the visit day only and maps the daily values", async () => {
    const date = inDays(2);
    mocks.connection.mockResolvedValue({ connection: { id: "weather-1", endpoint: "https://weather.example", credentialEnv: null, evaluationOnly: false } });
    mocks.json.mockResolvedValue({ daily: { time: [date], precipitation_sum: [34.2], precipitation_probability_max: [96], wind_speed_10m_max: [41], weather_code: [65], temperature_2m_max: [12], temperature_2m_min: [7] } });
    const result = await visitForecast("org-b", point, date);
    expect(result).toMatchObject({ status: "available", forecast: { date, precipitationSumMm: 34.2, precipitationProbabilityPercent: 96, windSpeedMaxKmh: 41, weatherCode: 65 } });
    expect(mocks.json.mock.calls[0][2].query).toMatchObject({ start_date: date, end_date: date, timezone: "Europe/London" });
  });
  it("reports an unusable response instead of guessing", async () => {
    mocks.connection.mockResolvedValue({ connection: { id: "weather-2", endpoint: "https://weather.example", credentialEnv: null, evaluationOnly: false } });
    mocks.json.mockResolvedValue({ daily: { time: ["1999-01-01"] } });
    expect(await visitForecast("org-c", point, inDays(1))).toMatchObject({ status: "unavailable" });
    mocks.json.mockRejectedValue(new Error("Provider timed out."));
    expect(await visitForecast("org-d", point, inDays(1))).toMatchObject({ status: "unavailable" });
  });
});
