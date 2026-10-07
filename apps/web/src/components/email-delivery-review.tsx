"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function EmailDeliveryReview({jobId,attempts,leaseToken}:{jobId:string;attempts:number;leaseToken:string|null}){
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function review(form:FormData){
    setBusy(true);setMessage("");
    try{
      const response=await fetch(`/api/platform/background-jobs/${jobId}/review`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedAttempts:attempts,expectedLeaseToken:leaseToken,outcome:form.get("outcome"),providerMessageId:form.get("providerMessageId")||undefined,evidence:form.get("evidence"),confirmed:form.get("confirmed")==="on"})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Review could not be saved.");
      setMessage(payload.meta?.persisted===false?"Preview only: review was not saved.":"Provider review recorded.");router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Connection lost. Reload before retrying the review.");}finally{setBusy(false);}
  }
  return <details><summary>Review provider evidence</summary><p>Check SMTP2GO activity for job {jobId} and attempt {leaseToken??"legacy worker"}. A timeout does not prove that delivery was rejected.</p><form action={review}><label className="field"><span>Verified provider outcome</span><select name="outcome"><option value="accepted">Provider accepted the email</option><option value="not_accepted">Provider evidence confirms no acceptance; queue a retry</option></select></label><label className="field"><span>Provider message identifier (required for acceptance)</span><input name="providerMessageId" maxLength={200}/></label><label className="field"><span>Provider evidence reference and findings</span><textarea name="evidence" minLength={15} maxLength={2000} required/></label><label><input name="confirmed" type="checkbox" required/> I verified this outcome against provider evidence.</label><button className="button button-secondary" disabled={busy}>Record reviewed outcome</button></form><p role="status">{message}</p></details>;
}
