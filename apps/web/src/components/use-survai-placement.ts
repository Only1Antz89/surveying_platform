"use client";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { constrainSurvaiPlacement, parseSurvaiPlacement, snapSurvaiPlacement, survaiSide, type SurvaiBounds, type SurvaiDock, type SurvaiPlacement } from "@/lib/survai-placement";

const POSITION_KEY = "surveynt:survai:placement:v1";
const viewportHeight = () => window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : window.innerHeight;

export function useSurvaiPlacement(tool: RefObject<HTMLDivElement | null>, expanded: boolean) {
 const [placement, setPlacement] = useState<SurvaiPlacement | null>(null);
 const [dragging, setDragging] = useState(false);
 const [motion, setMotion] = useState<{kind:"docking"|"undocking";dock:SurvaiDock}|null>(null);
 const animations = useRef<Animation[]>([]);
 const motionTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
 const pendingMotion = useRef<{kind:"docking"|"undocking";from:DOMRect;anchors:{element:HTMLElement;rect:DOMRect}[]}|null>(null);
 const [snapTarget, setSnapTarget] = useState<"home" | "left" | "right" | null>(null);
 const current = useRef<SurvaiPlacement | null>(null);
 const drag = useRef<{ pointerId: number; x: number; y: number; origin: SurvaiPlacement; moved: boolean; launcher: boolean } | null>(null);
 const suppressClick = useRef(false);
 const expandedRef = useRef(expanded);
 useEffect(() => {
  expandedRef.current = expanded;
  const timer = setTimeout(() => {
   const rect = tool.current?.getBoundingClientRect();
   if (!rect || !current.current) return;
   const next = constrainSurvaiPlacement(current.current, { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: viewportHeight(), expanded });
   current.current = next;
   setPlacement(next);
  }, 0);
  return () => clearTimeout(timer);
 }, [expanded, tool]);

 function bounds(forceExpanded = expandedRef.current): SurvaiBounds | null {
  const rect = tool.current?.getBoundingClientRect();
  return rect ? { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: viewportHeight(), expanded: forceExpanded } : null;
 }
 useLayoutEffect(() => {
  const pending=pendingMotion.current, element=tool.current;
  if(!pending||!element)return;
  pendingMotion.current=null;
  const destination=element.getBoundingClientRect(), dx=pending.from.x-destination.x, dy=pending.from.y-destination.y;
  const offsets=pending.anchors.map(anchor=>{const next=anchor.element.getBoundingClientRect();return {element:anchor.element,x:anchor.rect.x-next.x-dx,y:anchor.rect.y-next.y-dy};});
  const options={duration:pending.kind==="docking"?420:220,easing:"cubic-bezier(.22,1,.36,1)"};
  const moves:Animation[]=[];
  if(Math.abs(dx)+Math.abs(dy)>.5)moves.push(element.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:"translate(0,0)"}],options));
  // Preserve the tape's visible anchor when docking changes which side opens inward.
  for(const anchor of offsets){
   const {x,y}=anchor;
   if(Math.abs(x)+Math.abs(y)>.5)moves.push(anchor.element.animate([{transform:`translate(${x}px,${y}px)`},{transform:"translate(0,0)"}],options));
  }
  animations.current=moves;
 },[placement,tool]);
 useEffect(()=>()=>{animations.current.forEach(animation=>animation.cancel());if(motionTimer.current)clearTimeout(motionTimer.current);},[]);
 function stopMotion(){
  animations.current.forEach(animation=>animation.cancel());animations.current=[];pendingMotion.current=null;
  if(motionTimer.current)clearTimeout(motionTimer.current);
  setMotion(null);
 }
 function feedback(kind:"docking"|"undocking",dock:SurvaiDock){
  if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  setMotion({kind,dock});
  if(motionTimer.current)clearTimeout(motionTimer.current);
  motionTimer.current=setTimeout(()=>setMotion(null),kind==="docking"?440:220);
 }
 function animateMove(value:SurvaiPlacement,kind:"docking"|"undocking"){
  const element=tool.current, from=element?.getBoundingClientRect();
  const anchors=element?[...element.querySelectorAll<HTMLElement>(".surveyant-toggle,.surveyant-overlay,.survai-tape,.survai-tape-case")].map(element=>({element,rect:element.getBoundingClientRect()})).filter(({element,rect})=>rect.width>0&&getComputedStyle(element).visibility!=="hidden"):[];
  const previousDock=current.current?.dock??null;
  stopMotion();
  if(from&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches){pendingMotion.current={kind,from,anchors};feedback(kind,kind==="docking"?value.dock:previousDock);}
  remember(value);
 }
 function remember(value: SurvaiPlacement) {
  current.current = value;
  setPlacement(value);
  try { localStorage.setItem(POSITION_KEY, JSON.stringify(value)); } catch { /* Moving still works if storage is unavailable. */ }
 }
 function origin(): SurvaiPlacement | null {
  const rect = tool.current?.getBoundingClientRect();
  return rect ? { x: rect.x, y: rect.y, dock: current.current ? current.current.dock : "home", side: current.current ? survaiSide(current.current) : "right" } : null;
 }
 function prepareOpen() {
  const value = origin(), area = bounds(true);
  if (value && area) remember(constrainSurvaiPlacement(value, area));
 }
 function returnHome() {
  const value = origin(), area = bounds();
  if (value && area) animateMove(constrainSurvaiPlacement({ ...value, dock: "home" }, area),"docking");
 }
 function moveBy(dx: number, dy: number) {
  const value = current.current??origin(), area = bounds();
  if (value && area) animateMove(constrainSurvaiPlacement({ ...value, x: value.x + dx, y: value.y + dy, dock: null, side: survaiSide(value) }, area),"undocking");
 }
 function pointerDown(event: PointerEvent<HTMLElement>) {
  if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest(".survai-header-actions")) return;
  const value = origin();
  if (!value) return;
  event.stopPropagation();
  stopMotion();
  current.current=value;setPlacement(value);
  suppressClick.current = false;
  drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: value, moved: false, launcher:event.currentTarget.classList.contains("surveyant-toggle") };
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function pointerMove(event: PointerEvent<HTMLElement>) {
  const active = drag.current, area = bounds();
  if (!active || active.pointerId !== event.pointerId || !area) return;
  const dx = event.clientX - active.x, dy = event.clientY - active.y;
  if (!active.moved && Math.hypot(dx, dy) < 6) return;
  if(!active.moved&&active.origin.dock)feedback("undocking",active.origin.dock);
  active.moved = true;
  setDragging(true);
  const next = constrainSurvaiPlacement({ ...active.origin, x: active.origin.x + dx, y: active.origin.y + dy, dock: null, side: survaiSide(active.origin) }, area);
  current.current = next;
  setPlacement(next);
  setSnapTarget(snapSurvaiPlacement(next, area, event.clientX).dock);
 }
 function pointerEnd(event: PointerEvent<HTMLElement>) {
  const active = drag.current;
  if (!active || active.pointerId !== event.pointerId) return;
  drag.current = null;
  setDragging(false); setSnapTarget(null);
  suppressClick.current = active.moved&&active.launcher;
  const area = bounds();
  if (active.moved && current.current && area) {const next=snapSurvaiPlacement(current.current,area,event.clientX);if(next.dock)animateMove(next,"docking");else remember(next);}
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
 }
 function consumeDragClick() {
  const suppressed = suppressClick.current;
  suppressClick.current = false;
  return suppressed;
 }
 useEffect(() => {
  let previousHeight = tool.current?.getBoundingClientRect().height ?? 0;
  function fit() {
   const rect = tool.current?.getBoundingClientRect();
   if (!rect) return;
   const height = parseFloat(tool.current?.style.getPropertyValue("--survai-height") ?? "") || rect.height;
   const heightChange = previousHeight - height;
   previousHeight = height;
   if (!current.current) return;
   // Extend upwards from the tape case, including after a manual move or dock.
   const next = constrainSurvaiPlacement({ ...current.current, y: current.current.y + heightChange }, { width: rect.width, height, viewportWidth: window.innerWidth, viewportHeight: viewportHeight(), expanded: expandedRef.current });
   if(next.x===current.current.x&&next.y===current.current.y&&next.dock===current.current.dock)return;
   current.current = next;
   setPlacement(next);
  }
  const restore = setTimeout(() => {
   try { current.current = parseSurvaiPlacement(localStorage.getItem(POSITION_KEY)) ?? { x: 0, y: 0, dock: "home" }; } catch { current.current = { x: 0, y: 0, dock: "home" }; }
   fit();
  }, 0);
  const observer = new ResizeObserver(fit);
  if (tool.current) observer.observe(tool.current);
  window.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("resize", fit);
  return () => { clearTimeout(restore); observer.disconnect(); window.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); };
 }, [tool]);
 return { placement, dragging, motion:motion?.kind, motionDock:motion?.dock, snapTarget, returnHome, prepareOpen, moveBy, consumeDragClick, dragHandlers: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerEnd, onPointerCancel: pointerEnd } };
}
