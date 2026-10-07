import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const worker=vi.hoisted(()=>vi.fn());
const enqueue=vi.hoisted(()=>vi.fn());
const googleEnqueue=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/calendar-subscription-queue",()=>({processCalendarSubscriptionQueue:worker,enqueueMicrosoftSubscriptionRenewals:enqueue,enqueueGoogleSubscriptionReplacements:googleEnqueue}));
import {GET} from "./route";
import {POST} from "../../queues/calendar-subscriptions/route";
beforeEach(()=>{worker.mockReset();enqueue.mockReset();enqueue.mockResolvedValue(0);googleEnqueue.mockReset();googleEnqueue.mockResolvedValue(0);vi.stubEnv("CRON_SECRET","fictional-cron");vi.stubEnv("QUEUE_CONSUMER_SECRET","fictional-queue");});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const request=(secret?:string)=>new Request("https://surveynt.test/api/cron/calendar-subscriptions",{headers:secret?{authorization:`Bearer ${secret}`}:{}});
describe("calendar cleanup delivery",()=>{
 it("requires the matching secret before dispatch",async()=>{
  for(const handler of [GET,POST])for(const secret of [undefined,"wrong"]){expect((await handler(request(secret))).status).toBe(401);}
  expect((await GET(request("fictional-queue"))).status).toBe(401);expect((await POST(request("fictional-cron"))).status).toBe(401);expect(worker).not.toHaveBeenCalled();expect(enqueue).not.toHaveBeenCalled();expect(googleEnqueue).not.toHaveBeenCalled();
 });
 it("fails closed when either configured secret is absent",async()=>{
  vi.stubEnv("CRON_SECRET","");vi.stubEnv("QUEUE_CONSUMER_SECRET","");expect((await GET(request())).status).toBe(401);expect((await POST(request())).status).toBe(401);expect(worker).not.toHaveBeenCalled();expect(enqueue).not.toHaveBeenCalled();expect(googleEnqueue).not.toHaveBeenCalled();
 });
 it("runs the bounded worker for cron and queue delivery",async()=>{
  worker.mockResolvedValue({configured:true,processed:1});for(const [handler,secret] of [[GET,"fictional-cron"],[POST,"fictional-queue"]] as const){const response=await handler(request(secret));expect(response.status).toBe(200);expect(await response.json()).toEqual({result:{configured:true,processed:1}});}expect(worker).toHaveBeenCalledTimes(2);expect(worker).toHaveBeenCalledWith(10,expect.any(Number));expect(enqueue).toHaveBeenCalledTimes(1);expect(googleEnqueue).toHaveBeenCalledTimes(1);
 });
 it("includes due-job enqueue time in the worker deadline",async()=>{
  let now=100000;vi.spyOn(Date,"now").mockImplementation(()=>now);
  enqueue.mockImplementation(async()=>{now+=20000;return 1;});worker.mockResolvedValue({configured:true,processed:0});
  expect((await GET(request("fictional-cron"))).status).toBe(200);expect(worker).toHaveBeenCalledWith(10,150000);
 });
 it("reports missing configuration without claiming success",async()=>{
  worker.mockResolvedValue({configured:false,processed:0});expect((await GET(request("fictional-cron"))).status).toBe(503);
 });
 it("keeps database errors and credentials out of responses",async()=>{
  worker.mockRejectedValue(new Error("private credential details"));const response=await GET(request("fictional-cron"));expect(response.status).toBe(503);expect(await response.text()).not.toContain("private credential");
 });
});
