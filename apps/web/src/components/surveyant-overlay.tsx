"use client";
import {useWorkspace} from "./workspace-provider";
import {type OrganisationRole,type PlatformRole} from "@surveynt/domain";
import {survaiPageFromPath,survaiContextCopy} from "@/lib/survai-context";
import {workspaceLabels,resolveWorkspace} from "@/lib/workspace-mode";
import {workspaceFetch} from "@/lib/workspace-request";
import {Suspense,useEffect,useRef,useState} from "react";
import {usePathname,useSearchParams} from "next/navigation";
import {Send,X,FileCheck2,ClipboardCheck,CalendarDays,ArrowRight,ChevronRight,BookOpen,Ruler,GripHorizontal} from "lucide-react";
import {survaiSide} from "@/lib/survai-placement";
import {useSurvaiPlacement} from "./use-survai-placement";
import {SurvaiPages} from "./survai-pages";
import {SurvaiResults,SurvaiResultsToolbar} from "./survai-results";
import {survaiReviewsFromHistory,type SurvaiReview} from "@/lib/survai-results";
type OverlayProps={role?:OrganisationRole;platformRole?:PlatformRole;mode:"firm"|"platform"|"case";slug?:string;quoteId?:string;token?:string;name:string};
export function SurveyantOverlay(props:OverlayProps){return <Suspense fallback={null}><SurvaiOverlay {...props}/></Suspense>;}
function SurvaiOverlay({mode,slug,quoteId,token,name,role,platformRole}:OverlayProps){
 const workspace=useWorkspace();const audience=workspace?.workspaceMode;
 const pathname=usePathname(),query=useSearchParams();const pageContext=survaiPageFromPath(pathname,mode,query.get("view"));const effectiveRole=workspace?resolveWorkspace(workspace.actorRole,audience)?.effectiveRole??"read_only":role??"read_only";const pageCopy=survaiContextCopy(pageContext,{mode,role:effectiveRole,platformRole});const jobId=mode==="firm"?pathname.match(/\/jobs\/([\da-f-]{36})(?:\/|$)/i)?.[1]:undefined;
 const supportId=mode==="platform"?pathname.match(/\/platform\/support\/([\da-f-]{36})(?:\/|$)/i)?.[1]:undefined;
 const scope=mode==="case"?`Case ${name}`:mode==="platform"?supportId?"Surveynt · active support session (read only)":"Surveynt · platform operations":jobId?`${name} · current case`:`${name} · ${audience?workspaceLabels[audience]:"business records"}${audience==="surveyor"?" · your assignments":""}`;
 const contextKey=`${effectiveRole}:${platformRole}:${pageContext.page}:${pageContext.resourceId??""}:${audience}:${endpointPlaceholder(mode,quoteId,supportId)}:${jobId??""}:${token??""}`;
 const [messageContext,setMessageContext]=useState(contextKey);const [phase,setPhase]=useState<"closed"|"opening"|"open"|"closing">("closed"),[reviews,setReviews]=useState<SurvaiReview[]>([]),[selectedReview,setSelectedReview]=useState<string|null>(null),[view,setView]=useState<"menu"|"results">("menu"),[text,setText]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),composer=useRef<HTMLTextAreaElement>(null),requestId=useRef(0),sending=useRef(false),historyController=useRef<AbortController|null>(null);
 const open=phase!=="closed";
 const tool=useRef<HTMLDivElement>(null);const movement=useSurvaiPlacement(tool,open);
 const endpoint=mode==="platform"?supportId?`/api/platform/support/${supportId}/surveyant`:"/api/platform/surveyant":mode==="case"?`/api/v1/public/quotes/${quoteId}/assistant`:"/api/v1/surveyant";const storageKey=`surveynt:overlay:${mode}:${slug??quoteId??"platform"}`;
 useEffect(()=>{const timer=setTimeout(()=>setPhase(sessionStorage.getItem(storageKey)==="open"?"open":"closed"),0);return()=>clearTimeout(timer);},[storageKey]);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.show();if(!open&&dialog.current?.open)dialog.current?.close();},[open,storageKey]);
 useEffect(()=>{
  requestId.current++;let active=true;const controller=new AbortController();historyController.current=controller;
  const reset=setTimeout(()=>{
   if(controller.signal.aborted)return;
   setMessageContext(contextKey);setReviews([]);setSelectedReview(null);setView("menu");setError("");sending.current=false;setBusy(false);setText("");
   if(mode==="case"&&!token)return;
   workspaceFetch(`${endpoint}?${new URLSearchParams({page:pageContext.page,...(pageContext.resourceId?{resourceId:pageContext.resourceId}:{}),...(jobId?{jobId}:{})})}`,{headers:{...(token?{"x-quote-token":token}:{}),...(slug?{"x-demo-organisation-slug":slug}:{})},signal:controller.signal}).then(async response=>{
    const payload=await response.json();if(!response.ok)throw Error(payload.error?.message??"Reviews unavailable.");
    if(active&&!controller.signal.aborted){const restored=survaiReviewsFromHistory(payload.data.messages??[],survaiContextCopy({page:pageContext.page,resourceId:pageContext.resourceId},{mode,role:effectiveRole,platformRole}).actions);setReviews(restored);setSelectedReview(restored.at(-1)?.id??null);}
   }).catch(failure=>{if(active&&!controller.signal.aborted&&failure.name!=="AbortError")setError(failure.message);});
  },0);
  return()=>{active=false;controller.abort();clearTimeout(reset);};
 },[endpoint,jobId,token,slug,mode,audience,contextKey,pageContext.page,pageContext.resourceId,effectiveRole,platformRole]);
 async function ask(question:string,clearDraft=false,title="Your request",retryId?:string){
  question=question.trim();if(!question||sending.current||!pageCopy.allowed)return;
  sending.current=true;historyController.current?.abort();const turn=++requestId.current;
  const id=retryId??`request:${turn}`;const review:SurvaiReview={id,title,question,status:"working"};
  setBusy(true);setError("");setReviews(v=>retryId?v.map(item=>item.id===id?review:item):[...v,review]);setSelectedReview(id);setView("results");if(clearDraft)setText("");
  try{const r=await workspaceFetch(endpoint,{method:"POST",headers:{"content-type":"application/json",...(token?{"x-quote-token":token}:{}),...(slug?{"x-demo-organisation-slug":slug}:{})},body:JSON.stringify({message:question,pageContext,...(jobId?{jobId}:{})})});const p=await r.json();if(!r.ok)throw Error(p.error?.message??"SurvAI is unavailable.");if(requestId.current===turn)setReviews(v=>v.map(item=>item.id===id?{...item,status:"ready",answer:p.data.message}:item));}
  catch(e){if(requestId.current===turn)setReviews(v=>v.map(item=>item.id===id?{...item,status:"error",error:(e as Error).message}:item));}
  finally{if(requestId.current===turn){sending.current=false;setBusy(false);}}
 }
 function send(e:React.FormEvent){e.preventDefault();void ask(text,true);}
 function close(){if(phase==="closed"||phase==="closing")return;sessionStorage.setItem(storageKey,"closed");setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches?"closed":"closing");trigger.current?.focus();}
 function returnToHome(){movement.returnHome();if(open)dialog.current?.querySelector<HTMLButtonElement>(".survai-move-handle")?.focus();else trigger.current?.focus();}
 function launch(){if(movement.consumeDragClick())return;if(open){close();return;}movement.prepareOpen();sessionStorage.setItem(storageKey,"open");setPhase(window.matchMedia("(prefers-reduced-motion: reduce)").matches?"open":"opening");}
 useEffect(()=>{
  if(phase!=="opening"&&phase!=="closing")return;
  const timer=setTimeout(()=>setPhase(phase==="opening"?"open":"closed"),phase==="opening"?1000:650);
  return()=>clearTimeout(timer);
 },[phase]);
 useEffect(()=>{if(phase==="open")dialog.current?.querySelector<HTMLButtonElement>("[aria-label='Close SurvAI']")?.focus();},[phase]);
 const visibleReviews=messageContext===contextKey?reviews:[];
 const currentReview=visibleReviews.find(review=>review.id===selectedReview)??visibleReviews.at(-1);
 const resultView=view==="results"&&!!currentReview;
 const previousResultView=useRef(false);
 useEffect(()=>{
  if(phase==="open"){
   if(resultView)dialog.current?.querySelector<HTMLElement>(".survai-page-flow .survai-result-sheet h3")?.focus();
   else if(previousResultView.current)dialog.current?.querySelector<HTMLButtonElement>(".survai-page-flow .surveyant-prompts button")?.focus();
  }
  previousResultView.current=resultView;
 },[resultView,currentReview?.id,phase]);
 const prompts=pageCopy.actions.map(action=>({...action,icon:action.kind==="next"?ArrowRight:action.kind==="review"?FileCheck2:["calendar","availability","routes","fieldwork"].includes(pageContext.page)?CalendarDays:ClipboardCheck}));
 useEffect(()=>{
  const fieldbook=dialog.current,measure=tool.current;if(!fieldbook||!measure)return;
  const observer=new ResizeObserver(()=>{
   if(!fieldbook.open)return;let height=2;
   for(const child of fieldbook.children){const style=getComputedStyle(child);height+=child.getBoundingClientRect().height+parseFloat(style.marginTop)+parseFloat(style.marginBottom);}
   measure.style.setProperty("--survai-height",`${Math.ceil(height)}px`);
  });
  for(const child of fieldbook.children)observer.observe(child);return()=>observer.disconnect();
 },[]);
 const homeDocked=!movement.placement||movement.placement.dock==="home";
 return <>
 <button type="button" className="survai-home-dock" data-occupied={homeDocked||undefined} data-active={movement.snapTarget==="home"||undefined} aria-label="Return SurvAI to its home dock" title="Return SurvAI to its home dock" aria-hidden={homeDocked} tabIndex={homeDocked?-1:0} onClick={returnToHome}><Ruler size={22}/><span>SurvAI dock</span></button>
 <div className="survai-edge-guide" data-edge={movement.snapTarget==="left"||movement.snapTarget==="right"?movement.snapTarget:undefined} aria-hidden="true"/>
 <div ref={tool} className="survai-tool" data-phase={phase} data-view={resultView?"results":"menu"} data-dock={movement.placement?movement.placement.dock??"floating":"home"} data-side={movement.placement?survaiSide(movement.placement):"right"} data-dragging={movement.dragging||undefined} style={movement.placement?{left:movement.placement.x,top:movement.placement.y,right:"auto",bottom:"auto"}:undefined}>
  <div className="survai-tape" aria-hidden="true"/>
  <div className="survai-tape-case" aria-hidden="true"><Ruler size={22}/></div>
  <button ref={trigger} className="surveyant-toggle" aria-label={open?"Close SurvAI":"Open SurvAI, your surveying companion"} title="SurvAI · your surveying companion" aria-haspopup="dialog" aria-expanded={open} {...movement.dragHandlers} onClick={launch} onKeyDown={e=>{if(e.key==="Escape"&&open){e.preventDefault();close();}}}><SurveyantMark/><span>SurvAI</span></button>
  <dialog ref={dialog} className="surveyant-overlay" inert={phase==="closing"} aria-labelledby="surveyant-heading" onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();close();}}} onCancel={e=>{e.preventDefault();close();}} onClose={()=>setPhase("closed")}>
   <header {...movement.dragHandlers} title="Drag to move SurvAI; drop near an edge to dock">
    <div className="surveyant-identity"><SurveyantMark/><div><h2 id="surveyant-heading">SurvAI</h2><p>Your surveying companion</p></div></div>
    <div className="survai-header-actions">
     <button type="button" className="survai-header-button survai-move-handle" aria-label="Move SurvAI with arrow keys" title="Move with arrow keys; Home returns to the dock" {...movement.dragHandlers} onKeyDown={e=>{const step=e.shiftKey?40:16;const moves:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};if(moves[e.key]){e.preventDefault();movement.moveBy(...moves[e.key]);}else if(e.key==="Home"){e.preventDefault();movement.returnHome();}}}><GripHorizontal size={18}/></button>
     <button type="button" className="survai-header-button survai-close-button" aria-label="Close SurvAI" title="Close SurvAI" onClick={close}><X size={19}/></button>
    </div>
   </header>
   <div className="surveyant-context"><span aria-hidden="true"/>{scope} · {pageCopy.title}</div>
   {resultView&&currentReview&&<SurvaiResultsToolbar index={visibleReviews.indexOf(currentReview)} count={visibleReviews.length} busy={busy} onBack={()=>setView("menu")} onSelect={index=>setSelectedReview(visibleReviews[index].id)}/>}
   <div className="surveyant-messages" aria-live="polite"><SurvaiPages key={`${contextKey}:${resultView?currentReview?.id:"menu"}`} followUpdates={false} revision={`${contextKey}:${open}:${view}:${currentReview?.id}:${currentReview?.status}:${visibleReviews.length}:${error}`}>
    {resultView&&currentReview?<SurvaiResults review={currentReview} pageTitle={pageCopy.title} slug={slug} busy={busy} onRetry={()=>void ask(currentReview.question,false,currentReview.title,currentReview.id)}/>:<>
     <div className="surveyant-welcome"><div className="surveyant-drawing"><SurveyantMark/></div><h3>{pageCopy.title}</h3><p>{pageCopy.description}</p></div>
     {prompts.length>0&&<div className="surveyant-prompts">{prompts.map(({icon:Icon,label,question})=><button key={label} type="button" disabled={busy} onClick={()=>void ask(question,false,label)}><Icon size={20}/><span>{label}</span><ChevronRight size={17}/></button>)}</div>}
     {visibleReviews.length>0&&<button type="button" className="survai-saved-reviews" onClick={()=>setView("results")}><FileCheck2 size={16}/>View your reviews<ChevronRight size={15}/></button>}
     {error&&messageContext===contextKey?<p className="form-error" role="alert">{error}</p>:null}
    </>}
   </SurvaiPages></div>
   <form onSubmit={send}><label className="sr-only" htmlFor="surveyant-message">Message SurvAI</label><textarea ref={composer} id="surveyant-message" value={text} disabled={!pageCopy.allowed} onChange={e=>setText(e.target.value)} required maxLength={4000} rows={2} placeholder="Ask SurvAI a question…"/><button className="button button-primary" disabled={busy||!text.trim()||!pageCopy.allowed} aria-label="Send message"><Send size={18}/></button></form>
   <footer><BookOpen size={15}/><span>Answers grounded in your authorised records.<small>Professional findings remain yours to approve.</small></span></footer>
  </dialog>
 </div></>;

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
