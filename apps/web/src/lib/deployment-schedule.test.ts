import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
const config=JSON.parse(readFileSync(new URL("../../../../vercel.json",import.meta.url),"utf8")) as {crons:{path:string;schedule:string}[]};
describe("current Hobby deployment schedule",()=>{
 it("uses only daily schedules while frequent calendar processing is paused",()=>{for(const cron of config.crons)expect(cron.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);});
 it("retains the daily calendar lifecycle fallback",()=>{expect(config.crons.find(row=>row.path==="/api/cron/calendar-subscriptions")?.schedule).toBe("15 8 * * *");});
});
