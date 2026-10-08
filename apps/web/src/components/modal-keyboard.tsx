"use client";
import { useEffect } from "react";

const focusable = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/** The topmost open custom modal (native <dialog> elements manage their own keyboard behaviour). */
function topModal() {
  const open = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter((node) => node.tagName !== "DIALOG" && node.isConnected && node.getClientRects().length > 0);
  return open.at(-1) ?? null;
}

/**
 * Keyboard support shared by every custom modal: Escape uses the dialog's own
 * close control, Tab and Shift+Tab stay inside the dialog, and focus returns
 * to the control that opened it once it closes.
 */
export function ModalKeyboard() {
  useEffect(() => {
    let lastOutside: HTMLElement | null = null;
    let opener: HTMLElement | null = null;
    let tracked: HTMLElement | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const modal = topModal();
      if (!modal) return;
      if (event.key === "Escape") {
        const close = modal.querySelector<HTMLButtonElement>('button[aria-label^="Close"]:not([disabled])');
        if (close) { event.preventDefault(); close.click(); }
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...modal.querySelectorAll<HTMLElement>(focusable)].filter((node) => node.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); modal.focus(); return; }
      const first = items[0], last = items.at(-1)!;
      const inside = modal.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !inside)) { event.preventDefault(); first.focus(); }
    };
    // Focus can move into a dialog (autoFocus) before it is observed, so remember the last focus outside any modal.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.('[role="dialog"]')) lastOutside = target;
    };
    const observer = new MutationObserver(() => {
      const modal = topModal();
      if (modal && modal !== tracked) {
        tracked = modal; opener = lastOutside;
        if (!modal.contains(document.activeElement)) { if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1"); modal.focus(); }
      } else if (!modal && tracked) {
        tracked = null;
        if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus();
        opener = null;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => { observer.disconnect(); document.removeEventListener("keydown", onKeyDown); document.removeEventListener("focusin", onFocusIn); };
  }, []);
  return null;
}
