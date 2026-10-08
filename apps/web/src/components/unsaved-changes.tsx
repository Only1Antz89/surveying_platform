"use client";
import {useEffect} from "react";
import {useRouter} from "next/navigation";
const guards=new Map<symbol,()=>Promise<boolean>>();
export async function confirmDiscardChanges(){const guard=guards.values().next().value;return guard?guard():true;}
/** Link, workspace-switch and tab-close protection; one decision covers the page’s edits. */
export function useUnsavedChanges(dirty:boolean){
 const router=useRouter();
 useEffect(()=>{
  if(!dirty)return;const key=Symbol(),headingId=`unsaved-${crypto.randomUUID()}`;
  const dialog=document.createElement("dialog");dialog.className="unsaved-dialog";dialog.setAttribute("aria-labelledby",headingId);
  const heading=document.createElement("h2");heading.id=headingId;heading.textContent="Keep your changes?";
  const explanation=document.createElement("p");explanation.textContent="This page has unsaved changes. Save before leaving, or discard these edits.";
  const actions=document.createElement("div");actions.className="form-actions";
  const stay=document.createElement("button");stay.className="button button-primary";stay.textContent="Keep editing";
  const leave=document.createElement("button");leave.className="button button-secondary";leave.textContent="Discard and leave";
  actions.append(stay,leave);dialog.append(heading,explanation,actions);document.body.append(dialog);
  let resolve:((value:boolean)=>void)|null=null,previous:HTMLElement|null=null;
  const close=(discard:boolean)=>{dialog.close();previous?.focus();const answer=resolve;resolve=null;answer?.(discard);};stay.onclick=()=>close(false);leave.onclick=()=>close(true);
  const ask=()=>new Promise<boolean>(answer=>{if(resolve){answer(false);return;}resolve=answer;previous=document.activeElement as HTMLElement;dialog.showModal();stay.focus();});guards.set(key,ask);
  dialog.addEventListener("cancel",e=>{e.preventDefault();close(false);});
  const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};
  const click=(e:MouseEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const link=(e.target as Element)?.closest<HTMLAnchorElement>("a[href]");if(!link||link.target==="_blank"||link.hasAttribute("download")||link.getAttribute("href")?.startsWith("#"))return;const next=new URL(link.href,location.href);if(!["http:","https:"].includes(next.protocol))return;e.preventDefault();e.stopImmediatePropagation();void confirmDiscardChanges().then(discard=>{if(discard){if(next.origin===location.origin&&!next.pathname.startsWith("/api/"))router.push(next.pathname+next.search+next.hash);else location.assign(next.href);}});};
  window.addEventListener("beforeunload",unload);document.addEventListener("click",click,true);
  return()=>{guards.delete(key);close(false);window.removeEventListener("beforeunload",unload);document.removeEventListener("click",click,true);dialog.remove();};
 },[dirty,router]);
}
