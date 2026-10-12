import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homeSurveyTemplatesV1_1, listFields } from "@surveynt/assistant";
import { centralCatalogueSchema, centralRicsTemplate } from "./rics-template-catalogue";
const template=homeSurveyTemplatesV1_1[0];
const document=await PDFDocument.create();const page=document.addPage();
[...listFields(template)].filter(item=>item.field.reportUse==="report").forEach((_,index)=>document.getForm().createTextField(`field-${index}`).addToPage(page,{x:10,y:10,width:100,height:30}));
const bytes=Buffer.from(await document.save());
const entry={templateKey:template.key,templateVersion:template.version,pdfFile:"level-1.pdf",sha256:createHash("sha256").update(bytes).digest("hex"),supplier:"Test supplier",distributionAuthorisationReference:"Test reference",professionallyReviewedBy:"Test reviewer",reviewedOn:"2026-10-11",definition:{version:1,appendPhotographs:true,bindings:[...listFields(template)].filter(item=>item.field.reportUse==="report").map((item,index)=>({source:{kind:"field",path:item.path},target:{kind:"form_field",name:`field-${index}`,fontSize:10}}))}};
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function fixture(value=entry) {const dir=await mkdtemp(join(tmpdir(),"surveyant-catalogue-"));directories.push(dir);await writeFile(join(dir,"catalogue.json"),JSON.stringify({templates:[value]}));await writeFile(join(dir,"level-1.pdf"),bytes);return dir;}
describe("platform-managed RICS catalogue",()=>{
  it("has no output when no central asset directory is configured",async()=>{
    expect(await centralRicsTemplate(template,"")).toBeNull();
  });
  it("requires authorisation, review metadata and safe central filenames",()=>{
    expect(centralCatalogueSchema.safeParse({templates:[entry]}).success).toBe(true);
    expect(centralCatalogueSchema.safeParse({templates:[{...entry,pdfFile:"../outside.pdf"}]}).success).toBe(false);
    expect(centralCatalogueSchema.safeParse({templates:[{...entry,distributionAuthorisationReference:""}]}).success).toBe(false);
    expect(centralCatalogueSchema.safeParse({templates:[entry,entry]}).success).toBe(false);
  });
  it("loads only the checksum-pinned matching version",async()=>{
    const dir=await fixture();expect((await centralRicsTemplate(template,dir))?.bytes).toEqual(bytes);
    expect(await centralRicsTemplate({...template,version:"different"},dir)).toBeNull();
    await writeFile(join(dir,"level-1.pdf"),"changed asset");await expect(centralRicsTemplate(template,dir)).rejects.toThrow("checksum");
  });
  it("rejects an asset whose report field coverage is incomplete",async()=>{
    const dir=await fixture({...entry,definition:{...entry.definition,bindings:entry.definition.bindings.slice(0,1)}});
    await expect(centralRicsTemplate(template,dir)).rejects.toThrow("incomplete");
  });
});
