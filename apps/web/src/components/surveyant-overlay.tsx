"use client";
import Link from "./workspace-link";
import {useWorkspace} from "./workspace-provider";
import {workspaceLabels} from "@/lib/workspace-mode";
import {workspaceFetch} from "@/lib/workspace-request";
import {useEffect,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {Send,X,FileCheck2,ClipboardCheck,ArrowRight,ChevronRight,BookOpen,Ruler} from "lucide-react";
type Message={role:string;content:string;citations?:{id:string;label:string;href:string}[]};
export function SurveyantOverlay({mode,slug,quoteId,token,name}:{mode:"firm"|"platform"|"case";slug?:string;quoteId?:string;token?:string;name:string}){
 const workspace=useWorkspace();const audience=workspace?.workspaceMode;
 const pathname=usePathname();const jobId=mode==="firm"?pathname.match(/\/jobs\/([\da-f-]{36})(?:\/|$)/i)?.[1]:undefined;
 const supportId=mode==="platform"?pathname.match(/\/platform\/support\/([\da-f-]{36})(?:\/|$)/i)?.[1]:undefined;
 const scope=mode==="case"?`Case ${name}`:mode==="platform"?supportId?"Surveynt · active support session (read only)":"Surveynt · platform operations":jobId?`${name} · current case`:`${name} · ${audience?workspaceLabels[audience]:"business records"}${audience==="surveyor"?" · your assignments":""}`;
 const contextKey=`${audience}:${endpointPlaceholder(mode,quoteId,supportId)}:${jobId??""}:${token??""}`;
 const [messageContext,setMessageContext]=useState(contextKey);const [phase,setPhase]=useState<"closed"|"opening"|"open"|"closing">("closed"),[messages,setMessages]=useState<Message[]>([]),[text,setText]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),composer=useRef<HTMLTextAreaElement>(null),messageList=useRef<HTMLDivElement>(null),requestId=useRef(0),historyController=useRef<AbortController|null>(null);
 const open=phase!=="closed";
 const endpoint=mode==="platform"?supportId?`/api/platform/support/${supportId}/surveyant`:"/api/platform/surveyant":mode==="case"?`/api/v1/public/quotes/${quoteId}/assistant`:"/api/v1/surveyant";const storageKey=`surveynt:overlay:${mode}:${slug??quoteId??"platform"}`;
 useEffect(()=>{const timer=setTimeout(()=>setPhase(sessionStorage.getItem(storageKey)==="open"?"open":"closed"),0);return()=>clearTimeout(timer);},[storageKey]);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.show();if(!open&&dialog.current?.open)dialog.current?.close();},[open,storageKey]);
 useEffect(()=>{requestId.current++;const reset=setTimeout(()=>{setMessageContext(contextKey);setMessages([]);setError("");setBusy(false);setText("");},0);if(mode==="case"&&!token)return()=>clearTimeout(reset);let active=true;const controller=new AbortController();historyController.current=controller;workspaceFetch(`${endpoint}${jobId?`?jobId=${jobId}`:""}`,{headers:{...(token?{"x-quote-token":token}:{}),...(slug?{"x-demo-organisation-slug":slug}:{})},signal:controller.signal}).then(async r=>{const p=await r.json();if(!r.ok)throw Error(p.error?.message??"Conversation unavailable.");if(active){setMessageContext(contextKey);setMessages(p.data.messages??[]);}}).catch(e=>{if(active&&e.name!=="AbortError")setError(e.message);});return()=>{active=false;controller.abort();clearTimeout(reset);};},[endpoint,jobId,token,slug,mode,audience,contextKey]);
 async function send(e:React.FormEvent){e.preventDefault();historyController.current?.abort();const turn=++requestId.current;const question=text.trim();if(!question||busy)return;setBusy(true);setError("");setMessages(v=>[...v,{role:"user",content:question}]);setText("");try{const r=await workspaceFetch(endpoint,{method:"POST",headers:{"content-type":"application/json",...(token?{"x-quote-token":token}:{}),...(slug?{"x-demo-organisation-slug":slug}:{})},body:JSON.stringify({message:question,...(jobId?{jobId}:{})})});const p=await r.json();if(!r.ok)throw Error(p.error?.message??"SurvAI is unavailable.");if(requestId.current===turn)setMessages(v=>[...v,p.data.message]);}catch(e){if(requestId.current===turn)setError((e as Error).message);}finally{if(requestId.current===turn)setBusy(false);}}
 function close(){sessionStorage.setItem(storageKey,"closed");setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches?"closed":"closing");trigger.current?.focus();}
 function launch(){if(open){close();return;}sessionStorage.setItem(storageKey,"open");setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches?"open":"opening");}
 useEffect(()=>{
  if(phase!=="opening"&&phase!=="closing")return;
  const timer=setTimeout(()=>setPhase(phase==="opening"?"open":"closed"),phase==="opening"?1000:650);
  return()=>clearTimeout(timer);
 },[phase]);
 useEffect(()=>{if(phase==="open")dialog.current?.querySelector<HTMLButtonElement>("[aria-label='Close SurvAI']")?.focus();},[phase]);
 const visibleMessages=messageContext===contextKey?messages:[];
 const prompts=mode==="case"?[
  {icon:ClipboardCheck,label:"Understand my survey",question:"Explain the survey options and scope available for this case."},
  {icon:FileCheck2,label:"Review my case records",question:"Summarise the available records for this case and cite the sources."},
  {icon:ArrowRight,label:"Find the next action",question:"What is the next action for this case, based on the available records?"},
 ]:mode==="platform"?[
  {icon:ClipboardCheck,label:"Review operations",question:"Summarise the current platform operations using the available records."},
  {icon:FileCheck2,label:"Review the evidence",question:"Review the available evidence and identify gaps, citing sources."},
  {icon:ArrowRight,label:"Find the next action",question:"Which operational actions need attention based on the available records?"},
 ]:[
  {icon:ClipboardCheck,label:"Prepare my inspection",question:"Help me prepare for inspection. Summarise the available case information, access details and evidence gaps, citing sources."},
  {icon:FileCheck2,label:"Review the evidence",question:"Review the available case evidence. Identify missing information and matters requiring my professional review, citing sources."},
  {icon:ArrowRight,label:"Find the next action",question:"What needs my attention next in this workspace? Use available records and cite sources."},
 ];
 useEffect(()=>{messageList.current?.scrollTo({top:messageList.current.scrollHeight,behavior:"auto"});},[messages,busy,error]);
 return <div className="survai-tool" data-phase={phase}>
  <div className="survai-tape" aria-hidden="true"/>
  <div className="survai-tape-case" aria-hidden="true"><Ruler size={22}/></div>
  <button ref={trigger} className="surveyant-toggle" aria-label={open?"Close SurvAI":"Open SurvAI, your surveying companion"} title="SurvAI · your surveying companion" aria-haspopup="dialog" aria-expanded={open} onClick={launch} onKeyDown={e=>{if(e.key==="Escape"&&open){e.preventDefault();close();}}}><SurveyantMark/><span>SurvAI</span></button>
  <dialog ref={dialog} className="surveyant-overlay" inert={phase!=="open"} aria-labelledby="surveyant-heading" onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();close();}}} onCancel={e=>{e.preventDefault();close();}} onClose={()=>setPhase("closed")}>
   <header><div className="surveyant-identity"><SurveyantMark/><div><h2 id="surveyant-heading">SurvAI</h2><p>Your surveying companion</p></div></div><button className="icon-button" aria-label="Close SurvAI" onClick={close}><X size={19}/></button></header>
   <div className="surveyant-context"><span aria-hidden="true"/>{scope}</div>
   <div ref={messageList} className="surveyant-messages" aria-live="polite">
    <div className={`surveyant-welcome${visibleMessages.length?" has-conversation":""}`}><div className="surveyant-drawing"><SurveyantMark/></div><h3>A second pair of eyes.</h3><p>{mode==="case"?"Understand your survey, explore your records, and plan your next step.":mode==="platform"?"Review operations, trace the evidence, and plan your next step.":"Prepare for inspection, trace the evidence, and plan your next step."}</p></div>
    {!visibleMessages.length&&<div className="surveyant-prompts">{prompts.map(({icon:Icon,label,question})=><button key={label} type="button" disabled={busy} onClick={()=>{setText(question);composer.current?.focus();}}><Icon size={20}/><span>{label}</span><ChevronRight size={17}/></button>)}</div>}
    {visibleMessages.map((m,i)=><div key={i} className={`surveyant-message ${m.role}`}><strong>{m.role==="user"?"You":"SurvAI"}</strong><p>{m.content}</p>{m.citations?.map(c=><Link key={c.id} href={!c.href.startsWith("/")&&!c.href.startsWith("#")?`/app/${slug}/${c.href}`:c.href}><FileCheck2 size={13}/>{c.label}</Link>)}</div>)}
    {busy&&messageContext===contextKey?<p className="surveyant-reviewing" role="status"><FileCheck2 size={16}/>Reviewing permitted records…</p>:null}{error&&messageContext===contextKey?<p className="form-error" role="alert">{error}</p>:null}
   </div>
   <form onSubmit={send}><label className="sr-only" htmlFor="surveyant-message">Message SurvAI</label><textarea ref={composer} id="surveyant-message" value={text} onChange={e=>setText(e.target.value)} required maxLength={4000} rows={2} placeholder="Ask SurvAI a question…"/><button className="button button-primary" disabled={busy||!text.trim()} aria-label="Send message"><Send size={18}/></button></form>
   <footer><BookOpen size={15}/><span>Answers grounded in your authorised records.<small>Professional findings remain yours to approve.</small></span></footer>
  </dialog>
 </div>;

}

function endpointPlaceholder(mode:string,quoteId?:string,supportId?:string){return `${mode}:${quoteId??supportId??""}`;}

function SurveyantMark(){
 return <svg className="surveyant-mark" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <circle cx="40" cy="40" r="31" strokeWidth="2"/>
  <path d="M40 7v6m0 54v6M7 40h6m54 0h6"/>
  <path d="m23 31 17-12 17 12"/>
  <rect x="33" y="34" width="14" height="18" rx="2"/>
  <circle cx="40" cy="43" r="4"/>
  <path d="M32 56h16m-12 0-6 8m14-8 6 8m-10-8v8"/>
 </svg>;
}
