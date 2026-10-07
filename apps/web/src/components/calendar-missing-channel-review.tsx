"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
export type MissingCalendarChannel={id:string;provider:string;accountId:string;reviewVersion:string};
export function CalendarMissingChannelReview({row}:{row:MissingCalendarChannel}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");const router=useRouter();
 async function submit(form:FormData){setBusy(true);setMessage("");try{
  const response=await fetch(`/api/platform/calendar-connections/${row.id}/provision`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({reviewVersion:row.reviewVersion,verifiedAccountId:form.get("accountId"),evidence:form.get("evidence"),confirmed:form.get("confirmed")==="on"})});const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Calendar provisioning review failed.");setMessage(payload.meta?.persisted===false?"Demo review only. No subscription was queued.":"Reviewed registration queued. Refresh to check worker completion.");router.refresh();
 }catch(error){setMessage(error instanceof Error?error.message:"Calendar review failed.");}finally{setBusy(false);}}
 return <details><summary>{row.provider} · {row.accountId}</summary><p>A missing recorded channel does not prove provider absence. Resolve any existing attempts and verify that this exact account has no active Surveynt subscription before queuing creation.</p><form action={submit}><label className="field"><span>Enter the exact provider account identifier</span><input name="accountId" maxLength={2048} required/></label><label className="field"><span>Provider absence evidence reference and findings (exclude credentials)</span><textarea name="evidence" minLength={15} maxLength={2000} required/></label><label><input name="confirmed" type="checkbox" required/> I verified this account has no active Surveynt provider subscription.</label><button className="button button-secondary" disabled={busy}>Queue reviewed registration</button></form><p role="status">{message}</p></details>;
}
