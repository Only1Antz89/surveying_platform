import { z } from "zod";
import { listFields, type FormTemplate } from "@surveynt/assistant";
const source = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("field"),path:z.string().max(160)}).strict(),
  z.object({kind:z.literal("element"),section:z.string().max(60),element:z.string().max(60)}).strict(),
  z.object({kind:z.literal("section"),section:z.string().max(60)}).strict(),
  z.object({kind:z.literal("summary"),value:z.enum(["ratings","recommendations","address","reference"])}).strict(),
]);
const target = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("form_field"),name:z.string().min(1).max(300),fontSize:z.number().min(8).max(24).default(10)}).strict(),
  z.object({kind:z.literal("box"),page:z.number().int().min(1).max(200),x:z.number().min(0).max(2000),y:z.number().min(0).max(2000),width:z.number().min(20).max(2000),height:z.number().min(12).max(2000),fontSize:z.number().min(8).max(24).default(10)}).strict(),
]);
export const outputDefinitionSchema=z.object({version:z.literal(1),bindings:z.array(z.object({source,target}).strict()).min(1).max(600),appendPhotographs:z.boolean().default(true)}).strict();
export type OutputDefinition=z.infer<typeof outputDefinitionSchema>;
export type OutputSource=OutputDefinition["bindings"][number]["source"];
export function mappedPaths(template:FormTemplate,definition:OutputDefinition) {
  const fields=[...listFields(template)];const mapped=new Set<string>();
  for(const binding of definition.bindings) {
    const source=binding.source;
    for(const item of fields)if(source.kind==="field" && source.path===item.path)mapped.add(item.path);
  }
  return {mapped,missing:fields.filter(item=>item.field.reportUse==="report" && !mapped.has(item.path)).map(item=>item.path)};
}
export function validateOutputDefinition(template:FormTemplate,definition:OutputDefinition) {
  const fields=[...listFields(template)];const targets=new Set<string>();const errors:string[]=[];
  for(const binding of definition.bindings){
    const source=binding.source;const target=binding.target;
    if(source.kind==="field" && !fields.some(item=>item.path===source.path))errors.push(`Unknown field ${source.path}`);
    if(source.kind==="element" && !template.sections.some(section=>section.key===source.section && section.elements.some(element=>element.key===source.element)))errors.push(`Unknown element ${source.section}.${source.element}`);
    if(source.kind==="section" && !template.sections.some(section=>section.key===source.section))errors.push(`Unknown section ${source.section}`);
    const key=target.kind==="form_field"?`field:${target.name}`:`box:${target.page}:${target.x}:${target.y}`;
    if(targets.has(key))errors.push(`Duplicate PDF destination ${key}`);targets.add(key);
  }
  return errors;
}
