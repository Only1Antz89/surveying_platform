import { z } from "zod";
import { apiContext } from "@/lib/access";
import { ok, problem } from "@/lib/api";
import { practiceInsights } from "@/lib/insights";
import { localDayRange } from "@/lib/scheduling";

export async function GET(request:Request) {
  const context=await apiContext(request);
  if(!context)return problem(401,"unauthorised","Sign in to view practice insights.");
  if(!["owner","administrator","manager"].includes(context.role))return problem(403,"forbidden","Practice analytics require management access.");
  if(context.demo)return problem(409,"preview_only","Sign in to the persistent demo for record-based insights.");
  const url=new URL(request.url),now=new Date();
  const parsed=z.object({from:z.iso.date(),to:z.iso.date()}).safeParse({from:url.searchParams.get("from")??new Date(now.getTime()-30*86400000).toISOString().slice(0,10),to:url.searchParams.get("to")??now.toISOString().slice(0,10)});
  if(!parsed.success)return problem(400,"invalid_range","Use valid start and end dates.");
  const from=localDayRange(parsed.data.from).start,to=localDayRange(parsed.data.to).end;
  if(from>=to||to.getTime()-from.getTime()>366*86400000)return problem(400,"invalid_range","Choose a period of up to one year.");
  const data=await practiceInsights(context.organisationId,from,to);
  if(url.searchParams.get("format")==="csv"){
    const cell=(value:unknown)=>`"${String(value??"").replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`;
    const lines:unknown[][]=[["section","label","currency","value"],["conversion","quotes","",data.quotes],["conversion","converted","",data.converted]];
    for(const row of data.money)for(const [key,value] of Object.entries(row))if(key!=="currency")lines.push(["finance",key,row.currency,value]);
    for(const [section,rows] of [["pipeline",data.pipeline],["workload",data.workload],["services",data.services]] as const)for(const row of rows)lines.push([section,row.name,"",row.count]);
    lines.push(["completion","average_days","",data.completion.days]);
    const stream=new ReadableStream({start(controller){const encoder=new TextEncoder();for(const line of lines)controller.enqueue(encoder.encode(line.map(cell).join(",")+"\r\n"));controller.close();}});
    return new Response(stream,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=surveynt-insights.csv","cache-control":"private, no-store"}});
  }
  return ok(data);
}
