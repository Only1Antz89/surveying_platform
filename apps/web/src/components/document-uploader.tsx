"use client";
import {workspaceFetch} from "@/lib/workspace-request";
import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
export function DocumentUploader({replaceId,expectedChecksum}:{replaceId?:string;expectedChecksum?:string}={}){
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [accessClass,setAccessClass]=useState("firm"),[jobs,setJobs]=useState<{id:string;reference:string}[]>([]),[jobsError,setJobsError]=useState("");
  useEffect(()=>{
    if(replaceId)return;
    const controller=new AbortController();
    void workspaceFetch("/api/v1/jobs",{signal:controller.signal}).then(async response=>{
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error?.message??"Job choices could not be loaded.");
      setJobs(payload.data);
    }).catch(error=>{if(error.name!=="AbortError")setJobsError(error.message);});
    return()=>controller.abort();
  },[replaceId]);
  async function upload(formData:FormData){setBusy(true);setMessage("");try{const response=await workspaceFetch("/api/v1/documents",{method:"POST",body:formData}),payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"Upload failed.");setMessage(replaceId?"Replacement saved. The previous original is retained.":"Document uploaded with practice retention policy.");router.refresh();}catch(error){setMessage((error as Error).message??"Connection lost. Check the document register before retrying.");}finally{setBusy(false);}}
  return <form action={upload} className="panel-body form-grid">{replaceId?<><input type="hidden" name="replaceId" value={replaceId}/><input type="hidden" name="expectedChecksum" value={expectedChecksum}/><p>The previous original remains retained. Job/report links, access classification and retention are preserved. Legal-held files cannot be replaced.</p></>:<label className="field"><span>Category</span><select name="category"><option value="legal">Legal file</option><option value="retained_report">Retained report</option><option value="compliance">Compliance record</option><option value="correspondence">Correspondence</option></select></label>}{!replaceId?<><label className="field"><span>Who can access</span><select name="accessClass" value={accessClass} onChange={event=>setAccessClass(event.target.value)}><option value="firm">All practice members</option><option value="restricted">Practice management</option><option value="job">Assigned job surveyor and practice management</option></select></label><label className="field"><span>Linked job {accessClass!=="job"?"(optional)":"(required)"}</span><select name="jobId" required={accessClass==="job"}><option value="">No linked job</option>{jobs.map(job=><option key={job.id} value={job.id}>{job.reference}</option>)}</select><span className="form-help">Choose from the latest 50 jobs.</span></label>{jobsError?<p role="alert">{jobsError}</p>:null}</>:null}<label className="field"><span>{replaceId?"Replacement file":"File"}</span><input type="file" name="file" required accept=".pdf,.docx,.txt,.jpg,.jpeg,.png"/></label><button className="button button-primary" disabled={busy}><Upload size={16}/>{busy?"Uploading…":replaceId?"Save retained replacement":"Upload securely"}</button><span role="status">{message}</span></form>;
}
