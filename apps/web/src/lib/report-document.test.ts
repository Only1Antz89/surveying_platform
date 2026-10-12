import {describe,expect,it} from "vitest";
import {composeReport,homeSurveyTemplatesV1_1} from "@surveynt/assistant";
import {reportDocument} from "./report-document";
describe("printable survey review copy",()=>{
  it("escapes survey text, omits internal provenance and keeps report answers black",()=>{
    const {report}=composeReport({template:homeSurveyTemplatesV1_1[0],serviceLevel:"level_1",jurisdiction:"ENG",job:{reference:"TEST"},property:{line1:"<script>alert(1)</script>",city:null,postcode:null},values:[{id:"secret-value-id",fieldPath:"a.details.surveyor_name",value:{state:"provided",value:"Surveyor <test>"}}],elements:[],observations:[],evidence:[],media:[],clauses:[]});
    const html=reportDocument(report);
    expect(html).toContain("Surveyor &lt;test&gt;");expect(html).not.toContain("<script>");expect(html).not.toContain("secret-value-id");expect(html).toContain("color:#000");expect(html).toContain("#4d2d69");expect(html).not.toContain("#215bf5");expect(html).toContain("NOT FOR ISSUE");
  });
});
