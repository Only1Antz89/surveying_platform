import {expect,it} from "vitest";
import {workloadHeadroom,orderSurveyorCapacity,type SurveyorCapacity} from "./surveyor-capacity";
it("does not label undeclared capacity as availability",()=>expect(workloadHeadroom({activeJobs:0,capacityJobs:null})).toBeNull());
it("clamps headroom at zero for full or overallocated workloads",()=>{
 expect(workloadHeadroom({activeJobs:2,capacityJobs:5})).toBe(3);
 expect(workloadHeadroom({activeJobs:5,capacityJobs:5})).toBe(0);
 expect(workloadHeadroom({activeJobs:6,capacityJobs:5})).toBe(0);
});
it("puts greatest known headroom first and preserves its inputs",()=>{
 const make=(id:string,activeJobs:number,capacityJobs:number|null):SurveyorCapacity=>({id,name:id,initials:id,activeJobs,capacityJobs,inspectionsToday:0,services:[],base:null});
 const people=[make("unknown",0,null),make("full",5,5),make("free",2,5),make("more",1,5)];
 expect(orderSurveyorCapacity(people).map(person=>person.id)).toEqual(["more","free","full","unknown"]);
 expect(people[0].id).toBe("unknown");
});
