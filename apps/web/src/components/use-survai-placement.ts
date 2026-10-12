"use client";
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { constrainSurvaiPlacement, parseSurvaiPlacement, snapSurvaiPlacement, type SurvaiBounds, type SurvaiDock, type SurvaiPlacement } from "@/lib/survai-placement";

const POSITION_KEY = "surveynt:survai:placement:v1";
const viewportHeight = () => window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : window.innerHeight;

export function useSurvaiPlacement(tool: RefObject<HTMLDivElement | null>, expanded: boolean) {
 const [placement, setPlacement] = useState<SurvaiPlacement | null>(null);
 const [dragging, setDragging] = useState(false);
 const current = useRef<SurvaiPlacement | null>(null);
 const drag = useRef<{ pointerId: number; x: number; y: number; origin: SurvaiPlacement; moved: boolean } | null>(null);
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
 function remember(value: SurvaiPlacement) {
  current.current = value;
  setPlacement(value);
  try { localStorage.setItem(POSITION_KEY, JSON.stringify(value)); } catch { /* Moving still works if storage is unavailable. */ }
 }
 function origin(): SurvaiPlacement | null {
  const rect = tool.current?.getBoundingClientRect();
  return rect ? { x: rect.x, y: rect.y, dock: current.current?.dock ?? null } : null;
 }
 function prepareOpen() {
  const value = origin(), area = bounds(true);
  if (value && area) remember(constrainSurvaiPlacement(value, area));
 }
 function dock(side: SurvaiDock) {
  const value = origin(), area = bounds();
  if (value && area) remember(constrainSurvaiPlacement({ ...value, dock: side }, area));
 }
 function moveBy(dx: number, dy: number) {
  const value = origin(), area = bounds();
  if (value && area) remember(constrainSurvaiPlacement({ x: value.x + dx, y: value.y + dy, dock: null }, area));
 }
 function pointerDown(event: PointerEvent<HTMLElement>) {
  if (!event.isPrimary || event.button !== 0 || ((event.target as Element).closest(".survai-header-actions") && !event.currentTarget.classList.contains("survai-move-handle"))) return;
  const value = origin();
  if (!value) return;
  event.stopPropagation();
  suppressClick.current = false;
  drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: value, moved: false };
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function pointerMove(event: PointerEvent<HTMLElement>) {
  const active = drag.current, area = bounds();
  if (!active || active.pointerId !== event.pointerId || !area) return;
  const dx = event.clientX - active.x, dy = event.clientY - active.y;
  if (!active.moved && Math.hypot(dx, dy) < 6) return;
  active.moved = true;
  setDragging(true);
  const next = constrainSurvaiPlacement({ x: active.origin.x + dx, y: active.origin.y + dy, dock: null }, area);
  current.current = next;
  setPlacement(next);
 }
 function pointerEnd(event: PointerEvent<HTMLElement>) {
  const active = drag.current;
  if (!active || active.pointerId !== event.pointerId) return;
  drag.current = null;
  setDragging(false);
  suppressClick.current = active.moved;
  const area = bounds();
  if (active.moved && current.current && area) remember(snapSurvaiPlacement(current.current, area));
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
   try { current.current = parseSurvaiPlacement(localStorage.getItem(POSITION_KEY)); } catch { /* Use the default position. */ }
   fit();
  }, 0);
  const observer = new ResizeObserver(fit);
  if (tool.current) observer.observe(tool.current);
  window.addEventListener("resize", fit);
  window.visualViewport?.addEventListener("resize", fit);
  return () => { clearTimeout(restore); observer.disconnect(); window.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); };
 }, [tool]);
 return { placement, dragging, prepareOpen, dock, moveBy, consumeDragClick, dragHandlers: { onPointerDown: pointerDown, onPointerMove: pointerMove, onPointerUp: pointerEnd, onPointerCancel: pointerEnd } };
}
