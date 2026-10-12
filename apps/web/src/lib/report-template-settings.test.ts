import {describe,expect,it} from "vitest";
import {activeReportTemplates,bookedReportTemplate,defaultReportTemplate,reportTemplateSettingsSchema} from "./report-template-settings";
import {homeSurveyTemplatesV1_1} from "@surveynt/assistant";
const template=homeSurveyTemplatesV1_1.find(template=>template.serviceLevels.includes("level_3"))!;
const row={templateKey:template.key,templateVersion:template.version,serviceNames:["Detailed building inspection"],licenceReference:"company-reference",licenceExpiresOn:"2027-01-01"};
describe("company report template selection",()=>{
  it("maps exact embedded service names without guessing from marketing text",()=>{
    expect(bookedReportTemplate({templates:[{...row,licenceExpiresOn:null}]},"DETAILED BUILDING INSPECTION")?.serviceLevel).toBe("level_3");
    expect(bookedReportTemplate({templates:[row]},"Building inspection")).toBeNull();
  });
  it("excludes expired licences and rejects mismatched service scopes",()=>{
    expect(activeReportTemplates({templates:[row]},"2027-01-02")).toEqual([]);
    expect(activeReportTemplates({templates:[row]},"2027-01-01")).toHaveLength(1);
    expect(defaultReportTemplate({templates:[{...row,licenceExpiresOn:null}]},row.serviceNames[0],"level_2")).toBeNull();
  });
  it("rejects ambiguous service mappings, duplicate templates and missing licence references",()=>{
    expect(reportTemplateSettingsSchema.safeParse({templates:[row]}).success).toBe(true);
    expect(reportTemplateSettingsSchema.safeParse({templates:[row,row]}).success).toBe(false);
    expect(reportTemplateSettingsSchema.safeParse({templates:[{...row,licenceReference:""}]}).success).toBe(false);
    expect(reportTemplateSettingsSchema.safeParse({templates:[{...row,templateKey:"unpublished"}]}).success).toBe(false);
  });
});
