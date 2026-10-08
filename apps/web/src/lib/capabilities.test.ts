import {describe,expect,it} from "vitest";
import {calendarCapabilityState,type CalendarCapabilityConnection} from "./capabilities";
const now=Date.now(),healthy:CalendarCapabilityConnection={status:"active",lastError:null,webhookChannelId:"recorded",webhookExpiresAt:new Date(now+86400000)};
describe("calendar capability health",()=>{
 it("requires configuration and a connected account",()=>{expect(calendarCapabilityState(false,[healthy],now)).toBe("Setup required");expect(calendarCapabilityState(true,[],now)).toBe("Setup required");expect(calendarCapabilityState(true,[healthy],now)).toBe("Available");});
 it("reports missing, expired, unknown and errored active subscriptions",()=>{for(const changes of [{webhookChannelId:null},{webhookExpiresAt:null},{webhookExpiresAt:new Date(now)},{lastError:"private provider failure"}])expect(calendarCapabilityState(true,[{...healthy,...changes}],now)).toBe("Sync error");});
 it("checks every active account and does not let old revoked accounts hide a healthy connection",()=>{expect(calendarCapabilityState(true,[{...healthy,status:"revoked"},healthy],now)).toBe("Available");expect(calendarCapabilityState(true,[healthy,{...healthy,webhookChannelId:null}],now)).toBe("Sync error");expect(calendarCapabilityState(true,[{...healthy,status:"revoked"}],now)).toBe("Sync error");});
});
