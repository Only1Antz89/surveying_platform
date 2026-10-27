"use client";
import { useEffect } from "react";
import { labelTableCells } from "./table-labels";

/** Keeps stacked mobile tables labelled as pages render and update. */
export function ResponsiveTables() {
  useEffect(() => {
    let frame = 0;
    const run = () => { frame = 0; labelTableCells(document); };
    run();
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(run); });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return null;
}
