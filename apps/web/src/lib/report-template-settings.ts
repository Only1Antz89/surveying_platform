import { z } from "zod";
import { builtInTemplates, type ServiceLevel } from "@surveynt/assistant";
export const reportTemplateSettingsSchema = z.object({templates:z.array(z.object({
  templateKey:z.string().min(1).max(80),templateVersion:z.string().min(1).max(20),
  serviceNames:z.array(z.string().trim().min(1).max(160)).max(30),
  licenceReference:z.string().trim().min(1).max(160),licenceExpiresOn:z.iso.date().nullable(),
}).strict()).max(20)}).strict().superRefine((settings,ctx)=>{
  const seen=new Set<string>();const services=new Set<string>();
  settings.templates.forEach((row,index)=>{
    const key=`${row.templateKey}@${row.templateVersion}`;
    if(seen.has(key))ctx.addIssue({code:"custom",path:["templates",index],message:"A template can only be enabled once."});seen.add(key);
    if(!builtInTemplates.some(item=>item.key===row.templateKey && item.version===row.templateVersion && item.key.startsWith("surveynt-home-survey-")))ctx.addIssue({code:"custom",path:["templates",index],message:"Choose a supported recording template."});
    row.serviceNames.forEach(service=>{const normalized=service.toLowerCase();if(services.has(normalized))ctx.addIssue({code:"custom",path:["templates",index,"serviceNames"],message:"Each service needs one automatic template."});services.add(normalized);});
  });
});
export type ReportTemplateSettings = z.infer<typeof reportTemplateSettingsSchema>;
export function activeReportTemplates(settings:ReportTemplateSettings|null,today=new Date().toISOString().slice(0,10)) {
  return settings?.templates.filter(row=>!row.licenceExpiresOn || row.licenceExpiresOn>=today) ?? [];
}
export function defaultReportTemplate(settings:ReportTemplateSettings|null,serviceName:string,scope:ServiceLevel) {
  return activeReportTemplates(settings).find(row=>row.serviceNames.some(name=>name.toLowerCase()===serviceName.toLowerCase()) && builtInTemplates.some(template=>template.key===row.templateKey && template.version===row.templateVersion && template.serviceLevels.includes(scope))) ?? null;
}

export function bookedReportTemplate(settings:ReportTemplateSettings|null,serviceName:string) {
  const row=activeReportTemplates(settings).find(row=>row.serviceNames.some(name=>name.toLowerCase()===serviceName.toLowerCase()));
  if(!row)return null;
  const template=builtInTemplates.find(template=>template.key===row.templateKey && template.version===row.templateVersion);
  return template ? {...row,serviceLevel:template.serviceLevels[0]} : null;
}
