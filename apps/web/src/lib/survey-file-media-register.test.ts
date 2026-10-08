import { expect, it } from "vitest";
import type { TenantTransaction } from "@surveynt/db";
import { readSurveyFileMedia } from "./survey-file-media-register";
function transaction(captureContext: Record<string, unknown>) {
 const rows: unknown[][] = [[{id:"survey"}],[],[{id:"media",surveyId:"survey",checksum:"a".repeat(64),byteSize:4,kind:"photo",filename:"photo.jpg",captureContext,status:"stored",deletedAt:null,parentId:null,derivation:"original",clientGeneratedId:"media-client"}],[],[],[]];
 return {select:()=>{const result=rows.shift();const chain={from:()=>chain,where:()=>chain,orderBy:()=>chain,limit:async()=>result};return chain;}} as unknown as TenantTransaction;
}
it("binds capture context to file review without exposing its private payload",async()=>{
 const first=await readSurveyFileMedia(transaction({locationLabel:"private room",note:"private capture context"}),"org","job",[]);
 const second=await readSurveyFileMedia(transaction({locationLabel:"private changed room",note:"private capture context"}),"org","job",[]);
 expect(first.media[0].captureContextFingerprint).not.toBe(second.media[0].captureContextFingerprint);
 expect(JSON.stringify(first)).not.toContain("private");
 expect(first.media[0]).toMatchObject({id:"media",checksum:"a".repeat(64),filename:"photo.jpg"});
 expect(first.referenceReviewRequired).toBe(false);
});
