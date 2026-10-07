import { describe,expect,it } from "vitest";
import { servicePricingInput } from "./service-pricing-input";
const pricing={name:"Fictional survey",baseAmountMinor:45000,durationMinutes:180};
describe("service pricing validation",()=>{
  it("validates supported alteration fees and supplies defaults",()=>{
    const input=servicePricingInput.parse({...pricing,surcharges:{"loft-conversion":{label:" Loft conversion ",amountMinor:10000}}});
    expect(input).toMatchObject({vatBasisPoints:2000,depositBasisPoints:1000,validityDays:7,surcharges:{"loft-conversion":{label:"Loft conversion",amountMinor:10000}}});
  });
  it("supports only registered recommendation rules",()=>{
    expect(servicePricingInput.parse({...pricing,recommendationRules:{source:"clifton_adviser_v1",reviewNote:"Retained metadata"}}).recommendationRules).toEqual({source:"clifton_adviser_v1",reviewNote:"Retained metadata"});
    expect(servicePricingInput.safeParse({...pricing,recommendationRules:{source:"unknown-engine"}}).success).toBe(false);
  });
  it("rejects invalid keys, missing labels, unsafe amounts and combined price overflow",()=>{
    for(const surcharges of [{"bad key":{label:"Fee",amountMinor:1}},{constructor:{label:"Fee",amountMinor:1}},{loft:{label:" ",amountMinor:1}},{loft:{label:"Fee",amountMinor:100000001}},{loft:{label:"Fee",amountMinor:100000000}}]) expect(servicePricingInput.safeParse({...pricing,surcharges}).success).toBe(false);
  });
});
