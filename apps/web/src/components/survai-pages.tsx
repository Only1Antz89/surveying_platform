"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Fit the fieldbook to its contents; paginate only when a screen cannot hold them. */
export function SurvaiPages({ children, revision, followUpdates }: { children: ReactNode; revision: string; followUpdates: boolean }) {
 const frame = useRef<HTMLDivElement>(null), measure = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
 const [layout, setLayout] = useState({ height: 0, width: 0, pages: 1 });
 const [page, setPage] = useState(0);
 const [visibleHeight, setVisibleHeight] = useState(0);
 const followLatest = useRef(followUpdates);
 const previousRevision = useRef(revision);
 useEffect(() => {
  if (previousRevision.current !== revision) { followLatest.current = followUpdates; previousRevision.current = revision; }
  const root = frame.current, sizing = measure.current, flow = content.current;
  const dialog = root?.closest("dialog");
  if (!root || !sizing || !flow || !dialog) return;
  let pending = 0;
  function fit() {
   if (!root || !sizing || !flow || !dialog?.open || !root.clientWidth) return;
   // All other dialog sections (including their margins) stay outside the pages.
   let chrome = 2;
   for (const child of dialog.children) {
    const style = getComputedStyle(child);
    chrome += child.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
   }
   chrome -= root.getBoundingClientRect().height;
   const viewport = window.visualViewport?.height ?? window.innerHeight;
   const available = Math.max(64, Math.floor(viewport - 24 - chrome));
   const natural = Math.ceil(sizing.getBoundingClientRect().height);
   const paged = natural > available;
   const height = paged ? Math.max(64, available - 40) : natural;
   flow.style.height = `${height}px`;
   flow.style.columnWidth = `${root.clientWidth}px`;
   const pages = paged ? Math.max(1, Math.ceil((flow.scrollWidth + 16) / (root.clientWidth + 16))) : 1;
   setLayout(current => current.height === height && current.width === root.clientWidth && current.pages === pages ? current : { height, width: root.clientWidth, pages });
   setPage(current => followLatest.current ? pages - 1 : Math.min(current, pages - 1));
  }
  function schedule() { cancelAnimationFrame(pending); pending = requestAnimationFrame(fit); }
  const observer = new ResizeObserver(schedule);
  observer.observe(sizing);
  // Changes to the composer or wrapping context also change the available space.
  for (const child of dialog.children) if (!child.contains(root)) observer.observe(child);
  observer.observe(root);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  schedule();
  return () => { observer.disconnect(); cancelAnimationFrame(pending); window.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("resize", schedule); };
 }, [revision, followUpdates]);
 useEffect(() => {
  const pending = requestAnimationFrame(() => {
   const flow = content.current;
   if (!flow || !layout.height) return;
   const origin = flow.getBoundingClientRect();
   const left = origin.left + page * (layout.width + 16);
   let used = 0;
   for (const child of flow.querySelectorAll("*")) for (const rect of child.getClientRects()) {
    if (rect.width && rect.right > left + 1 && rect.left < left + layout.width - 1) used = Math.max(used, rect.bottom - origin.top);
   }
   setVisibleHeight(Math.min(layout.height, Math.max(1, Math.ceil(used))));
  });
  return () => cancelAnimationFrame(pending);
 }, [layout, page, revision]);
 return <div ref={frame} className="survai-pages">
  <div ref={measure} className="survai-page-measure" aria-hidden="true" inert>{children}</div>
  <div className="survai-page-window" style={layout.height ? { height: visibleHeight || layout.height } : undefined}>
   <div ref={content} className="survai-page-flow" style={{ height: layout.height || undefined, columnWidth: layout.width || undefined, transform: `translateX(${-page * (layout.width + 16)}px)` }} onFocusCapture={event => {
    const flow = content.current;
    if (flow && layout.width) { followLatest.current = false; setPage(Math.min(layout.pages - 1, Math.max(0, Math.floor((event.target.getBoundingClientRect().left - flow.getBoundingClientRect().left) / (layout.width + 16))))); }
   }}>{children}</div>
  </div>
  {layout.pages > 1 && <nav className="survai-page-controls" aria-label="SurvAI conversation pages">
   <button type="button" aria-label="Previous SurvAI page" disabled={page === 0} onClick={() => { followLatest.current = false; setPage(current => current - 1); }}><ChevronLeft size={16}/></button>
   <span role="status">{page + 1} / {layout.pages}</span>
   <button type="button" aria-label="Next SurvAI page" disabled={page === layout.pages - 1} onClick={() => { followLatest.current = false; setPage(current => current + 1); }}><ChevronRight size={16}/></button>
  </nav>}
 </div>;
}
