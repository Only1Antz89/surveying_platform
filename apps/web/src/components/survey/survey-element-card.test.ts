import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { residentialTemplateV1 } from "@surveynt/assistant";
import { SurveyElementCard } from "./survey-element-card";
it("renders removed observations without stale text or evidence controls", () => {
  const section=residentialTemplateV1.sections.find(section=>section.elements.some(element=>element.inspectable))!;
  const element=section.elements.find(element=>element.inspectable)!;
  const html=renderToStaticMarkup(createElement(SurveyElementCard,{
    section,element,template:residentialTemplateV1,
    view:{serverId:"element",version:1,inspectionStatus:"inspected",limitationReason:null,pending:false},
    fieldDisplay:()=>({value:null,pending:false,origin:null}),
    observations:[{key:"removed",text:"Fictional stale private text",kind:"current_observation",pending:false,contentRemoved:true,defect:{nextAction:"repair"},evidenceCount:1}],
    photos:[{key:"photo",src:null,pending:false,label:"Photo"}],canEdit:true,canJudge:true,
    onElement:()=>undefined,onField:()=>undefined,onObservation:()=>undefined,onPhoto:()=>undefined,onLinkPhoto:()=>undefined,
  }));
  expect(html).toContain("Observation content removed after retention review");
  expect(html).not.toContain("Fictional stale private text");
  expect(html).not.toContain("Link a photo as evidence");
});

it("hides stale limitation notes and disables editing for removed elements", () => {
 const section=residentialTemplateV1.sections.find(section=>section.elements.some(element=>element.inspectable))!;
 const element=section.elements.find(element=>element.inspectable)!;
 const html=renderToStaticMarkup(createElement(SurveyElementCard,{
 section,element,template:residentialTemplateV1,view:{serverId:"element",version:1,inspectionStatus:"not_inspected",limitationReason:"Fictional stale private limitation",pending:false,contentRemoved:true},
 fieldDisplay:()=>({value:null,pending:false,origin:null}),observations:[],photos:[],canEdit:true,canJudge:true,
 onElement:()=>undefined,onField:()=>undefined,onObservation:()=>undefined,onPhoto:()=>undefined,
 }));
 expect(html).toContain("Inspection notes removed after retention review");
 expect(html).not.toContain("Fictional stale private limitation");
 expect(html).not.toContain("Why was it not fully inspected?");
 expect(html).toContain("disabled");
});
