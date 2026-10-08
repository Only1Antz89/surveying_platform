import { and, desc, eq, inArray } from "drizzle-orm";
import { calendarConnections, createDatabase, organisationOperationalSettings, referenceDataSources, referenceDatasetSyncs, withTenant } from "@surveynt/db";
import { apiContext } from "@/lib/access";
import { ok,problem } from "@/lib/api";
import { calendarCapabilityState,integrationReadiness } from "@/lib/capabilities";
import { isDemoOrganisation } from "@/lib/stakeholder-demo";
import { canRecord, canApprove } from "@/lib/professional-access";
import { firmCapabilityVisible } from "@/lib/integration-access";

export async function GET(request:Request){
  const context=await apiContext(request);
  if(!context)return problem(401,"unauthorised","Sign in to view integration readiness.");
  const demo=context.demo||await isDemoOrganisation(context.organisationId);
  const permitted=(key:string)=>firmCapabilityVisible(context.role,key);
  const rows=integrationReadiness(demo).filter(row=>permitted(row.key)),canConfigure=["owner","administrator","manager"].includes(context.role);
  if(context.role!=="finance")rows.push(
    {key:"record_survey",label:"Professional survey recording",state:canRecord(context)?"Available":"Unavailable",detail:context.role==="surveyor"?"Recording is restricted to your currently assigned work.":"Management access alone does not grant permission to enter professional findings.",action:canRecord(context)?"Open your survey workspace":"Ask an owner for an audited professional grant"},
    {key:"approve_reports",label:"Report approval and issue",state:canApprove(context)?"Available":"Unavailable",detail:"Explicit approval permission is independent of recording permission. Template and completion safeguards still apply.",action:canApprove(context)?"Review a report version":"Ask an owner for an audited approval grant"},
  );
  if(context.demo||demo)return ok(rows.map(row=>({...row,action:canConfigure?row.action:"Contact your practice administrator"})));
  await withTenant(createDatabase(),context.organisationId,async tx=>{
    const [settings,sources,versions,connections]=await Promise.all([
      tx.select().from(organisationOperationalSettings).where(eq(organisationOperationalSettings.organisationId,context.organisationId)).limit(1),
      tx.select({key:referenceDataSources.key,enabled:referenceDataSources.enabled,verifiedAt:referenceDataSources.verifiedAt,coverage:referenceDataSources.coverage,lastFailureAt:referenceDataSources.lastFailureAt,lastSuccessAt:referenceDataSources.lastSuccessAt}).from(referenceDataSources).where(inArray(referenceDataSources.key,["hmlr_inspire","epc_england_wales"])),
      tx.select({sourceKey:referenceDatasetSyncs.sourceKey,layer:referenceDatasetSyncs.layer,version:referenceDatasetSyncs.datasetVersion,status:referenceDatasetSyncs.status,records:referenceDatasetSyncs.recordCount,activatedAt:referenceDatasetSyncs.activatedAt,startedAt:referenceDatasetSyncs.startedAt,validation:referenceDatasetSyncs.validation}).from(referenceDatasetSyncs).where(inArray(referenceDatasetSyncs.sourceKey,["hmlr_inspire","epc_england_wales"])).orderBy(desc(referenceDatasetSyncs.startedAt)).limit(100),
      tx.select({provider:calendarConnections.provider,status:calendarConnections.status,lastError:calendarConnections.lastError,webhookChannelId:calendarConnections.webhookChannelId,webhookExpiresAt:calendarConnections.webhookExpiresAt}).from(calendarConnections).where(and(eq(calendarConnections.organisationId,context.organisationId),eq(calendarConnections.userId,context.internalUserId!))),
    ]);
    const firm=settings[0];
    for(const row of rows){
      if(row.key==="quotes"&&row.state==="Available"&&!firm?.publicQuotesEnabled){row.state="Setup required";row.detail+=" This practice has not enabled public quotes.";}
      if(row.key==="payments"&&process.env.STRIPE_CLIENT_PAYMENTS_KEY)row.state=process.env.CLIENT_PAYMENTS_LAUNCH_APPROVED==="true"&&firm?.clientPaymentsEnabled&&process.env.STRIPE_WEBHOOK_SECRET?"Available":"Pending approval";
      if(row.key==="google"||row.key==="microsoft"){
        const configured=row.state==="Available"&&Boolean(process.env.CALENDAR_WEBHOOK_SECRET)&&Buffer.from(process.env.CALENDAR_TOKEN_ENCRYPTION_KEY??"","base64").length===32;
        const providerConnections=connections.filter(item=>item.provider===row.key),connection=providerConnections[0];
        row.state=calendarCapabilityState(configured,providerConnections);
        if(configured&&providerConnections.some(item=>item.status==="active")&&row.state==="Sync error")row.detail="A connected account has a calendar error, a missing notification channel, or an expired/unknown subscription deadline. Review connection and platform delivery health; manual reconciliation remains available.";
        if(configured)row.connectHref=`/api/v1/calendar/oauth/connect?provider=${row.key}`;
        row.action=connection?"Reconnect your calendar":"Connect your calendar";
      }
      if(row.key==="hmlr"||row.key==="epc"){
        const key=row.key==="hmlr"?"hmlr_inspire":"epc_england_wales",source=sources.find(item=>item.key===key);
        const releases=versions.filter(item=>item.sourceKey===key),active=releases.filter(item=>item.status==="active");
        row.coverage=source?.coverage??[];
        row.versions=active.map(item=>({version:item.version,layer:item.layer,records:item.records,activatedAt:item.activatedAt?.toISOString()??null}));
        const latest=releases[0];
        if(latest)row.sync={status:latest.status,records:latest.records,startedAt:latest.startedAt.toISOString(),capacityReviewPassed:latest.validation.capacityReviewPassed===true};
        const enabled=process.env.PROPERTY_INTELLIGENCE_ENABLED==="true"&&source?.enabled&&source.verifiedAt;
        const epcCredentials=Boolean(process.env.EPC_API_BASE_URL&&(process.env.EPC_API_TOKEN||process.env.EPC_API_EMAIL&&process.env.EPC_API_KEY));
        const epcApproved=process.env.EPC_LICENCE_ACCEPTED==="true"&&process.env.EPC_DATA_PROTECTION_APPROVED==="true";
        row.state=row.key==="epc"?epcCredentials&&!epcApproved?"Pending approval":enabled&&epcCredentials&&epcApproved?"Available":"Setup required":enabled&&active.length?"Available":"Setup required";
        if(enabled&&source?.lastFailureAt&&(!source.lastSuccessAt||source.lastFailureAt>source.lastSuccessAt))row.state="Sync error";
      }
      if(!canConfigure&&!row.connectHref)row.action="Contact your practice administrator";
    }
  });
  return ok(rows);
}
