import "server-only";
import {eq,and,asc} from "drizzle-orm";
import {createDatabase,withTenant,jobs,properties,organisations,organisationOperationalSettings,clientCasePublications,jobStageEvents} from "@surveynt/db";
import {readPublicQuote} from "./firm-operations";
/** Narrow case projection: never include internal reasons, notes, provider payloads or other jobs. */
export async function readClientCase(id:string,token:string){
 const verified=await readPublicQuote(id,token);
 if(!verified||verified.row.status==="cancelled"||verified.row.status==="expired")return null;
 const quote=verified.row,db=createDatabase(process.env.DATABASE_ADMIN_URL);
 const view=await withTenant(db,quote.organisationId,async tx=>{
  const [[org],[settings],record,publication,activity]=await Promise.all([
   tx.select({name:organisations.name}).from(organisations).where(eq(organisations.id,quote.organisationId)).limit(1),
   tx.select({branding:organisationOperationalSettings.customerBranding,timezone:organisationOperationalSettings.timezone}).from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,quote.organisationId)).limit(1),
   quote.jobId?tx.select({stage:jobs.stage,propertyType:properties.propertyType,latitude:properties.latitude,longitude:properties.longitude}).from(jobs).innerJoin(properties,and(eq(properties.id,jobs.propertyId),eq(properties.organisationId,jobs.organisationId))).where(and(eq(jobs.id,quote.jobId),eq(jobs.organisationId,quote.organisationId))).limit(1):Promise.resolve([]),
   quote.jobId?tx.select({propertyInformation:clientCasePublications.propertyInformation,evidence:clientCasePublications.evidence,releasedAt:clientCasePublications.releasedAt}).from(clientCasePublications).where(and(eq(clientCasePublications.organisationId,quote.organisationId),eq(clientCasePublications.jobId,quote.jobId))).limit(1):Promise.resolve([]),
   quote.jobId?tx.select({stage:jobStageEvents.toStage,at:jobStageEvents.createdAt}).from(jobStageEvents).where(and(eq(jobStageEvents.organisationId,quote.organisationId),eq(jobStageEvents.jobId,quote.jobId))).orderBy(asc(jobStageEvents.createdAt)).limit(100):Promise.resolve([])
  ]);
  const property=record[0];
  return {brand:{name:settings?.branding.displayName||org?.name||"Your surveying practice",logoUrl:settings?.branding.logoUrl??null},timezone:settings?.timezone??"Europe/London",stage:property?.stage??quote.status,propertyType:property?.propertyType??null,coordinates:property?.latitude!=null&&property.longitude!=null?{latitude:property.latitude,longitude:property.longitude}:null,activity:activity.map(e=>({label:e.stage.replaceAll("_"," "),at:e.at.toISOString()})),propertyInformation:publication[0]?.propertyInformation??[],evidence:publication[0]?.evidence??[],releasedAt:publication[0]?.releasedAt?.toISOString()??null};
 });return {quote:verified,view};
}
