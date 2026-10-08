import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTokensSchema,refreshCleanupTokens,CalendarSubscriptionError, stopCalendarSubscription } from "./calendar-subscription";
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("calendar subscription cleanup", () => {
  it("stops the exact Google channel and resource with bounded provider access", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetcher);
    await stopCalendarSubscription("google", "fictional-token", "channel", "resource");
    expect(fetcher).toHaveBeenCalledWith("https://www.googleapis.com/calendar/v3/channels/stop", expect.objectContaining({ method: "POST", redirect: "error", signal: expect.any(AbortSignal), body: JSON.stringify({ id: "channel", resourceId: "resource" }) }));
  });
  it("holds legacy Google channels without guessing their resource", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(stopCalendarSubscription("google", "token", "channel", null)).rejects.toMatchObject({ reviewRequired: true });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("encodes Microsoft subscription identity and accepts confirmed absence", async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(null, { status: 404 })); vi.stubGlobal("fetch", fetcher);
    await stopCalendarSubscription("microsoft", "token", "id/with?path", null);
    expect(fetcher.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/subscriptions/id%2Fwith%3Fpath");
    expect(fetcher.mock.calls[0][1].method).toBe("DELETE");
  });
  it.each([[401, true], [403, true], [429, false], [503, false]])("classifies status %i without exposing provider details", async (status, reviewRequired) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-provider-details", { status })));
    await expect(stopCalendarSubscription("microsoft", "private-token", "id", null)).rejects.toEqual(new CalendarSubscriptionError(reviewRequired));
  });
  it("makes uncertain network outcomes retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private-token")));
    await expect(stopCalendarSubscription("microsoft", "token", "id", null)).rejects.toMatchObject({ reviewRequired: false });
  });
  it("preserves historical unknown lifetimes without inventing metadata or refreshing",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    const tokens=cleanupTokensSchema.parse({access_token:"legacy-token"});expect(await refreshCleanupTokens("google",tokens)).toBe(tokens);expect(tokens).toEqual({access_token:"legacy-token"});expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not mistake asynchronous acceptance for confirmed cleanup",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:202})));await expect(stopCalendarSubscription("microsoft","token","channel",null)).rejects.toMatchObject({reviewRequired:true});
  });

  it("refreshes unknown lifetimes when a refresh credential is available",async()=>{
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID","fictional-client");vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET","fictional-secret");
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:"renewed-token",refresh_token:"rotated-refresh",expires_in:3600})));vi.stubGlobal("fetch",fetcher);
    const refreshed=await refreshCleanupTokens("google",cleanupTokensSchema.parse({access_token:"legacy-token",refresh_token:"legacy-refresh"}));
    expect(refreshed).toMatchObject({access_token:"renewed-token",refresh_token:"rotated-refresh",expires_in:3600,obtained_at:expect.any(Number)});expect(fetcher).toHaveBeenCalledTimes(1);
  });

});
