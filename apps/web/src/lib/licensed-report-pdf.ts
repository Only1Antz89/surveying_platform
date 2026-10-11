import { PDFDocument, PDFName, PDFTextField, PDFSignature, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { resolveField, valueStateLabels, type ComposedReport, type FieldValue, type FormTemplate } from "@surveynt/assistant";
import { validateOutputDefinition, type OutputDefinition, type OutputSource } from "./licensed-report-definition";
export type OutputAnswers={fieldPath:string;value:Record<string,unknown>}[];
export class PdfOutputError extends Error {}
async function load(bytes:Uint8Array) {
  if(bytes.length>25*1024*1024 || !new TextDecoder().decode(bytes.slice(0,5)).startsWith("%PDF-"))throw new PdfOutputError("The centrally provisioned PDF must be smaller than 25 MB.");
  const doc=await PDFDocument.load(bytes,{updateMetadata:false});
  if(doc.getPageCount()<1 || doc.getPageCount()>200)throw new PdfOutputError("Templates must contain between 1 and 200 pages.");
  if(doc.getForm().hasXFA())throw new PdfOutputError("XFA templates are not supported. Use a standard PDF export.");
  if(doc.getForm().getFields().some(field=>field instanceof PDFSignature && field.acroField.dict.has(PDFName.of("V"))))throw new PdfOutputError("Use an unsigned template, not a digitally signed report.");
  return doc;
}
export async function inspectOutputPdf(bytes:Uint8Array) {
  const doc=await load(bytes);
  return {pages:doc.getPages().map((page,index)=>({page:index+1,width:page.getWidth(),height:page.getHeight()})),fields:doc.getForm().getFields().map(field=>({name:field.getName(),type:field.constructor.name,editableText:field instanceof PDFTextField}))};
}
function valueText(template:FormTemplate,path:string,input:FieldValue) {
  if(input.state!=="provided")return `${valueStateLabels[input.state]}${input.reason?`: ${input.reason}`:""}`;
  const field=resolveField(template,path)?.field;const raw=input.value;
  if(typeof raw==="boolean")return raw?"Yes":"No";
  if(Array.isArray(raw))return raw.map(value=>field?.options?.find(option=>option.value===value)?.label??value).join(", ");
  if(field?.type==="enum")return field.options?.find(option=>option.value===raw)?.label??String(raw);
  if(field?.type==="condition_rating")return `${raw} — ${template.conditionRatingLabels[String(raw) as "1"]??""}`;
  return `${raw}${field?.unit?` ${field.unit}`:""}`;
}
export function outputSourceText(source:OutputSource,template:FormTemplate,report:ComposedReport,answers:OutputAnswers) {
  if(source.kind==="field"){const row=answers.find(row=>row.fieldPath===source.path);return row?valueText(template,source.path,row.value as FieldValue):"";}
  if(source.kind==="summary"){
    if(source.value==="address")return [report.property.line1,report.property.city,report.property.postcode].filter(Boolean).join(", ");
    if(source.value==="reference")return report.jobReference;
    if(source.value==="recommendations")return report.recommendations.map(block=>block.text).join("\n\n");
    return report.ratingSummary.map(group=>`${group.label}: ${group.elements.map(element=>element.title).join(", ")}`).join("\n");
  }
  const section=report.sections.find(section=>section.key===source.section);
  if(source.kind==="section")return section?[...section.blocks.map(block=>block.text),...section.elements.map(element=>`${element.title}\n${element.blocks.map(block=>block.text).join("\n\n")}`)].join("\n\n"):"";
  return section?.elements.find(element=>element.key===`${source.section}.${source.element}`)?.blocks.map(block=>block.text).join("\n\n")??"";
}
function wrap(text:string,font:PDFFont,size:number,width:number) {
  const lines:string[]=[];
  for(const paragraph of text.replace(/\r/g,"").split("\n")){
    let line="";
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      if(font.widthOfTextAtSize(word,size)>width)throw new PdfOutputError("A word or URL cannot fit in its mapped PDF box. Widen the box or edit the answer.");
      const candidate=line?`${line} ${word}`:word;
      if(font.widthOfTextAtSize(candidate,size)>width){lines.push(line);line=word;}else line=candidate;
    }
    lines.push(line);
  }
  return lines;
}
function fit(text:string,font:PDFFont,size:number,width:number,height:number) {
  const lines=wrap(text,font,size,width);if(lines.length*size*1.2>height)throw new PdfOutputError("An answer exceeds its mapped PDF box. Increase its space before composing; no text was truncated.");return lines;
}
export type OutputPhoto={id:string;label:string;bytes:Uint8Array;contentType:string};
/** Uses the authorised document itself as the canvas. No sample boilerplate is reconstructed. */
export async function renderLicensedReportPdf(input:{bytes:Uint8Array;definition:OutputDefinition;template:FormTemplate;report:ComposedReport;answers:OutputAnswers;photos?:OutputPhoto[];draft?:boolean}) {
  const errors=validateOutputDefinition(input.template,input.definition);if(errors.length)throw new PdfOutputError(errors.join("; "));
  const doc=await load(input.bytes);const font=await doc.embedFont(StandardFonts.Helvetica);const form=doc.getForm();
  for(const {source,target} of input.definition.bindings){
    const text=outputSourceText(source,input.template,input.report,input.answers);
    try{
      if(target.kind==="form_field"){
        const field=form.getTextField(target.name);const widgets=field.acroField.getWidgets();
        if(!widgets.length)throw new PdfOutputError(`PDF field ${target.name} has no visible widget.`);
        if(field.getMaxLength() && text.length>field.getMaxLength()!)throw new PdfOutputError(`Answer exceeds the character limit in ${target.name}.`);
        for(const widget of widgets){const box=widget.getRectangle();if(!field.isMultiline() && text.includes("\n"))throw new PdfOutputError(`PDF field ${target.name} needs multiline enabled.`);if(!field.isMultiline() && font.widthOfTextAtSize(text,target.fontSize)>box.width-6)throw new PdfOutputError(`Answer is too wide for ${target.name}.`);fit(text,font,target.fontSize,box.width-6,box.height-4);widget.setDefaultAppearance(`0 0 0 rg /Helvetica ${target.fontSize} Tf`);}
        field.setFontSize(target.fontSize);field.acroField.setDefaultAppearance(`0 0 0 rg /Helvetica ${target.fontSize} Tf`);field.setText(text);field.disableScrolling();field.updateAppearances(font);
      }else{
        const page=doc.getPages()[target.page-1];if(!page || target.x+target.width>page.getWidth() || target.y+target.height>page.getHeight())throw new PdfOutputError(`Mapped box is outside PDF page ${target.page}.`);
        const lines=fit(text,font,target.fontSize,target.width,target.height);
        lines.forEach((line,index)=>page.drawText(line,{x:target.x,y:target.y+target.height-target.fontSize-index*target.fontSize*1.2,size:target.fontSize,font,color:rgb(0,0,0)}));
      }
    }catch(error){throw new PdfOutputError(`${source.kind === "field"?source.path:source.kind}: ${error instanceof Error?error.message:"PDF rendering failed"}`);}
  }
  const photos=input.photos??[];
  if(photos.length && !input.definition.appendPhotographs)throw new PdfOutputError("Linked photographs are not included by this output definition. Enable the photographic appendix before composing.");
  for(let index=0;index<photos.length;index+=2){
    const page=doc.addPage([595.28,841.89]);page.drawText("Photographic evidence",{x:40,y:800,font,size:18,color:rgb(77/255,45/255,105/255)});
    for(let slot=0;slot<2;slot++){const photo=photos[index+slot];if(!photo)continue;const image=photo.contentType==="image/png"?await doc.embedPng(photo.bytes):photo.contentType==="image/jpeg"?await doc.embedJpg(photo.bytes):null;if(!image)throw new PdfOutputError("Report photographs must be JPEG or PNG.");const scaled=image.scaleToFit(515,295);const top=slot===0?770:405;page.drawImage(image,{x:40+(515-scaled.width)/2,y:top-scaled.height,width:scaled.width,height:scaled.height});fit(photo.label,font,10,515,36).forEach((line,lineIndex)=>page.drawText(line,{x:40,y:top-315-lineIndex*12,size:10,font,color:rgb(0,0,0)}));}
  }
  if(input.draft)for(const page of doc.getPages())page.drawText("DRAFT — NOT FOR ISSUE",{x:24,y:12,size:9,font,color:rgb(0,0,0)});
  doc.setTitle(`${input.report.jobReference} — Home Survey`);
  const result=await doc.save();
  // Check canonical form values after serialization, not just the rendered appearances.
  const reopened=await PDFDocument.load(result);
  for(const binding of input.definition.bindings)if(binding.target.kind==="form_field" && reopened.getForm().getTextField(binding.target.name).getText()!==outputSourceText(binding.source,input.template,input.report,input.answers))throw new PdfOutputError("PDF field value verification failed.");
  return result;
}
