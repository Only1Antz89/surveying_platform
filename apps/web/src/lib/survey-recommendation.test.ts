import { describe,expect,it } from "vitest";
import { selectRecommendedService } from "./survey-adviser";
const service=(name:string,enabled:boolean)=>({service:{name},pricing:{recommendationRules:enabled?{source:"clifton_adviser_v1"}:{}}});
describe("configured recommendation eligibility",()=>{
  it("does not let an enabled service activate another service's rules",()=>{expect(selectRecommendedService([service("RICS Level 1 Survey",true),service("RICS Level 3 Survey",false)],{propertyAge:"pre-1950"})).toBeUndefined();});
  it("does not substitute a similarly named service with a different scope",()=>{expect(selectRecommendedService([service("RICS Level 2 Survey Only",true)],{purpose:"survey-and-valuation"})).toBeUndefined();});
  it("selects the matching opted-in service",()=>{const expected=service("RICS Level 3 Survey",true);expect(selectRecommendedService([expected],{propertyAge:"pre-1950"})).toBe(expected);});
});
