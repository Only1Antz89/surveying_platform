import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { builtInTemplates, type FormTemplate } from "@surveynt/assistant";
import { mappedPaths, outputDefinitionSchema, validateOutputDefinition } from "./licensed-report-definition";
import { inspectOutputPdf } from "./licensed-report-pdf";

// Provisioned by Surveyant operations from its authorised supplier. No company upload API.
const entrySchema=z.object({
  templateKey:z.string(),templateVersion:z.string(),
  pdfFile:z.string().regex(/^[a-zA-Z0-9_-]+\.pdf$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),
  supplier:z.string().min(1),distributionAuthorisationReference:z.string().min(1),
  professionallyReviewedBy:z.string().min(1),reviewedOn:z.iso.date(),
  definition:outputDefinitionSchema,
}).strict();
export const centralCatalogueSchema=z.object({templates:z.array(entrySchema).max(30)}).strict().superRefine((value,ctx)=>{
  const seen=new Set<string>();
  value.templates.forEach((entry,index)=>{const key=`${entry.templateKey}@${entry.templateVersion}`;if(seen.has(key))ctx.addIssue({code:"custom",path:["templates",index],message:"Duplicate central template version."});seen.add(key);});
});
export async function centralRicsTemplate(template:FormTemplate,directory=process.env.SURVEYNT_RICS_TEMPLATE_DIRECTORY) {
  if(!directory)return null;
  const manifest=join(directory,"catalogue.json");
  if((await stat(manifest)).size>2_000_000)throw new Error("Central RICS catalogue exceeds its size limit.");
  const catalogue=centralCatalogueSchema.parse(JSON.parse(await readFile(manifest,"utf8")));
  const entry=catalogue.templates.find(item=>item.templateKey===template.key && item.templateVersion===template.version);
  if(!entry)return null;
  const errors=validateOutputDefinition(template,entry.definition);
  // Direct mappings are required: a composed section does not necessarily include every recorded field.
  if(errors.length || mappedPaths(template,entry.definition).missing.length)throw new Error("Central RICS template mappings are incomplete or invalid.");
  const file=join(directory,entry.pdfFile);
  if((await stat(file)).size>25*1024*1024)throw new Error("Central RICS template exceeds its size limit.");
  const bytes=await readFile(file);
  if(createHash("sha256").update(bytes).digest("hex")!==entry.sha256)throw new Error("Central RICS template checksum does not match its reviewed version.");
  const pdf=await inspectOutputPdf(bytes);
  for(const {target} of entry.definition.bindings){
    if(target.kind==="form_field" && !pdf.fields.some(field=>field.name===target.name && field.editableText))throw new Error("Central RICS PDF field mapping does not exist.");
    if(target.kind==="box"){const page=pdf.pages[target.page-1];if(!page || target.x+target.width>page.width || target.y+target.height>page.height)throw new Error("Central RICS PDF box is outside its page.");}
  }
  return {...entry,bytes};
}
export async function ricsCatalogueStatus() {
  const templates=builtInTemplates.filter(template=>template.key.startsWith("surveynt-home-survey-") && template.version==="1.1.0");
  return Promise.all(templates.map(async template=>{
    let available=false;
    try{available=Boolean(await centralRicsTemplate(template));}catch{/* Fail closed without exposing deployment paths. */}
    return {templateKey:template.key,templateVersion:template.version,outputStatus:available?"draft_preview_available" as const:"awaiting_platform_provision" as const};
  }));
}
