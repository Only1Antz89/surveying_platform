import { describe,expect,it } from "vitest";
import { changedAccountProfileFields } from "./account-profile-audit";
const original={email:"owner@example.test",firstName:"Alex",lastName:null};
describe("account profile audit changes",()=>{
  it("records the synchronised fields for a new account",()=>expect(changedAccountProfileFields(null,original)).toEqual(["email","firstName","lastName"]));
  it("records only changed fields without duplicating personal values",()=>expect(changedAccountProfileFields(original,{...original,firstName:"Morgan"})).toEqual(["firstName"]));
  it("treats null and omitted optional names equally",()=>expect(changedAccountProfileFields(original,{...original,lastName:undefined})).toEqual([]));
});
