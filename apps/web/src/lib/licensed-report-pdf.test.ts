import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import { composeReport, homeSurveyTemplatesV1_1 } from "@surveynt/assistant";
import { renderLicensedReportPdf } from "./licensed-report-pdf";
import { mappedPaths, validateOutputDefinition, type OutputDefinition } from "./licensed-report-definition";
const template=homeSurveyTemplatesV1_1[0];
const path="a.details.surveyor_name";
const answers=[{fieldPath:path,value:{state:"provided",value:"Alex Surveyor"}}];
const report=composeReport({template,serviceLevel:"level_1",jurisdiction:"ENG",job:{reference:"TEST-1"},property:{line1:"1 Test Road",city:null,postcode:null},values:[],elements:[],observations:[],evidence:[],media:[],clauses:[]}).report;
const definition:OutputDefinition={version:1,bindings:[{source:{kind:"field",path},target:{kind:"form_field",name:"surveyor",fontSize:10}}],appendPhotographs:true};
async function original() {
  // Entirely synthetic, authored fixture. No licensed RICS document is redistributed.
  const doc=await PDFDocument.create();const page=doc.addPage([595,842]);
  page.drawText("Synthetic layout fixture",{x:40,y:790,font:await doc.embedFont(StandardFonts.Helvetica),size:18,color:rgb(77/255,45/255,105/255)});
  const field=doc.getForm().createTextField("surveyor");field.addToPage(page,{x:40,y:720,width:250,height:30,textColor:rgb(0,0,1)});
  doc.addPage([595,842]).drawText("Original appendix retained",{x:40,y:790,size:12});
  return doc.save();
}
describe("central licensed PDF renderer",()=>{
  it("preserves original pages and canonical values, renders black widget appearances, and keeps fields interactive",async()=>{
    const bytes=await renderLicensedReportPdf({bytes:await original(),template,definition,report,answers,draft:true});
    const doc=await PDFDocument.load(bytes);expect(doc.getPageCount()).toBe(2);
    const field=doc.getForm().getTextField("surveyor");expect(field.getText()).toBe("Alex Surveyor");expect(field.acroField.getWidgets()).toHaveLength(1);
    expect(field.acroField.getDefaultAppearance()).toContain("0 0 0 rg");
    expect(field.acroField.getWidgets()[0].dict.has(PDFName.of("AP"))).toBe(true);
  });
  it("rejects overflowing text instead of clipping it in single-line fields",async()=>{
    await expect(renderLicensedReportPdf({bytes:await original(),template,definition,report,answers:[{fieldPath:path,value:{state:"provided",value:"Too long to fit ".repeat(20)}}]})).rejects.toThrow(/too wide|character limit/);
  });
  it("rejects nonexistent destinations, out-of-page boxes and missing photographic appendices",async()=>{
    const bytes=await original();
    await expect(renderLicensedReportPdf({bytes,template,definition:{...definition,bindings:[{...definition.bindings[0],target:{kind:"form_field",name:"absent",fontSize:10}}]},report,answers})).rejects.toThrow();
    await expect(renderLicensedReportPdf({bytes,template,definition:{...definition,bindings:[{source:{kind:"field",path},target:{kind:"box",page:3,x:40,y:40,width:200,height:40,fontSize:10}}]},report,answers})).rejects.toThrow("outside PDF");
    await expect(renderLicensedReportPdf({bytes,template,definition:{...definition,appendPhotographs:false},report,answers,photos:[{id:"photo",label:"Test",bytes:new Uint8Array(),contentType:"image/png"}]})).rejects.toThrow("not included");
  });
  it("cannot treat a composed section as proof that all report fields are mapped",()=>{
    expect(mappedPaths(template,{...definition,bindings:[{source:{kind:"section",section:"a"},target:{kind:"box",page:1,x:40,y:40,width:200,height:40,fontSize:10}}]}).missing).toContain(path);
    expect(validateOutputDefinition(template,{...definition,bindings:[...definition.bindings,...definition.bindings]})).toContain("Duplicate PDF destination field:surveyor");
  });
});
