import { describe, expect, it } from "vitest";
import { mobileSessionSatisfied } from "./mobile-session";
import { twoStepSatisfied } from "./two-step-policy";
const legacy={sub:"user_1",org_id:"org_1",sid:"sess_1",fva:[5,0]};
describe("mobile MFA session binding",()=>{
 it("accepts verified legacy and v2 session claims for the same user/practice",()=>{
  expect(mobileSessionSatisfied(legacy,"user_1","org_1")).toBe(true);
  expect(mobileSessionSatisfied({sub:"user_1",v:2,o:{id:"org_1"},sid:"sess_1",sts:"active",fva:[8,3]},"user_1","org_1")).toBe(true);
 });
 it.each([null,{}, {...legacy,sid:undefined},{...legacy,sub:"user_2"},{...legacy,org_id:"org_2"},{...legacy,sts:"pending"},{...legacy,fva:undefined},{...legacy,fva:[5,-1]},{...legacy,fva:[5,Infinity]},{...legacy,fva:[5,"0"]},{...legacy,v:2,o:{id:"org_2"}},{...legacy,fva:[5,0,0]}])("rejects missing, mismatched or malformed session evidence %#",claims=>expect(mobileSessionSatisfied(claims,"user_1","org_1")).toBe(false));
 it("does not impose a new age cutoff, but rejects malformed ages",()=>{
  expect(twoStepSatisfied(true,[1440,1440])).toBe(true);
  for(const fva of [[0,NaN],[0,1.5],[0,0,0],[-1,0]])expect(twoStepSatisfied(true,fva)).toBe(false);
  expect(twoStepSatisfied(false,null)).toBe(true);
 });
});
